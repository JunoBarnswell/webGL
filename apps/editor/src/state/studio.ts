import { create } from "zustand";
import {
  createDocument,
  releaseReadiness,
  summarizeReadiness,
  type ReleaseReadinessReport,
  sourceDocument,
  type SceneDocument,
  type Transform,
  type Vec3,
} from "@studio/scene-schema";
import {
  EditorSession,
  changesBetween,
  type HistoryTarget,
  type EditorCommand,
} from "@studio/editor-core";
import type { SceneRuntime } from "@studio/scene-runtime";
import type { EditorCamera } from "../panels/EditorCamera";
import { ApiError, request, type CloudDraft, type Project } from "./api";
import { journal, localDraft, type JournalEntry } from "./journal";

export type EditingPoint = import("../shell/DocumentPoint").DocumentPoint;
type SaveState = "saved" | "dirty" | "saving" | "offline" | "conflict";
interface StudioState {
  releaseReport: ReleaseReadinessReport | null;
  reportPending: boolean;
  checkReadiness: () => Promise<void>;
  session: EditorSession | null;
  domainTool: string;
  draggingPrefab: import("@studio/scene-schema").PrefabRevision | null;
  previewController: { stop: () => Promise<void>; dispose: () => void } | null;
  historyTarget: HistoryTarget | null;
  setHistoryTarget: (owner: string, target: HistoryTarget | null, save?: () => Promise<void>) => void;
  activateHistory: (owner: string) => void;
  activeDocumentSave: (() => Promise<void>) | null;
  scratchActive: boolean;
  beginScratch: () => Promise<void>;
  cancelScratch: () => Promise<SceneDocument>;
  editingLibrary: {
    id: string;
    name: string;
    rootLocalId: string;
    metadata?: { category?: string; thumbnailAssetId?: string };
  } | null;
  editSource: (
    record: import("../../../../packages/extensions/library").LibraryRecord<{
      rootLocalId: string;
      document: SceneDocument;
      category?: string;
      thumbnailAssetId?: string;
    }>,
  ) => Promise<void>;
  returnToScene: () => Promise<void>;
  document: SceneDocument | null;
  runtime: SceneRuntime | null;
  projectId: string;
  revision: number;
  selected: string[];
  editingPoint: EditingPoint | null;
  pointPreview: Vec3 | null;
  transforms: Record<string, Transform>;
  tool: "select" | "translate" | "rotate" | "scale";
  space: "world" | "local";
  snap: boolean;
  mode: "edit" | "play";
  saveState: SaveState;
  message: string;
  issues: Record<string, string>;
  busy: string;
  view: EditorCamera | null;
  activeRuleId: string;
  activeTourId: string;
  activeContentId: string;
  uiLayoutId: string;
  uiSelected: string[];
  placingHotspot: boolean;
  pickEntity: ((id: string) => void) | null;
  placingAnnotation: string;
  contextMenu: { x: number; y: number } | null;
  dragging: boolean;
  cancelTool: (() => boolean) | null;
  commandPanel: "search" | "shortcuts" | null;
  projects: Project[];
  recovery: JournalEntry | null;
  set: (patch: Partial<StudioState>) => void;
  command: (command: EditorCommand) => boolean;
  select: (ids: string[], add?: boolean) => void;
  open: (
    draft: CloudDraft,
    restore?: boolean,
    resumeSession?: EditorSession,
  ) => Promise<void>;
  close: () => void;
  save: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  switchMode: () => Promise<void>;
  run: (label: string, action: () => Promise<void>) => Promise<void>;
}
let scratchSession: { session: EditorSession; unsubscribe: () => void } | null =
  null;
let suspendedScene: {
  draft: CloudDraft;
  session: EditorSession;
  selected: string[];
} | null = null;
let unsubscribe: (() => void) | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saveQueue = Promise.resolve();
let sessionGeneration = 0;
const historyContexts = new Map<string, { target: HistoryTarget; save: (() => Promise<void>) | null }>();
let historyOwner = "viewport";
export const useStudio = create<StudioState>((set, get) => ({
  releaseReport: null,
  reportPending: false,
  async checkReadiness() {
    const { document, revision, editingLibrary } = get();
    if (!document || editingLibrary) return;
    const local = releaseReadiness(document);
    set({ releaseReport: local, reportPending: true });
    try {
      const report = await request<ReleaseReadinessReport>(
        "/scenes/" + document.sceneId + "/readiness",
        {
          method: "POST",
          body: JSON.stringify({ expectedRevision: revision, document }),
        },
      );
      if (get().document === document) set({ releaseReport: report });
    } catch (error) {
      if (get().document === document)
        set({
          releaseReport: summarizeReadiness("scene", document.sceneId, [
            ...local.checks,
            {
              code:
                error instanceof ApiError && error.status === 409
                  ? "revision"
                  : "service",
              status: "unverified",
              severity: "error",
              message: String(error),
              path: "",
              ownerId: "",
              sceneId: document.sceneId,
              details: error instanceof ApiError ? error.details : [],
            },
          ]),
        });
    } finally {
      set({ reportPending: false });
    }
  },
  domainTool: "",
  draggingPrefab: null,
  previewController: null,
  historyTarget: null,
  activeDocumentSave: null,
  setHistoryTarget: (owner, target, save) => {
    if (target) historyContexts.set(owner, { target, save: save ?? null });
    else historyContexts.delete(owner);
    if (historyOwner === owner) {
      const current = historyContexts.get(owner);
      set({ historyTarget: current?.target ?? null, activeDocumentSave: current?.save ?? null });
    }
  },
  activateHistory: (owner) => {
    historyOwner = owner;
    const current = historyContexts.get(owner);
    set({ historyTarget: current?.target ?? null, activeDocumentSave: current?.save ?? null });
  },
  scratchActive: false,
  async beginScratch() {
    await get().save();
    const s = get();
    if (!s.session || s.scratchActive) throw Error("当前不能进入试摆");
    clearTimeout(saveTimer);
    const temporary = new EditorSession(s.session.document);
    const cleanup = temporary.subscribe((change) => {
      set({ document: change.after });
      void get().runtime?.applyChangeSet(change);
    });
    scratchSession = { session: s.session, unsubscribe: cleanup };
    set({
      session: temporary,
      document: temporary.document,
      scratchActive: true,
    });
  },
  async cancelScratch() {
    if (!scratchSession) throw Error("当前没有试摆会话");
    const { session, unsubscribe: cleanup } = scratchSession;
    cleanup();
    scratchSession = null;
    const before = get().document!;
    set({ session, document: session.document, scratchActive: false });
    await get().runtime?.applyChangeSet(
      changesBetween(before, session.document),
    );
    return session.document;
  },
  editingLibrary: null,
  async editSource(record) {
    const s = get();
    if (s.editingLibrary) throw Error("请先返回当前场景");
    await s.save();
    if (get().saveState !== "saved" || !s.document || !s.session)
      throw Error("请先保存当前场景");
    suspendedScene = {
      draft: {
        projectId: s.projectId,
        sceneId: s.document.sceneId,
        revision: get().revision,
        document: s.document,
        publishedVersionId: null,
      },
      session: s.session,
      selected: s.selected,
    };
    await get().open(
      {
        projectId: s.projectId,
        sceneId: record.document.document.sceneId,
        revision: record.revision,
        document: record.document.document,
        publishedVersionId: null,
      },
      true,
    );
    set({
      editingLibrary: {
        id: record.id,
        name: record.name,
        rootLocalId: record.document.rootLocalId,
        metadata: record.document,
      },
    });
  },
  async returnToScene() {
    if (!suspendedScene) return;
    await get().save();
    if (get().saveState !== "saved") throw Error("模板未保存，当前编辑已保留");
    const resume = suspendedScene;
    await get().open(resume.draft, true, resume.session);
    set({
      selected: resume.selected,
      editingLibrary: null,
    });
    suspendedScene = null;
  },
  session: null,
  document: null,
  runtime: null,
  projectId: "",
  revision: 0,
  selected: [],
  editingPoint: null,
  pointPreview: null,
  transforms: {},
  tool: "select",
  space: "world",
  snap: false,
  mode: "edit",
  placingAnnotation: "",
  contextMenu: null,
  dragging: false,
  cancelTool: null,
  commandPanel: null,
  saveState: "saved",
  message: "",
  issues: {},
  busy: "",
  projects: [],
  recovery: null,
  view: null,
  activeRuleId: "",
  activeTourId: "",
  activeContentId: "",
  uiLayoutId: "hud-default",
  uiSelected: [],
  placingHotspot: false,
  pickEntity: null,
  set,
  command(command) {
    const state = get();
    if (state.mode === "play" || !state.session) return false;
    try {
      state.session.execute(command);
      set({ message: "" });
      return true;
    } catch (error) {
      set({ message: error instanceof Error ? error.message : String(error) });
      return false;
    }
  },
  select(ids, add = false) {
    const picked = get().pickEntity;
    if (picked && ids[0]) {
      set({ pickEntity: null });
      picked(ids[0]);
      return;
    }
    set({
      activeRuleId: "",
      activeContentId: "",
      editingPoint: null,
      pointPreview: null,
      selected: add ? [...new Set([...get().selected, ...ids])] : ids,
    });
    get().runtime?.selectionChanged(get().selected);
  },
  close() {
    get().previewController?.dispose();
    scratchSession?.unsubscribe();
    scratchSession = null;
    suspendedScene = null;
    set({
      editingLibrary: null,
      scratchActive: false,
      domainTool: "",
      draggingPrefab: null,
      previewController: null,
      historyTarget: null,
      activeDocumentSave: null,
    });
    clearTimeout(saveTimer);
    unsubscribe?.();
    unsubscribe = undefined;
    sessionGeneration++;
    get().cancelTool?.();
    get().runtime?.unloadScene();
    set({
      session: null,
      document: null,
      projectId: "",
      revision: 0,
      selected: [],
      editingPoint: null,
      pointPreview: null,
      transforms: {},
      mode: "edit",
      placingAnnotation: "",
      placingHotspot: false,
      pickEntity: null,
      saveState: "saved",
      issues: {},
      recovery: null,
      message: "",
    });
  },
  async open(draft, restore = false, resumeSession) {
    get().previewController?.dispose();
    scratchSession?.unsubscribe();
    scratchSession = null;
    set({
      scratchActive: false,
      domainTool: "",
      draggingPrefab: null,
      previewController: null,
      historyTarget: null,
      activeDocumentSave: null,
    });
    const local = restore ? undefined : await localDraft(draft.sceneId);
    clearTimeout(saveTimer);
    unsubscribe?.();
    sessionGeneration++;
    const session = resumeSession ?? new EditorSession(draft.document);
    set({
      session,
      editingLibrary: null,
      document: session.document,
      projectId: draft.projectId,
      revision: draft.revision,
      selected: [],
      editingPoint: null,
      pointPreview: null,
      transforms: {},
      saveState: "saved",
      message: "",
      issues: {},
      recovery:
        local?.dirty &&
        JSON.stringify(local.document) !== JSON.stringify(draft.document)
          ? local
          : null,
      mode: "edit",
    });
    unsubscribe = session.subscribe((change, label) => {
      set({
        document: change.after,
        releaseReport: null,
        saveState: get().saveState === "conflict" ? "conflict" : "dirty",
      });
      void get()
        .runtime?.applyChangeSet(change)
        .catch((error) => set({ message: "运行同步失败：" + String(error) }));
      void journal(
        {
          sceneId: draft.sceneId,
          revision: get().revision,
          document: change.after,
          label,
          committedAt: new Date().toISOString(),
          dirty: true,
        },
        !change.sceneReplaced,
        change.patches,
        change.before,
      ).catch((error) =>
        set({ message: "本地恢复记录失败: " + String(error) }),
      );
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => void get().save(), 1200);
    });
    await get().runtime?.setMode("edit");
    await get().runtime?.loadDocument(session.document);
    get().view?.reset(false);
    if (
      local?.dirty &&
      JSON.stringify(local.document) !== JSON.stringify(draft.document) &&
      !restore
    )
      set({
        recovery: local,
        message: "发现未同步的本地事务，可恢复或另存工程",
      });
    if (restore)
      await journal(
        {
          sceneId: draft.sceneId,
          revision: draft.revision,
          document: draft.document,
          label: "读取云端草稿",
          committedAt: new Date().toISOString(),
          dirty: false,
        },
        false,
      );
    localStorage.setItem("studio-last-scene", draft.sceneId);
  },
  async save() {
    if (get().scratchActive) throw Error("请先录制或放弃试摆，再保存作者文档");
    const generation = sessionGeneration;
    const perform = async () => {
      const state = get();
      if (
        !state.document ||
        !state.session ||
        state.saveState === "conflict" ||
        generation !== sessionGeneration ||
        state.saveState === "saved"
      )
        return;
      const snapshot = state.document;
      const revision = state.revision;
      set({ saveState: "saving" });
      try {
        const target = state.editingLibrary;
        const saved = await request<{ revision: number }>(
          target
            ? "/library/prefab/" + target.id
            : "/scenes/" + snapshot.sceneId + "/draft",
          {
            method: "PUT",
            body: JSON.stringify({
              expectedRevision: revision,
              ...(target
                ? {
                    name: snapshot.name,
                    document: {
                      ...target.metadata,
                      rootLocalId: target.rootLocalId,
                      document: sourceDocument(snapshot),
                    },
                  }
                : { document: sourceDocument(snapshot) }),
            }),
          },
        );
        if (generation !== sessionGeneration) return;
        set({
          revision: saved.revision,
          saveState: get().document === snapshot ? "saved" : "dirty",
          message: "",
        });
        await journal(
          {
            sceneId: snapshot.sceneId,
            revision: saved.revision,
            document: get().document!,
            label: "云端保存",
            committedAt: new Date().toISOString(),
            dirty: get().document !== snapshot,
          },
          false,
        );
        if (get().saveState === "dirty") {
          clearTimeout(saveTimer);
          saveTimer = setTimeout(() => void get().save(), 100);
        }
      } catch (error) {
        if (generation !== sessionGeneration) return;
        set({
          saveState:
            error instanceof ApiError && error.status === 409
              ? "conflict"
              : "offline",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };
    saveQueue = saveQueue.catch(() => {}).then(perform);
    await saveQueue;
  },
  async refreshProjects() {
    set({ projects: await request<Project[]>("/projects") });
  },
  async switchMode() {
    const state = get();
    if (state.previewController && state.mode === "play") {
      await state.previewController.stop();
      return;
    }
    if (!state.runtime) return;
    const mode = state.mode === "edit" ? "play" : "edit";
    state.view?.setEnabled(mode === "edit");
    try {
      await state.runtime.setMode(mode);
      if (mode === "edit" && window.document.fullscreenElement)
        await window.document.exitFullscreen();
      set({
        mode,
        editingPoint: null,
        pointPreview: null,
        placingHotspot: false,
        placingAnnotation: "",
        pickEntity: null,
      });
    } catch (error) {
      state.view?.setEnabled(state.mode === "edit");
      throw error;
    }
  },
  async run(label, action) {
    if (get().busy) return;
    set({ busy: label, message: "" });
    try {
      await action();
    } catch (error) {
      set({
        message:
          error instanceof ApiError
            ? [error.message, ...error.details].join("\n")
            : error instanceof Error
              ? error.message
              : String(error),
      });
    } finally {
      set({ busy: "" });
    }
  },
}));
export async function newProject(name: string): Promise<void> {
  const document = createDocument(name);
  const draft = await request<CloudDraft>("/projects", {
    method: "POST",
    body: JSON.stringify({ name, document }),
  });
  await useStudio.getState().open(draft);
  await useStudio.getState().refreshProjects();
}
