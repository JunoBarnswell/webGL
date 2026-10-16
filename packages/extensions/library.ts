import { useEffect, useState } from "react";
import type { ExtensionPanelProps } from "./editor-contract";
export interface LibraryRecord<T = unknown> {
  kind: string;
  id: string;
  name: string;
  revision: number;
  versionId: string;
  document: T;
  updatedAt: string;
}
export function useLibrary<T>(
  kind: string,
  services: ExtensionPanelProps["services"],
) {
  const [items, setItems] = useState<LibraryRecord<T>[]>([]),
    [error, setError] = useState("");
  const refresh = async () => {
    try {
      setItems(await services.request<LibraryRecord<T>[]>("/library/" + kind));
      setError("");
    } catch (error) {
      setError(String(error));
    }
  };
  useEffect(() => {
    const abort = new AbortController();
    void services
      .request<LibraryRecord<T>[]>("/library/" + kind, { signal: abort.signal })
      .then(setItems)
      .catch((error) => {
        if (!abort.signal.aborted) setError(String(error));
      });
    return () => abort.abort();
  }, [kind, services.request]);
  return { items, error, refresh };
}

import { DocumentSession } from "../editor-core/src/DocumentSession";
const documentSessions = new Map<
  string,
  {
    session: DocumentSession<object>;
    revision: number;
    versionId: string;
    name: string;
    dirty: boolean;
  }
>();
export function useLibraryDocument<T extends object>(
  kind: string,
  id: string,
  name: string,
  initial: () => T,
  validate: (document: T) => void,
  services: ExtensionPanelProps["services"],
) {
  const key = kind + ":" + id,
    [entry, setEntry] = useState<{
      session: DocumentSession<T>;
      revision: number;
      versionId: string;
      name: string;
      dirty: boolean;
    } | null>(null),
    [document, setDocument] = useState<T | null>(null),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(false);
  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    setEntry(null); setDocument(null); setDirty(false); setError("");
    const cached = documentSessions.get(key);
    const open = async () => {
      let record: {
        document: T;
        revision: number;
        versionId: string;
        name: string;
      };
      if (cached) {
        if (active) {
          setEntry(cached as unknown as typeof entry);
          setDocument(cached.session.document as T);
          setDirty(cached.dirty);
        }
        return;
      }
      try {
        record = await services.request<LibraryRecord<T>>(
          "/library/" + kind + "/" + id,
          { signal: abort.signal },
        );
      } catch (error) {
        if ((error as { status?: number }).status !== 404) throw error;
        record = { document: initial(), revision: 0, versionId: "", name };
      }
      const local = await services.recoverDraft<{
        document: T;
        revision: number;
        dirty: boolean;
      }>(key);
      if (local?.dirty) {
        record.document = local.document;
        if (local.revision !== record.revision)
          setError("本地修订与云端变化冲突；已保留本地编辑，请另存或明确处理");
      }
      const session = new DocumentSession(record.document, validate),
        next = {
          session,
          revision: record.revision,
          versionId: record.versionId,
          name: record.name,
          dirty: Boolean(local?.dirty),
        };
      documentSessions.set(
        key,
        next as unknown as {
          session: DocumentSession<object>;
          revision: number;
          versionId: string;
          name: string;
          dirty: boolean;
        },
      );
      if (active) {
        setEntry(next);
        setDocument(session.document);
        setDirty(Boolean(local?.dirty));
      }
    };
    void open().catch((error) => {
      if (active) setError(String(error));
    });
    return () => {
      active = false;
      abort.abort();
    };
  }, [key]);
  useEffect(() => {
    if (!entry) return;
    services.historyTarget(entry.session, async () => {
      await save();
    }, entry.dirty);
    const unsubscribe = entry.session.subscribe((change) => {
      entry.dirty = true;
      services.historyTarget(entry.session, async () => { await save(); }, true);
      setDocument(change.after);
      setDirty(true);
      void services.persistDraft(key, {
        document: change.after,
        revision: entry.revision,
        dirty: true,
      });
    });
    return () => {
      unsubscribe();
      services.historyTarget(null);
    };
  }, [entry, key]);
  const execute = (label: string, mutate: (doc: T) => void) => {
    try {
      entry?.session.execute({ label, mutate });
      setError("");
    } catch (error) {
      setError(String(error));
    }
  };
  const save = async () => {
    if (!entry) throw Error("文档尚未载入");
    const snapshot = entry.session.document;
    try {
      const result = await services.request<LibraryRecord<T>>(
        "/library/" + kind + "/" + id,
        {
          method: "PUT",
          body: JSON.stringify({
            name:
              snapshot && typeof snapshot === "object" && "name" in snapshot
                ? String(snapshot.name)
                : entry.name,
            expectedRevision: entry.revision,
            document: snapshot,
          }),
        },
      );
      entry.revision = result.revision;
      entry.versionId = result.versionId;
      const stillDirty = entry.session.document !== snapshot;
      entry.dirty = stillDirty;
      services.historyTarget(entry.session, async () => { await save(); }, stillDirty);
      setDirty(stillDirty);
      await services.persistDraft(key, {
        document: entry.session.document,
        revision: result.revision,
        dirty: stillDirty,
      });
      setError("");
      return result;
    } catch (error) {
      setError(String(error));
      throw error;
    }
  };
  const adopt = async (record: LibraryRecord<T>) => {
    const session = new DocumentSession(record.document, validate),
      next = {
        session,
        revision: record.revision,
        versionId: record.versionId,
        name: record.name,
        dirty: false,
      };
    documentSessions.set(
      key,
      next as unknown as {
        session: DocumentSession<object>;
        revision: number;
        versionId: string;
        name: string;
        dirty: boolean;
      },
    );
    setEntry(next);
    setDocument(session.document);
    setDirty(false);
    setError("");
    await services.persistDraft(key, {
      document: session.document,
      revision: record.revision,
      dirty: false,
    });
  };
  return {
    adopt,
    document,
    session: entry?.session,
    revision: entry?.revision ?? 0,
    versionId: entry?.versionId ?? "",
    error,
    dirty,
    execute,
    save,
  };
}
