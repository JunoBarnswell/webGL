import { openDB } from "idb";
import { applyPatches, type Patch } from "immer";
import {
  assertDocument,
  type DocumentPatch,
  type SceneDocument,
} from "@studio/scene-schema";

export interface JournalEntry {
  sceneId: string;
  revision: number;
  document: SceneDocument;
  label: string;
  committedAt: string;
  dirty: boolean;
  workspaceId?: string;
}
interface DraftMeta {
  workspaceId: string;
  sceneId: string;
  revision: number;
  label: string;
  committedAt: string;
  dirty: boolean;
  pending: number;
}
export const journalWorkspaceId =
  sessionStorage.getItem("studio-workspace-id") ?? crypto.randomUUID();
sessionStorage.setItem("studio-workspace-id", journalWorkspaceId);
const database = openDB("webgl-studio-journal", 1, {
  upgrade(db) {
    const drafts = db.createObjectStore("drafts", {
      keyPath: ["workspaceId", "sceneId"],
    });
    drafts.createIndex("sceneId", "sceneId");
    const transactions = db.createObjectStore("transactions", {
      keyPath: "id",
      autoIncrement: true,
    });
    transactions.createIndex("draft", ["workspaceId", "sceneId"]);
    db.createObjectStore("checkpoints", {
      keyPath: ["workspaceId", "sceneId"],
    });
  },
});
let sequence = Promise.resolve();
export function journal(
  entry: JournalEntry,
  transaction = true,
  patches?: DocumentPatch[],
  before?: SceneDocument,
): Promise<void> {
  sequence = sequence
    .catch(() => {})
    .then(async () => {
      const db = await database,
        key = [journalWorkspaceId, entry.sceneId],
        tx = db.transaction(
          ["drafts", "transactions", "checkpoints"],
          "readwrite",
        );
      const previous = (await tx.objectStore("drafts").get(key)) as
        | DraftMeta
        | undefined;
      const checkpoint = await tx.objectStore("checkpoints").get(key);
      let pending = previous?.pending ?? 0;
      const purge = async () => {
        let cursor = await tx
          .objectStore("transactions")
          .index("draft")
          .openCursor(key);
        while (cursor) {
          await cursor.delete();
          cursor = await cursor.continue();
        }
      };
      if (!transaction || !patches || pending >= 19) {
        await tx
          .objectStore("checkpoints")
          .put({
            workspaceId: journalWorkspaceId,
            sceneId: entry.sceneId,
            document: entry.document,
          });
        await purge();
        pending = 0;
      } else {
        if (!checkpoint || previous?.revision !== entry.revision) {
          if (!before) throw new Error("本地事务缺少初始快照");
          await tx
            .objectStore("checkpoints")
            .put({
              workspaceId: journalWorkspaceId,
              sceneId: entry.sceneId,
              document: before,
            });
          await purge();
          pending = 0;
        }
        await tx
          .objectStore("transactions")
          .add({
            workspaceId: journalWorkspaceId,
            sceneId: entry.sceneId,
            patches,
            label: entry.label,
            committedAt: entry.committedAt,
          });
        pending++;
      }
      const { document: _document, ...metadata } = entry;
      await tx
        .objectStore("drafts")
        .put({ ...metadata, workspaceId: journalWorkspaceId, pending });
      await tx.done;
    });
  return sequence;
}
export async function resolveLocalDraft(
  sceneId: string,
  workspaceId = journalWorkspaceId,
  committedAt?: string,
): Promise<void> {
  await sequence;
  const db = await database,
    key = [workspaceId, sceneId],
    tx = db.transaction("drafts", "readwrite");
  const row = (await tx.store.get(key)) as DraftMeta | undefined;
  if (row && (!committedAt || row.committedAt === committedAt))
    await tx.store.put({ ...row, dirty: false });
  await tx.done;
}
export async function localDraft(
  sceneId: string,
): Promise<JournalEntry | undefined> {
  await sequence;
  const db = await database;
  let row = (await db.get("drafts", [journalWorkspaceId, sceneId])) as
    | DraftMeta
    | undefined;
  if (!row)
    row = (
      (await db.getAllFromIndex("drafts", "sceneId", sceneId)) as DraftMeta[]
    )
      .filter((r) => r.dirty)
      .sort((a, b) => b.committedAt.localeCompare(a.committedAt))[0];
  if (!row) return;
  const key = [row.workspaceId, sceneId],
    checkpoint = await db.get("checkpoints", key);
  if (!checkpoint) throw new Error("本地草稿快照缺失，已停止恢复");
  const transactions = await db.getAllFromIndex("transactions", "draft", key);
  let document = checkpoint.document as SceneDocument;
  for (const transaction of transactions)
    document = applyPatches(document, transaction.patches as Patch[]);
  assertDocument(document);
  return {
    workspaceId: row.workspaceId,
    sceneId,
    revision: row.revision,
    document,
    label: row.label,
    committedAt: row.committedAt,
    dirty: row.dirty,
  };
}

export async function persistDocumentDraft(
  key: string,
  value: unknown,
): Promise<void> {
  const db = await database;
  await db.put("checkpoints", {
    workspaceId: journalWorkspaceId,
    sceneId: "document:" + key,
    document: value,
  });
}
export async function recoverDocumentDraft<T>(
  key: string,
): Promise<T | undefined> {
  const db = await database;
  return (await db.get("checkpoints", [journalWorkspaceId, "document:" + key]))
    ?.document as T | undefined;
}
