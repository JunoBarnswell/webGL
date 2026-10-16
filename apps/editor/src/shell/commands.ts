import { extensionTools } from "../../../../packages/extensions/editor";
import {
  CommandRegistry,
  ShortcutManager,
  focusScope,
  type CommandContext,
} from "@studio/editor-core";
import { deleteEntities, duplicateEntities } from "@studio/editor-core";
import { useStudio, type Workspace } from "../state/studio";
import { usePreferences } from "./preferences";
export const commands = new CommandRegistry();
const abort = new AbortController();
export function context(): CommandContext {
  const s = useStudio.getState();
  return {
    surface: focusScope(document.activeElement),
    editingAllowed: s.mode === "edit" && !s.busy && Boolean(s.document),
    selectedIds: s.selected,
    flying: Boolean(s.view?.isFlying),
    dragging: s.dragging,
    signal: abort.signal,
  };
}
export function execute(id: string): void {
  void commands
    .execute(id, context())
    .then((ok) => {
      if (!ok) useStudio.getState().set({ message: "当前状态不可执行此命令" });
    })
    .catch((error) => useStudio.getState().set({ message: String(error) }));
}
const edit = (c: CommandContext) => c.editingAllowed;
const viewport = (
  id: string,
  title: string,
  keys: string[],
  run: () => void,
  enabled = edit,
) =>
  commands.register({
    id,
    title,
    shortcuts: keys,
    category: "视口",
    scope: "viewport",
    enabled,
    execute: run,
  });
for (const [key, tool, title] of [
  ["Q", "select", "选择"],
  ["W", "translate", "移动"],
  ["E", "rotate", "旋转"],
  ["R", "scale", "缩放"],
] as const)
  viewport("tool." + tool, title, [key], () =>
    useStudio.getState().set({ tool, editingPoint: null, pointPreview: null }),
  );
viewport("view.selection", "聚焦选中", ["F"], () =>
  useStudio.getState().view?.focus(useStudio.getState().selected),
);
viewport("view.all", "聚焦场景", ["Shift+F"], () =>
  useStudio.getState().view?.focus([]),
);
viewport("view.grid", "隐藏 / 显示网格", ["G"], () =>
  usePreferences.getState().patch({ grid: !usePreferences.getState().grid }),
);
viewport("view.space", "切换世界 / 局部坐标", ["L"], () =>
  useStudio
    .getState()
    .set({ space: useStudio.getState().space === "world" ? "local" : "world" }),
);
viewport("view.snap", "切换吸附", ["Shift+S"], () =>
  useStudio.getState().set({ snap: !useStudio.getState().snap }),
);
viewport("panel.inspector", "属性面板", ["I"], () =>
  useStudio
    .getState()
    .set({ inspectorOpen: !useStudio.getState().inspectorOpen }),
);
viewport("panel.assets", "资源库", ["B"], () =>
  useStudio.getState().set({ assetsOpen: !useStudio.getState().assetsOpen }),
);
viewport("panel.rail", "任务图标轨", ["Alt+`"], () =>
  usePreferences.getState().patch({ rail: !usePreferences.getState().rail }),
);
viewport("view.focus", "专注模式", ["Space"], () =>
  usePreferences.getState().toggleFocus(),
);
viewport(
  "view.fullscreen",
  "视口全屏",
  ["Shift+Enter"],
  () => {
    const host = document.querySelector<HTMLElement>(".viewport-panel");
    if (!host) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else
      void host.requestFullscreen().catch(() => {
        usePreferences.getState().patch({ layout: "focus" });
        useStudio
          .getState()
          .set({ message: "浏览器未允许全屏，已切换专注模式" });
      });
  },
  () => true,
);
viewport(
  "view.preview",
  "进入 / 退出预览",
  ["P"],
  () => {
    void useStudio
      .getState()
      .run("切换预览", () => useStudio.getState().switchMode());
  },
  () => Boolean(useStudio.getState().document),
);
for (const [index, workspace, title] of [
  [1, "scene", "场景搭建"],
  [2, "content", "热点内容"],
  [3, "tour", "导览巡航"],
  [4, "interaction", "事件交互"],
  [5, "interface", "界面设计"],
] as [number, Workspace, string][])
  viewport("workspace." + workspace, title, [String(index)], () => {
    useStudio
      .getState()
      .set({ workspace, placingHotspot: false, pickEntity: null });
    usePreferences.getState().patch({ leftOpen: true });
  });
commands.register({
  id: "document.save",
  title: "保存工程",
  category: "工程",
  scope: "global",
  shortcuts: ["Mod+S"],
  enabled: () => Boolean(useStudio.getState().document),
  execute: () => useStudio.getState().save(),
});
for (const [id, title, keys, run] of [
  ["undo", "撤销", ["Mod+Z"], () => useStudio.getState().session?.undo()],
  [
    "redo",
    "重做",
    ["Mod+Y", "Mod+Shift+Z"],
    () => useStudio.getState().session?.redo(),
  ],
  [
    "duplicate",
    "复制实体",
    ["Mod+D"],
    () =>
      useStudio
        .getState()
        .command(duplicateEntities(useStudio.getState().selected)),
  ],
  [
    "delete",
    "删除实体",
    ["Delete"],
    () => {
      useStudio
        .getState()
        .command(deleteEntities(useStudio.getState().selected));
      useStudio.getState().select([]);
    },
  ],
] as [string, string, string[], () => void][])
  commands.register({
    id: "document." + id,
    title,
    category: "编辑",
    scope: "editor",
    shortcuts: keys,
    enabled: (context) => {
      if (!edit(context)) return false;
      const state = useStudio.getState();
      if (id === "undo") return Boolean(state.session?.canUndo);
      if (id === "redo") return Boolean(state.session?.canRedo);
      return context.selectedIds.length > 0 && context.selectedIds.every(selectedId => state.document?.entities.some(entity => entity.id === selectedId && !entity.locked));
    },
    execute: run,
  });
commands.register({
  id: "layout.restore",
  title: "恢复工作台布局",
  category: "工作台",
  scope: "global",
  execute: () => {
    usePreferences.getState().restore();
    useStudio
      .getState()
      .set({
        inspectorOpen: false,
        assetsOpen: false,
        layoutEpoch: useStudio.getState().layoutEpoch + 1,
      });
  },
});
commands.register({
  id: "palette.open",
  title: "搜索命令",
  category: "工作台",
  keywords: "mingling sousuo command search",
  scope: "global",
  shortcuts: ["Mod+."],
  execute: () => useStudio.getState().set({ commandPanel: "search" }),
});
commands.register({
  id: "shortcuts.open",
  title: "快捷键设置与帮助",
  category: "工作台",
  scope: "global",
  shortcuts: ["Shift+?", "Shift+/"],
  execute: () => useStudio.getState().set({ commandPanel: "shortcuts" }),
});
commands.register({
  id: "cancel",
  title: "取消 / 退出",
  category: "工作台",
  scope: "global",
  shortcuts: ["Escape"],
  execute: () => {
    const state = useStudio.getState();
    const menu = document.querySelector("details[open].file-menu");
    if (menu) {
      menu.removeAttribute("open");
      return;
    }
    if (state.contextMenu) {
      state.set({ contextMenu: null });
      return;
    }
    if (state.commandPanel) {
      state.set({ commandPanel: null });
      return;
    }
    if (state.cancelTool?.()) return;
    if (state.pickEntity || state.placingHotspot || state.editingPoint) {
      state.set({
        pickEntity: null,
        placingHotspot: false,
        editingPoint: null,
      });
      return;
    }
    if (state.mode === "play") {
      void state.switchMode();
      return;
    }
    if (usePreferences.getState().layout === "focus")
      usePreferences.getState().toggleFocus();
  },
});
export const shortcuts = new ShortcutManager(
  commands,
  context,
  () => usePreferences.getState().bindings,
  () => usePreferences.getState().characterKeys,
  (message) => useStudio.getState().set({ message }),
);

for (const tool of extensionTools)
  commands.register({
    id: "extension." + tool.id,
    title: tool.title,
    category: "扩展工具",
    scope: "editor",
    enabled: (c) => c.editingAllowed && c.selectedIds.length > 0,
    execute: () => {
      const state = useStudio.getState();
      if (state.document)
        state.command(tool.create(state.document, state.selected));
    },
  });

viewport("context.open", "对象操作", ["Shift+F10"], () => {
  const rect = document.querySelector("canvas")?.getBoundingClientRect();
  if (rect)
    useStudio
      .getState()
      .set({
        contextMenu: {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        },
      });
});

viewport(
  "view.statistics",
  "性能面板",
  [],
  () =>
    usePreferences
      .getState()
      .patch({ statistics: !usePreferences.getState().statistics }),
  () => true,
);
