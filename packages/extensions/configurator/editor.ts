import type { ExtensionPanel } from "../editor-contract";
import { ConfiguratorPanel } from "./panel";
export const tools = [];
export const panels: ExtensionPanel[] = [
  {
    id: "configurator",
    title: "产品配置设计器",
    workspace: {
      id: "configurator",
      title: "产品配置",
      description: "选项、规则、稳定实体绑定与客户界面",
      icon: "◐",
    },
    Component: ConfiguratorPanel,
  },
];

export const commands = [];
