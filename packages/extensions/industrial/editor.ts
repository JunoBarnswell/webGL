import type {
  ExtensionPanel,
  ExtensionEditorCommand,
} from "../editor-contract";
import { IndustrialPanel } from "./panel";
export const tools = [];
export const panels: ExtensionPanel[] = [
  {
    id: "industrial",
    title: "工业语义审阅",
    workspace: {
      id: "industrial",
      title: "工业审阅",
      description: "来源属性、分类映射、剖切和测量",
      icon: "▱",
    },
    Component: IndustrialPanel,
  },
];

export const commands: ExtensionEditorCommand[] = [
  {
    id: "industrial.measure",
    title: "拾取工业测量点",
    workspace: "industrial",
    scope: "viewport",
    shortcuts: ["M"],
    execute: (props) => {
      props.services.activateTool(
        props.services.activeTool === "industrial.measure"
          ? ""
          : "industrial.measure",
      );
    },
  },
];
