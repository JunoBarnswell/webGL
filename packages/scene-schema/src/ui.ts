import type { ContentItem, UiDocument, UiKind, UiNode, UiStyle } from "./types";

export const uiKindLabels: Record<UiKind, string> = {
  configurator: "产品配置器",
  storyboard: "故事板播放",
  industrial: "工业审阅",
  projectNavigation: "项目漫游",
  text: "文字",
  image: "图片",
  icon: "图标",
  shape: "形状",
  container: "容器",
  button: "按钮",
  list: "内容列表",
  slider: "滑杆",
  toggle: "开关",
  tourControls: "巡航控制",
  viewpointList: "展区导航",
  audioControls: "音频控制",
  animationControls: "动画控制",
  viewMode: "人称切换",
  displayMode: "展示分层",
  panoramaControls: "全景控制",
  movement: "移动控制",
  loading: "加载进度",
  entry: "进入展厅",
};
export const defaultUiStyle: UiStyle = {
  x: 0,
  y: 0,
  width: 180,
  height: 48,
  rotation: 0,
  zIndex: 0,
  color: "var(--player-text)",
  background: "transparent",
  fontSize: 14,
  fontFamily: "inherit",
  fontWeight: 400,
  textAlign: "left",
  borderColor: "transparent",
  borderWidth: 0,
  borderRadius: 10,
  shadow: "none",
  opacity: 1,
  padding: 8,
  gap: 10,
  position: "absolute",
  layout: "free",
  align: "center",
  justify: "start",
  objectFit: "contain",
  overflow: "visible",
  anchor: "top-left",
  animation: "none",
  hidden: false,
};
export function createUiNode(
  kind: UiKind,
  layoutId: string,
  patch: Partial<UiNode> = {},
): UiNode {
  return {
    id: crypto.randomUUID(),
    name: uiKindLabels[kind],
    kind,
    layoutId,
    parentId: null,
    text: uiKindLabels[kind],
    assetId: "",
    targetId: "",
    binding: "",
    style: { ...defaultUiStyle },
    tablet: {},
    mobile: {},
    action: null,
    ...patch,
  };
}
export function createContent(title = "新内容"): ContentItem {
  return {
    id: crypto.randomUUID(),
    name: title,
    title,
    body: "",
    imageAssetId: "",
    audioEntityId: "",
    layoutId: "content-default",
  };
}
export function createUiDocument(): UiDocument {
  const ui: UiDocument = {
    theme: {
      accent: "#64d6b7",
      background: "#15202b",
      text: "#eff6fa",
      fontFamily: 'Inter, "Microsoft YaHei", sans-serif',
    },
    layouts: [
      {
        id: "hud-default",
        name: "展厅界面",
        scope: "hud",
        width: 1440,
        height: 900,
        presentation: "modal",
      },
      {
        id: "content-default",
        name: "作品详情",
        scope: "content",
        width: 720,
        height: 600,
        presentation: "modal",
      },
      {
        id: "entry-default",
        name: "欢迎进入",
        scope: "entry",
        width: 1440,
        height: 900,
        presentation: "modal",
      },
      {
        id: "loading-default",
        name: "加载画面",
        scope: "loading",
        width: 1440,
        height: 900,
        presentation: "modal",
      },
    ],
    nodes: [],
  };
  const add = (
    kind: UiKind,
    layoutId: string,
    id: string,
    style: Partial<UiStyle>,
    patch: Partial<UiNode> = {},
  ) => {
    const node = createUiNode(kind, layoutId, {
      ...patch,
      id,
      style: { ...defaultUiStyle, ...style },
    });
    ui.nodes.push(node);
    return node;
  };
  add(
    "text",
    "hud-default",
    "hud-title",
    {
      x: 20,
      y: 18,
      width: 420,
      height: 48,
      fontSize: 18,
      fontWeight: 600,
      background: "var(--player-background)",
    },
    {
      binding: "scene.name",
      mobile: { x: 12, y: 12, width: "94%", fontSize: 16 },
    },
  );
  const bar = add(
    "container",
    "hud-default",
    "hud-controls",
    {
      x: 18,
      y: 18,
      width: "auto",
      height: "auto",
      anchor: "bottom-left",
      layout: "row",
      padding: 12,
      gap: 10,
      background: "var(--player-background)",
      overflow: "auto",
    },
    {
      name: "业务工具栏",
      mobile: { width: "94%", layout: "column", gap: 6, height: 260 },
    },
  );
  for (const kind of [
    "tourControls",
    "viewpointList",
    "viewMode",
    "displayMode",
    "audioControls",
    "animationControls",
    "panoramaControls",
  ] as const)
    add(
      kind,
      "hud-default",
      "hud-" + kind,
      { position: "flow", width: "auto", height: "auto" },
      { parentId: bar.id },
    );
  add(
    "movement",
    "hud-default",
    "hud-movement",
    {
      x: 18,
      y: 140,
      width: 150,
      height: 110,
      anchor: "bottom-right",
      background: "var(--player-background)",
    },
    { tablet: {}, mobile: { y: 300, width: 132, height: 100 } },
  );
  const body = add(
    "container",
    "content-default",
    "content-layout",
    { width: "fill", height: "auto", layout: "column", padding: 0, gap: 14 },
    { name: "作品详情布局" },
  );
  const child = { parentId: body.id };
  add(
    "text",
    "content-default",
    "content-title",
    {
      position: "flow",
      width: "fill",
      height: "hug",
      fontSize: 24,
      fontWeight: 600,
    },
    { ...child, binding: "content.title" },
  );
  add(
    "image",
    "content-default",
    "content-cover",
    { position: "flow", width: "fill", height: 330 },
    { ...child, binding: "content.image", mobile: { height: 220 } },
  );
  add(
    "text",
    "content-default",
    "content-body",
    { position: "flow", width: "fill", height: "hug", fontSize: 15 },
    { ...child, binding: "content.body" },
  );
  add(
    "audioControls",
    "content-default",
    "content-audio",
    { position: "flow", width: "fill", height: "auto" },
    { ...child, binding: "content.audio" },
  );
  add("entry", "entry-default", "entry-button", {
    x: 0,
    y: 0,
    width: 300,
    height: 110,
    anchor: "center",
    background: "var(--player-background)",
    fontSize: 20,
  });
  add("loading", "loading-default", "loading-progress", {
    x: 0,
    y: 0,
    width: 340,
    height: 120,
    anchor: "center",
    background: "var(--player-background)",
  });
  return ui;
}
