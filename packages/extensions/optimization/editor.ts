import type { ExtensionPanel } from "../editor-contract";
import { OptimizationPanel } from "./panel";
export const tools = [];
export const panels: ExtensionPanel[] = [
  {
    id: "optimization",
    title: "资产诊断与优化作业",
    workspace: {
      id: "optimization",
      title: "资产优化",
      description: "诊断、Meshopt/KTX2、身份门禁与质量比较",
      icon: "◫",
    },
    Component: OptimizationPanel,
  },
];

export const commands = [];
