import { create } from "zustand";
import {
  createDocument,
  type SceneDocument,
  type Transform,
  type Vec3,
} from "@studio/scene-schema";
import { EditorSession, type EditorCommand } from "@studio/editor-core";
import type { SceneRuntime } from "@studio/scene-runtime";
import type { EditorCamera } from "../panels/EditorCamera";
import { ApiError, request, type CloudDraft, type Project } from "./api";
import { journal, localDraft, type JournalEntry } from "./journal";

export interface EditingPoint {
  viewpointId: string;
  property: "position" | "target";
}
export type Workspace =
  | "scene"
  | "content"
  | "tour"
  | "interaction"
  | "interface";
type SaveState = "saved" | "dirty" | "saving" | "offline" | "conflict";
interface StudioState {
  session: EditorSession | null;
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
  workspace: Workspace;
  assetsOpen: boolean;
  inspectorOpen: boolean;
  view: EditorCamera | null;
  activeRuleId: string;
  activeTourId: string;
  activeContentId: string;
  uiLayoutId: string;
  uiSelected: string[];
  placingHotspot: boolean;
  pickEntity: ((id: string) => void) | null;
  contextMenu: { x: number; y: number } | null;
  dragging: boolean;
  cancelTool: (() => boolean) | null;
  commandPanel: "search" | "shortcuts" | null;
  projects: Project[];
  recovery: JournalEntry | null;
  layoutEpoch: number;
  set: (patch: Partial<StudioState>) => void;
  command: (command: EditorCommand) => void;
  select: (ids: string[], add?: boolean) => void;
  open: (draft: CloudDraft, restore?: boolean) => Promise<void>;
  close: () => void;
  save: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  switchMode: () => Promise<void>;
  run: (label: string, action: () => Promise<void>) => Promise<void>;
}
let unsubscribe: (() => void) | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saveQueue = Promise.resolve();
let sessionGeneration = 0;
export const useStudio = create<StudioState>((set, get) => ({
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
  layoutEpoch: 0,
  workspace: "scene",
  assetsOpen: false,
  inspectorOpen: false,
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
    if (state.mode === "play") return;
    try {
      state.session?.execute(command);
    } catch (error) {
      set({ message: error instanceof Error ? error.message : String(error) });
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
  },
  close() {
    clearTimeout(saveTimer);
    unsubscribe?.();
    unsubscribe = undefined;
    sessionGeneration++;
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
      saveState: "saved",
      issues: {},
      recovery: null,
      message: "",
    });
  },
  async open(draft, restore = false) {
    const local = restore ? undefined : await localDraft(draft.sceneId);
    clearTimeout(saveTimer);
    unsubscribe?.();
    sessionGeneration++;
    const session = new EditorSession(draft.document);
    set({
      session,
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
        const saved = await request<CloudDraft>(
          "/scenes/" + snapshot.sceneId + "/draft",
          {
            method: "PUT",
            body: JSON.stringify({
              expectedRevision: revision,
              document: snapshot,
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
    if (!state.runtime) return;
    const mode = state.mode === "edit" ? "play" : "edit";
    state.view?.setEnabled(mode === "edit" && state.workspace !== "interface");
    try {
      await state.runtime.setMode(mode);
      if (mode === "edit" && window.document.fullscreenElement)
        await window.document.exitFullscreen();
      set({
        mode,
        editingPoint: null,
        pointPreview: null,
        placingHotspot: false,
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
