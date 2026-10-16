import type { ComponentType, ReactNode } from "react";
import type {
  BehaviorAction,
  SceneDocument,
  Vec3,
} from "../scene-schema/src/index";
import type { EditorCommand } from "../editor-core/src/EditorSession";
export interface ExtensionPanelProps {
  renderDocumentFields: (
    type: string,
    value: Record<string, import("../scene-schema/src/types").JsonValue>,
    keys: string[],
    onChange: (
      key: string,
      value: import("../scene-schema/src/types").JsonValue,
    ) => void,
  ) => ReactNode;
  renderFields: (
    entityId: string,
    componentType: string,
    keys: string[],
  ) => ReactNode;
  services: {
    previewProject: (
      graph: import("./virtual-tour/core").ProjectGraph,
    ) => Promise<void>;
    prepareModel: (
      asset: import("../scene-schema/src/types").SceneAsset,
    ) => Promise<import("../scene-schema/src/types").Entity[]>;
    downloadJson: (name: string, value: unknown) => void;
    activeTool: string;
    activateTool: (id: string) => void;
    dragPrefab: (
      revision: import("../scene-schema/src/prefab").PrefabRevision | null,
    ) => void;
    projectId: string;
    sourceEditing: boolean;
    scratchActive: boolean;
    beginScratch: () => Promise<void>;
    cancelScratch: () => Promise<SceneDocument>;
    historyTarget: (
      target: import("../editor-core/src/DocumentSession").HistoryTarget | null,
      save?: () => Promise<void>,
    ) => void;
    persistDraft: (key: string, value: unknown) => Promise<void>;
    recoverDraft: <T>(key: string) => Promise<T | undefined>;
    editSource: (
      record: import("./library").LibraryRecord<{
        rootLocalId: string;
        document: SceneDocument;
      }>,
    ) => Promise<void>;
    returnToScene: () => Promise<void>;
    request: <T>(path: string, options?: RequestInit) => Promise<T>;
    upload: (
      name: string,
      kind: import("../scene-schema/src/types").SceneAsset["kind"],
      entry: string,
      files: Map<string, Uint8Array>,
      options?: { signal?: AbortSignal; taskId?: string },
    ) => Promise<import("../scene-schema/src/types").SceneAsset>;
    assetBytes: (
      id: string,
      path: string,
      signal?: AbortSignal,
    ) => Promise<ArrayBuffer>;
    saveScene: () => Promise<void>;
    openScene: (id: string) => Promise<void>;
    run: (label: string, action: () => Promise<void>) => Promise<void>;
  };
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
export interface ExtensionEditorCommand {
  id: string;
  title: string;
  workspace: string;
  scope: "editor" | "viewport" | "timeline";
  shortcuts: string[];
  execute: (props: ExtensionPanelProps) => void | Promise<void>;
}
export interface ExtensionPanel {
  workspace?: { id: string; title: string; description: string; icon: string };
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
