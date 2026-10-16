import * as THREE from "three";
import { createComponent, createEntity } from "@studio/scene-schema";
import { addEntity } from "@studio/editor-core";
import {
  extensionPanels,
  extensionTools,
} from "../../../../packages/extensions/editor";
import {
  CommandRegistry,
  ShortcutManager,
  focusScope,
  type CommandContext,
} from "@studio/editor-core";
import { deleteEntities, duplicateEntities } from "@studio/editor-core";
import { useStudio } from "../state/studio";
import { usePreferences } from "./preferences";
import { useConsoleLayout } from "./layout";
import { windows, layoutPresets, workspaceWindow } from "./windows";
export const commands = new CommandRegistry();
const abort = new AbortController();
export function context(): CommandContext {
  const s = useStudio.getState();
  return {
    surface: focusScope(document.activeElement),
    owner: focusScope(document.activeElement) === "viewport" ? useConsoleLayout.getState().viewportContext : useConsoleLayout.getState().activeWindow,
    editingAllowed: s.mode === "edit" && !s.busy && Boolean(s.document),
    selectedIds: s.selected,
    flying: Boolean(s.view?.isFlying),
    dragging: s.dragging || Boolean(s.runtime?.isInteracting),
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
commands.register({
  id: "studio.readiness",
  title: "发布检查",
  shortcuts: [],
  category: "工程",
  scope: "global",
  enabled: edit,
  execute: () => useStudio.getState().checkReadiness(),
});
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
viewport("panel.inspector", "属性面板", ["I"], () => useConsoleLayout.getState().toggle("properties"));
viewport("panel.assets", "资源库", ["B"], () => useConsoleLayout.getState().toggle("resources"));
viewport("panel.rail", "任务图标轨", ["Alt+`"], () => useConsoleLayout.getState().patch({ rail: !useConsoleLayout.getState().rail }));
viewport("view.focus", "专注模式", ["Space"], () => useConsoleLayout.getState().patch({ focus: !useConsoleLayout.getState().focus }));
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
        useConsoleLayout.getState().patch({ focus: true });
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
] as [number, string, string][])
  viewport("workspace." + workspace, title, [String(index)], () => {
    useStudio.getState().set({
      domainTool: "",
      placingHotspot: false,
      pickEntity: null,
    });
    useConsoleLayout.getState().open(workspaceWindow(workspace));
  });
commands.register({
  id: "document.save",
  title: "保存工程",
  category: "工程",
  scope: "global",
  shortcuts: ["Mod+S"],
  allowInTextInput: true,
  allowDuringNavigation: true,
  commitText: true,
  preventNativeWhenBlocked: true,
  enabled: () => Boolean(useStudio.getState().document),
  execute: async () => {
    const state = useStudio.getState();
    await state.save();
    if (state.activeDocumentSave) await state.activeDocumentSave();
  },
});
for (const [id, title, keys, run] of [
  [
    "undo",
    "撤销",
    ["Mod+Z"],
    () =>
      (
        useStudio.getState().historyTarget ?? useStudio.getState().session
      )?.undo(),
  ],
  [
    "redo",
    "重做",
    ["Mod+Y", "Mod+Shift+Z"],
    () =>
      (
        useStudio.getState().historyTarget ?? useStudio.getState().session
      )?.redo(),
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
      if (id === "undo")
        return Boolean((state.historyTarget ?? state.session)?.canUndo);
      if (id === "redo")
        return Boolean((state.historyTarget ?? state.session)?.canRedo);
      return (
        context.selectedIds.length > 0 &&
        context.selectedIds.every((selectedId) =>
          state.document?.entities.some(
            (entity) => entity.id === selectedId && !entity.locked,
          ),
        )
      );
    },
    execute: run,
  });
commands.register({
  id: "layout.restore",
  title: "恢复工作台布局",
  category: "工作台",
  scope: "global",
  execute: () => useConsoleLayout.getState().restore(),
});
commands.register({
  id: "palette.open",
  title: "搜索命令",
  category: "工作台",
  keywords: "mingling sousuo command search",
  scope: "global",
  shortcuts: ["Mod+."],
  allowInTextInput: true,
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
  allowInTextInput: true,
  allowInDialog: false,
  allowDuringNavigation: true,
  execute: () => {
    const state = useStudio.getState();
    const menu = document.querySelector("details[open].console-menu");
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
    if (document.pointerLockElement) {
      void document.exitPointerLock();
      return;
    }
    if (state.domainTool) {
      state.set({ domainTool: "" });
      return;
    }
    if (state.view?.cancelInteraction()) return;
    if (state.runtime?.cancelInteraction()) return;
    if (state.cancelTool?.()) return;
    if (
      state.pickEntity ||
      state.placingHotspot ||
      state.placingAnnotation ||
      state.editingPoint
    ) {
      state.set({
        pickEntity: null,
        placingHotspot: false,
        placingAnnotation: "",
        editingPoint: null,
      });
      return;
    }
    if (state.mode === "play") {
      void state.switchMode();
      return;
    }
    if (useConsoleLayout.getState().focus)
      useConsoleLayout.getState().patch({ focus: false });
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
    useStudio.getState().set({
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

for (const panel of extensionPanels)
  if (panel.workspace)
    commands.register({
      id: "workspace." + panel.workspace.id,
      title: panel.workspace.title,
      category: "工作空间",
      scope: "global",
      shortcuts: [],
      enabled: edit,
      execute: () => {
        useStudio.getState().set({
          domainTool: "",
          placingHotspot: false,
          pickEntity: null,
        });
        useConsoleLayout.getState().open("extension." + panel.id);
      },
    });

for (const item of windows) commands.register({
  id: "window." + item.id,
  title: "打开 " + item.title,
  keywords: item.group + " window panel chuangkou",
  category: "窗口 / " + item.group,
  scope: "global",
  execute: () => useConsoleLayout.getState().open(item.id),
});
for (const preset of layoutPresets) commands.register({
  id: "layout." + preset.id,
  title: preset.title + "布局",
  category: "窗口布局",
  keywords: preset.description,
  scope: "global",
  execute: () => useConsoleLayout.getState().restore(preset.id),
});
for (const [id, title] of [["float", "浮动当前工具窗口"], ["dock", "停靠当前工具窗口"], ["autoHide", "自动隐藏当前工具窗口"], ["close", "关闭当前工具窗口"]] as const) commands.register({
  id: "window." + id, title, category: "窗口", scope: "global",
  enabled: () => useConsoleLayout.getState().activeWindow !== "viewport",
  execute: () => { const state = useConsoleLayout.getState(); state[id](state.activeWindow); },
});
commands.register({
  id: "window.next", title: "切换到下一个窗口", category: "窗口", scope: "global", shortcuts: ["F6"], allowInTextInput: true,
  execute: () => {
    const state = useConsoleLayout.getState(), ids = state.api?.panels.filter(p => p.api.isVisible).map(p => p.id) ?? [];
    const id = ids[(ids.indexOf(state.activeWindow) + 1) % ids.length];
    if (id) state.open(id);
  },
});
commands.register({
  id: "window.previous", title: "切换到上一个窗口", category: "窗口", scope: "global", shortcuts: ["Shift+F6"], allowInTextInput: true,
  execute: () => {
    const state = useConsoleLayout.getState(), ids = state.api?.panels.filter(p => p.api.isVisible).map(p => p.id) ?? [];
    const id = ids[(ids.indexOf(state.activeWindow) + ids.length - 1) % ids.length];
    if (id) state.open(id);
  },
});

for (const [id, title, component] of [["node", "新增节点", ""], ["light", "创建灯光", "Light"]]) commands.register({
  id: "create." + id, title, category: "创建", scope: "editor", enabled: edit,
  execute: () => {
    const state = useStudio.getState(), parentId = state.selected[0] ?? null;
    const entity = createEntity(component ? "灯光" : "新节点", parentId);
    const parent = parentId ? state.runtime?.getObject(parentId) : undefined;
    if (parent) {
      const bounds = new THREE.Box3().setFromObject(parent);
      if (!bounds.isEmpty()) entity.transform.position = parent.worldToLocal(bounds.getCenter(new THREE.Vector3())).toArray();
    }
    if (component) entity.components.push(createComponent(component));
    state.command(addEntity(entity)); state.select([entity.id]);
  },
});
commands.register({ id: "create.hotspot", title: "在视口放置热点", category: "创建", scope: "editor", enabled: edit, execute: () => {
  useConsoleLayout.getState().open("content");
  useStudio.getState().set({ placingHotspot: true });
  useConsoleLayout.getState().open("viewport");
} });
