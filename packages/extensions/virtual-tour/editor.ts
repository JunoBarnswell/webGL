import type { ExtensionPanel } from "../editor-contract";
import { VirtualTourPanel } from "./panel";
export const tools = [];
export const panels: ExtensionPanel[] = [
  {
    id: "virtual-tour",
    title: "云展漫游项目设计器",
    workspace: {
      id: "virtual-tour",
      title: "云展漫游",
      description: "多场景、球面热点、楼层地图及项目发布",
      icon: "◎",
    },
    Component: VirtualTourPanel,
  },
];

export const commands = [];
