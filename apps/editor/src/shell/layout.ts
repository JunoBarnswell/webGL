import { create } from "zustand";
import { DockviewGroupPanel, type DockviewApi, type SerializedDockview } from "dockview";
import { layoutPresets, windowById, type PresetId } from "./windows";

export function presetLayout(presetId: PresetId, width: number, height: number, narrow = width < 820): SerializedDockview {
  const preset = layoutPresets.find((item) => item.id === presetId)!;
  const ids = ["viewport", ...preset.left, ...preset.right, ...preset.bottom, ...preset.documents];
  const panels: SerializedDockview["panels"] = Object.fromEntries(ids.map((id) => [id, { id, title: windowById.get(id)!.title, contentComponent: "console", renderer: "always", ...(id === "viewport" ? { tabComponent: "viewport" } : {}) }]));
  const leaf = (id: string, views: readonly string[], size: number) => ({ type: "leaf" as const, data: { id, views: [...views], activeView: views[0] }, size });
  const centerWidth = Math.max(320, width - (preset.left.length ? 260 : 0) - (preset.right.length ? 310 : 0));
  const center = preset.bottom.length ? {
    type: "branch" as const, size: centerWidth,
    data: [leaf("documents", ["viewport", ...preset.documents], Math.max(200, height - 255)), leaf("bottom", preset.bottom, 255)],
  } : leaf("documents", ["viewport", ...preset.documents], centerWidth);
  return { grid: { width, height, orientation: "HORIZONTAL" as SerializedDockview["grid"]["orientation"], root: { type: "branch", data: narrow ? [leaf("documents", ids, width)] : [...(preset.left.length ? [leaf("left", preset.left, 260)] : []), center, ...(preset.right.length ? [leaf("right", preset.right, 310)] : [])] } }, panels, activeGroup: "documents" };
}
export function compactLayout(layout: SerializedDockview, width: number, height: number): SerializedDockview {
  const value = structuredClone(layout);
  value.grid = { width, height, orientation: "HORIZONTAL" as SerializedDockview["grid"]["orientation"], root: { type: "branch", data: [{ type: "leaf", data: { id: "documents", views: Object.keys(value.panels), activeView: "viewport" }, size: width }] } };
  value.activeGroup = "documents";
  delete value.edgeGroups;
  delete value.floatingGroups;
  return value;
}

const storageKey = "studio-console-layout";
export interface SavedConsoleLayout {
  name: string;
  layout: SerializedDockview;
}
interface ConsoleLayoutState {
  api: DockviewApi | null;
  layout: SerializedDockview | null;
  preset: PresetId;
  activeWindow: string;
  viewportContext: string;
  viewportVisible: boolean;
  openWindows: string[];
  dirtyWindows: Record<string, boolean>;
  focus: boolean;
  rail: boolean;
  category: "create" | "modify" | "hierarchy" | "motion" | "display" | "utilities";
  density: "comfortable" | "compact";
  tools: string[];
  saved: SavedConsoleLayout[];
  notice: string;
  revision: number;
  patch: (patch: Partial<ConsoleLayoutState>) => void;
  open: (id: string) => void;
  close: (id: string) => void;
  toggle: (id: string) => void;
  restore: (preset?: PresetId) => void;
  float: (id: string) => void;
  dock: (id: string) => void;
  autoHide: (id: string) => void;
  importLayout: (value: unknown) => void;
  saveLayout: (name: string) => void;
}

export function assertConsoleLayout(value: unknown): asserts value is SerializedDockview {
  if (!value || typeof value !== "object") throw Error("布局必须为窗口配置对象");
  const layout = value as SerializedDockview;
  if (layout.grid?.root?.type !== "branch" || !Number.isFinite(layout.grid.width) || !Number.isFinite(layout.grid.height) || !layout.panels || !layout.panels.viewport)
    throw Error("布局缺少网格或持久视口");
  if (layout.popoutGroups?.length) throw Error("布局不接受外部浏览器窗口，请先停靠回控制台");
  if (Object.keys(layout.panels).length > windowById.size) throw Error("布局窗口数量超出注册表");
  for (const [id, panel] of Object.entries(layout.panels)) {
    if (!windowById.has(id) || panel.id !== id || panel.contentComponent !== "console" || panel.params || panel.renderer !== "always" || panel.tabComponent && (id !== "viewport" || panel.tabComponent !== "viewport"))
      throw Error("布局包含未注册窗口或非布局数据：" + id);
  }
  const referenced = new Set<string>();
  const inspect = (node: unknown, depth: number, allowEmpty = false) => {
    if (!node || typeof node !== "object" || depth > 12) throw Error("布局网格层级无效");
    const item = node as { type: string; data: unknown; size?: number };
    if (item.size !== undefined && (!Number.isFinite(item.size) || item.size < 0)) throw Error("布局尺寸无效");
    if (item.type === "branch" && Array.isArray(item.data)) { item.data.forEach((child) => inspect(child, depth + 1)); return; }
    const group = item.data as { id?: string; views?: unknown[]; activeView?: string };
    if (item.type !== "leaf" || !group || typeof group.id !== "string" || !Array.isArray(group.views) || !allowEmpty && !group.views.length) throw Error("布局分组无效");
    for (const id of group.views) {
      if (typeof id !== "string" || !layout.panels[id] || referenced.has(id)) throw Error("布局窗口引用缺失或重复：" + String(id));
      referenced.add(id);
    }
    if (group.activeView && !group.views.includes(group.activeView)) throw Error("激活标签不属于窗口组");
  };
  inspect(layout.grid.root, 0);
  for (const floating of layout.floatingGroups ?? []) {
    const before = referenced.has("viewport");
    if (floating.grid) inspect(floating.grid.root, 0);
    else if (floating.data) inspect({ type: "leaf", data: floating.data }, 0);
    else throw Error("浮动窗口分组无效");
    if (!before && referenced.has("viewport")) throw Error("场景视口必须保留在中央文档区");
  }
  for (const edge of Object.values(layout.edgeGroups ?? {})) {
    const before = referenced.has("viewport");
    if (edge?.group) inspect({ type: "leaf", data: edge.group }, 0, true);
    if (!before && referenced.has("viewport")) throw Error("场景视口必须保留在中央文档区");
  }
  if (referenced.size !== Object.keys(layout.panels).length) throw Error("布局存在未归组窗口");
  if (JSON.stringify(layout).length > 500_000) throw Error("布局文件过大");
}

let stored: Partial<ConsoleLayoutState> = {};
let notice = "";
try {
  const text = localStorage.getItem(storageKey);
  if (text) {
    const parsed = JSON.parse(text);
    if (parsed.layout) assertConsoleLayout(parsed.layout);
    if (!Array.isArray(parsed.saved) || parsed.saved.length > 30) throw Error("私人布局清单无效");
    for (const item of parsed.saved) {
      if (typeof item.name !== "string") throw Error("私人布局名称无效");
      assertConsoleLayout(item.layout);
    }
    stored = parsed;
  } else {
    const old = JSON.parse(localStorage.getItem("studio-preferences-v2") ?? "{}");
    // Old preferences remain available for rollback; shortcut settings stay in Preferences.
    stored = { focus: old.layout === "focus", density: old.layout === "standard" ? "comfortable" : "compact" };
  }
} catch (error) {
  notice = "布局未能恢复，已使用展厅布局：" + String(error);
}
export const useConsoleLayout = create<ConsoleLayoutState>((set, get) => ({
  api: null,
  layout: stored.layout ?? null,
  preset: layoutPresets.some((item) => item.id === stored.preset) ? stored.preset! : "exhibition",
  activeWindow: "viewport",
  viewportContext: "scene",
  viewportVisible: true,
  openWindows: [],
  dirtyWindows: {},
  focus: stored.focus === true,
  rail: stored.rail !== false,
  category: "modify",
  density: stored.density === "comfortable" ? "comfortable" : "compact",
  tools: Array.isArray(stored.tools) ? stored.tools.filter((id): id is string => typeof id === "string").slice(0, 16) : ["tool.select", "tool.translate", "tool.rotate", "tool.scale", "view.selection", "view.snap", "view.space"],
  saved: stored.saved ?? [],
  notice,
  revision: 0,
  patch: (patch) => set(patch),
  open: (id) => {
    const definition = windowById.get(id), api = get().api;
    if (!definition || !api) throw Error("窗口未就绪：" + id);
    let panel = api.getPanel(id);
    if (!panel) {
      const sibling = api.panels.find((item) => item.id !== "viewport" && windowById.get(item.id)?.dock === definition.dock);
      const narrow = api.width < 820;
      panel = api.addPanel({
        id, component: "console", title: definition.title,
        tabComponent: id === "viewport" ? "viewport" : undefined,
        renderer: "always",
        position: sibling && !narrow ? { referencePanel: sibling, direction: "within" } : { referencePanel: "viewport", direction: narrow || definition.dock === "center" ? "within" : definition.dock === "bottom" ? "below" : definition.dock },
        initialWidth: definition.dock === "right" ? 330 : 280,
        initialHeight: 280,
      });
    }
    if (panel.api.location.type === "edge") panel.api.group.api.expand();
    panel.api.setActive();
    panel.api.getWindow().requestAnimationFrame(() => {
      const element = document.querySelector<HTMLElement>('[data-console-window="' + id + '"]');
      const focusTarget = id === "viewport" ? element?.querySelector<HTMLElement>("canvas") : element;
      focusTarget?.focus({ preventScroll: true });
    });
    set({ activeWindow: id });
  },
  close: (id) => { if (id !== "viewport") get().api?.getPanel(id)?.api.close(); },
  toggle: (id) => { if (get().api?.getPanel(id)) get().close(id); else get().open(id); },
  restore: (preset = "exhibition") => set({ preset, layout: null, focus: false, revision: get().revision + 1 }),
  float: (id) => {
    const api = get().api, panel = api?.getPanel(id);
    if (api && panel && id !== "viewport") {
      api.addFloatingGroup(panel, { x: 32, y: 32, width: Math.min(680, api.width - 40), height: Math.min(520, api.height - 40) });
      get().open(id);
    }
  },
  dock: (id) => {
    const api = get().api, panel = api?.getPanel(id), viewport = api?.getPanel("viewport");
    if (panel && viewport && id !== "viewport") {
      panel.api.moveTo({ group: viewport.group, position: "right" });
      panel.api.setSize({ width: 330 });
      get().open(id);
    }
  },
  autoHide: (id) => {
    const api = get().api, panel = api?.getPanel(id);
    if (!api || !panel || id === "viewport") return;
    const edge = windowById.get(id)?.dock === "left" ? "left" : windowById.get(id)?.dock === "bottom" ? "bottom" : "right";
    const group = api.getEdgeGroup(edge) ?? api.addEdgeGroup(edge, { id: "auto-" + edge, initialSize: edge === "bottom" ? 280 : 330, autoReveal: true });
    const target = api.getGroup(group.id);
    if (!(target instanceof DockviewGroupPanel)) throw Error("停靠分组未就绪：" + group.id);
    panel.api.moveTo({ group: target, position: "center" });
    group.collapse();
  },
  importLayout: (value) => {
    assertConsoleLayout(value);
    set({ layout: structuredClone(value), focus: false, revision: get().revision + 1 });
  },
  saveLayout: (name) => {
    name = name.trim().slice(0, 60);
    const api = get().api;
    if (!name || !api) throw Error("请输入布局名称");
    const layout = api.toJSON();
    assertConsoleLayout(layout);
    set({ saved: [...get().saved.filter((item) => item.name !== name), { name, layout }].slice(-30) });
  },
}));
useConsoleLayout.subscribe((state, previous) => {
  if (state.api === previous.api && state.layout === previous.layout && state.preset === previous.preset && state.focus === previous.focus && state.saved === previous.saved && state.tools === previous.tools && state.density === previous.density && state.rail === previous.rail) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify({ layout: state.layout, preset: state.preset, focus: state.focus, saved: state.saved, tools: state.tools, density: state.density, rail: state.rail }));
  } catch (error) {
    if (!state.notice) useConsoleLayout.setState({ notice: "窗口布局无法保存到此浏览器：" + String(error) });
  }
});
