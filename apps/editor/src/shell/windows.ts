import { extensionPanels } from "../../../../packages/extensions/editor";

export type WindowDock = "left" | "right" | "bottom" | "center";
export interface ConsoleWindow {
  id: string;
  title: string;
  kind: "tool" | "document" | "viewport";
  dock: WindowDock;
  group: string;
  context: "always" | "scene";
}
export const windows: readonly ConsoleWindow[] = [
  { id: "viewport", title: "透视 · 场景视口", kind: "viewport", dock: "center", group: "场景", context: "always" },
  { id: "scene", title: "场景资源管理器", kind: "tool", dock: "left", group: "场景", context: "scene" },
  { id: "resources", title: "资产浏览器", kind: "tool", dock: "left", group: "场景", context: "scene" },
  { id: "projects", title: "项目资源管理器", kind: "tool", dock: "left", group: "工程", context: "always" },
  { id: "properties", title: "命令面板", kind: "tool", dock: "right", group: "场景", context: "scene" },
  { id: "content", title: "热点与内容", kind: "tool", dock: "left", group: "展厅", context: "scene" },
  { id: "tour", title: "镜头与导览", kind: "tool", dock: "bottom", group: "展厅", context: "scene" },
  { id: "interaction", title: "行为设计器", kind: "document", dock: "center", group: "展厅", context: "scene" },
  { id: "interface", title: "Player 界面设计器", kind: "document", dock: "center", group: "展厅", context: "scene" },
  { id: "versions", title: "版本历史", kind: "tool", dock: "right", group: "工程", context: "scene" },
  { id: "problems", title: "问题与发布检查", kind: "tool", dock: "bottom", group: "诊断", context: "always" },
  { id: "output", title: "操作输出", kind: "tool", dock: "bottom", group: "诊断", context: "always" },
  { id: "jobs", title: "作业中心", kind: "tool", dock: "bottom", group: "诊断", context: "scene" },
  { id: "performance", title: "运行性能", kind: "tool", dock: "bottom", group: "诊断", context: "scene" },
  ...extensionPanels.map((panel): ConsoleWindow => ({
    id: "extension." + panel.id,
    title: panel.title,
    kind: ["virtual-tour", "configurator", "prefab"].includes(panel.id) ? "document" : "tool",
    dock: ["storyboard", "assembly"].includes(panel.id) ? "bottom" : panel.workspace ? "center" : "right",
    group: "专业设计器",
    context: "scene",
  })),
];
export const windowById = new Map(windows.map((item) => [item.id, item]));
export const workspaceWindow = (id: string) => windowById.has(id) ? id : "extension." + id;
export const layoutPresets = [
  { id: "exhibition", title: "展厅创作", description: "内容、镜头与场景，共用一个大视口", left: ["scene", "content"], right: ["properties"], bottom: [], documents: [] },
  { id: "professional", title: "3D 专业", description: "层级、资产与完整命令面板", left: ["scene", "resources"], right: ["properties"], bottom: ["extension.storyboard"], documents: [] },
  { id: "virtual-tour", title: "云展漫游", description: "项目图、全景、楼层与热点", left: ["projects", "scene"], right: ["properties"], bottom: ["tour"], documents: ["extension.virtual-tour"] },
  { id: "product", title: "产品配置", description: "产品规则、装配、BOM 与演示", left: ["scene", "resources"], right: ["properties"], bottom: ["extension.assembly", "extension.storyboard"], documents: ["extension.configurator"] },
  { id: "industrial", title: "工业审阅", description: "语义、剖切、测量与管网", left: ["scene"], right: ["properties", "extension.piping"], bottom: ["problems"], documents: ["extension.industrial"] },
  { id: "interface", title: "UI 与交互", description: "自由界面画布与行为规则", left: ["content"], right: [], bottom: ["output"], documents: ["interface", "interaction"] },
  { id: "presentation", title: "演示编排", description: "大视口、故事板与镜头", left: ["scene"], right: ["properties"], bottom: ["extension.storyboard", "tour"], documents: [] },
] as const;
export type PresetId = (typeof layoutPresets)[number]["id"];
