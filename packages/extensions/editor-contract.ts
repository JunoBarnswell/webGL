import type { ComponentType } from "react";
import type {
  BehaviorAction,
  SceneDocument,
  Vec3,
} from "../scene-schema/src/index";
import type { EditorCommand } from "../editor-core/src/EditorSession";
export interface ExtensionPanelProps {
  runtime: import("../scene-runtime/src/SceneRuntime").SceneRuntime | null;
  state: import("../scene-runtime/src/RuntimeState").RuntimeSnapshot;
  document: SceneDocument;
  selectedIds: string[];
  mode: "edit" | "play";
  command: (command: EditorCommand) => boolean;
  select: (ids: string[]) => void;
  focus: (ids: string[]) => void;
  dispatch: (action: BehaviorAction) => Promise<void>;
  placeAnchor: (annotationId: string) => void;
  inspect: (id: string) => void;
}
export interface ExtensionPanel {
  id: string;
  title: string;
  Component: ComponentType<ExtensionPanelProps>;
}
export type AnnotationPlacement = {
  annotationId: string;
  entityId: string;
  position: Vec3;
  sourceElementId: string;
  meshRevision: string;
  triangleIndex: number;
  barycentric: Vec3;
  primitiveIndex: number;
};
