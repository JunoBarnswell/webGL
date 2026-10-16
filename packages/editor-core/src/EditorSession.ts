import { type Patch } from "immer";
import {
  assertDocument,
  declareExtension,
  walkActions,
  migrateDocument,
  compilePrefabs,
  type ChangeSet,
  type SceneDocument,
} from "@studio/scene-schema";
import { capturePrefabEdits } from "./prefab";
import { DocumentSession, type DocumentCommand } from "./DocumentSession";
export type EditorCommand = DocumentCommand<SceneDocument>;
export function changesBetween(
  before: SceneDocument,
  after: SceneDocument,
  patches?: Patch[],
  sceneReplaced = false,
): ChangeSet {
  const changed = <T extends { id: string }>(previous: T[], next: T[]) => {
    if (previous === next) return [];
    const old = new Map(previous.map((item) => [item.id, item])),
      now = new Map(next.map((item) => [item.id, item]));
    return [...new Set([...old.keys(), ...now.keys()])].filter(
      (id) => old.get(id) !== now.get(id),
    );
  };
  return {
    sceneReplaced,
    before,
    after,
    patches,
    entityIds: changed(before.entities, after.entities),
    materialIds: changed(before.materials, after.materials),
    settingsChanged: before.settings !== after.settings,
    behaviorsChanged: before.behaviors !== after.behaviors,
    assetsChanged: before.assets !== after.assets,
    contentChanged: before.contents !== after.contents,
    uiChanged: before.ui !== after.ui,
    navigationChanged:
      before.viewpoints !== after.viewpoints || before.tours !== after.tours,
  };
}
export class EditorSession extends DocumentSession<SceneDocument, ChangeSet> {
  constructor(document: SceneDocument) {
    super(
      compilePrefabs(migrateDocument(document).document),
      assertDocument,
      (draft, before, command) => {
        if (command.kind !== "prefab" && command.kind !== "replaceScene")
          capturePrefabEdits(before, draft);
        if (draft.prefabs?.length)
          declareExtension(draft, "studio.prefab.Instance");
        for (const entity of draft.entities)
          for (const c of entity.components) declareExtension(draft, c.type);
        for (const behavior of draft.behaviors)
          walkActions(behavior.actions, (a) => declareExtension(draft, a.type));
        for (const node of draft.ui.nodes)
          if (node.action)
            walkActions([node.action], (a) => declareExtension(draft, a.type));
      },
      (before, after, patches, kind) =>
        changesBetween(before, after, patches, kind === "replaceScene"),
    );
  }
}
export * from "./DocumentSession";
export * from "./commands";

export * from "./authoring";

export * from "./CommandRegistry";

export * from "./modelRevision";

export * from "./DocumentPath";

export * from "./prefab";
