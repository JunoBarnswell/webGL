import type { ExtensionPanel } from "../editor-contract";
import { PrefabPanel } from "./panel";
export const tools = [];
export const panels: ExtensionPanel[] = [
  {
    id: "prefab",
    title: "预制体库与实例 Diff",
    workspace: {
      id: "prefab",
      title: "预制体",
      description: "源定义、实例覆盖及版本传播",
      icon: "◇",
    },
    Component: PrefabPanel,
  },
];

export const commands = [];
