import type { ExtensionTool } from "../../editor-core/src/ExtensionTool";
import { attachComponent } from "../../editor-core/src/attachComponent";
export const tools: ExtensionTool[] = [
  {
    id: "sample.pulse",
    title: "添加示例脉冲",
    description: "用于验证扩展的编辑、预览、Player 与发布链路",
    create: (_doc, selected) =>
      attachComponent("studio.sample.Pulse", selected),
  },
];
