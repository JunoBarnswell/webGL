import type { ComponentType } from "react";
import type { SceneDocument, UiNode } from "../scene-schema/src/types";
import type { SceneRuntime } from "../scene-runtime/src/SceneRuntime";
import type { RuntimeSnapshot } from "../scene-runtime/src/RuntimeState";
export interface PlayerWidgetProps {
  document: SceneDocument;
  runtime: SceneRuntime | null;
  state: RuntimeSnapshot;
  node: UiNode | null;
  design: boolean;
}
export interface PlayerWidget {
  kind: string;
  title: string;
  componentType?: string;
  always?: boolean;
  available?: (runtime: SceneRuntime, document: SceneDocument) => boolean;
  Component: ComponentType<PlayerWidgetProps>;
}
