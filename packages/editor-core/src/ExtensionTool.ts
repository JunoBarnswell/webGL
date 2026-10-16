import type { SceneDocument } from "@studio/scene-schema";
import type { EditorCommand } from "./EditorSession";
export interface ExtensionTool {
  id: string;
  title: string;
  description: string;
  create: (document: SceneDocument, selected: string[]) => EditorCommand;
}
