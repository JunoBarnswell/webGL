import {
  applyPatches,
  enablePatches,
  freeze,
  produceWithPatches,
  type Patch,
} from "immer";
import {
  assertDocument,
  declareExtension,
  walkActions,
  migrateDocument,
  type ChangeSet,
  type SceneDocument,
} from "@studio/scene-schema";

enablePatches();
export interface EditorCommand {
  kind?: "replaceScene";
  label: string;
  mutate(document: SceneDocument): void;
}
interface HistoryEntry {
  sceneReplaced: boolean;
  label: string;
  patches: Patch[];
  inverse: Patch[];
}
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
export class EditorSession {
  private current: SceneDocument;
  private undoEntries: HistoryEntry[] = [];
  private redoEntries: HistoryEntry[] = [];
  private listeners = new Set<(change: ChangeSet, label: string) => void>();
  constructor(document: SceneDocument) {
    document = migrateDocument(document).document;
    assertDocument(document);
    this.current = freeze(structuredClone(document), true);
  }
  get document(): SceneDocument {
    return this.current;
  }
  get canUndo(): boolean {
    return this.undoEntries.length > 0;
  }
  get canRedo(): boolean {
    return this.redoEntries.length > 0;
  }
  get history(): string[] {
    return this.undoEntries.map((entry) => entry.label);
  }
  subscribe(listener: (change: ChangeSet, label: string) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  execute(command: EditorCommand): void {
    const [after, patches, inverse] = produceWithPatches(
      this.current,
      (draft) => {
        command.mutate(draft);
        for (const entity of draft.entities)
          for (const c of entity.components) declareExtension(draft, c.type);
        for (const b of draft.behaviors)
          walkActions(b.actions, (a) => declareExtension(draft, a.type));
        for (const node of draft.ui.nodes)
          if (node.action)
            walkActions([node.action], (a) => declareExtension(draft, a.type));
      },
    );
    if (!patches.length) return;
    assertDocument(after);
    this.undoEntries.push({
      sceneReplaced: command.kind === "replaceScene",
      label: command.label,
      patches,
      inverse,
    });
    if (this.undoEntries.length > 100) this.undoEntries.shift();
    this.redoEntries = [];
    this.commit(after, command.label, patches, command.kind === "replaceScene");
  }
  undo(): void {
    const entry = this.undoEntries.pop();
    if (entry) {
      this.redoEntries.push(entry);
      this.commit(
        applyPatches(this.current, entry.inverse),
        "撤销 " + entry.label,
        entry.inverse,
        entry.sceneReplaced,
      );
    }
  }
  redo(): void {
    const entry = this.redoEntries.pop();
    if (entry) {
      this.undoEntries.push(entry);
      this.commit(
        applyPatches(this.current, entry.patches),
        "重做 " + entry.label,
        entry.patches,
        entry.sceneReplaced,
      );
    }
  }
  private commit(
    document: SceneDocument,
    label: string,
    patches: Patch[],
    sceneReplaced = false,
  ): void {
    const change = changesBetween(
      this.current,
      document,
      patches,
      sceneReplaced,
    );
    this.current = document;
    for (const listener of this.listeners) listener(change, label);
  }
}
export * from "./commands";

export * from "./authoring";

export * from "./CommandRegistry";

export * from "./modelRevision";

export * from "./DocumentPath";
