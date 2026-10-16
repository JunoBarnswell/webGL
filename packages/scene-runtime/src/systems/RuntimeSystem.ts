import type {
  BehaviorAction,
  ChangeSet,
  SceneDocument,
} from "@studio/scene-schema";
import type { SceneRuntime } from "../SceneRuntime";
export interface RuntimeSystem {
  id: string;
  attach(document: SceneDocument): void;
  beforeChange?(change: ChangeSet): void;
  change(change: ChangeSet): void;
  mode(mode: "edit" | "play"): void;
  update?(dt: number): boolean;
  render?(): void;
  detach(): void;
  actions?: Record<
    string,
    (action: BehaviorAction, signal: AbortSignal) => void | Promise<void>
  >;
}
export type RuntimeSystemFactory = (runtime: SceneRuntime) => RuntimeSystem;
export class EntityIndex {
  readonly materialUsers = new Map<string, Set<string>>();
  readonly entities = new Map<string, SceneDocument["entities"][number]>();
  readonly components = new Map<string, Set<string>>();
  reset(document: SceneDocument): void {
    this.entities.clear();
    this.components.clear();
    this.materialUsers.clear();
    for (const entity of document.entities) this.add(entity);
  }
  private add(entity: SceneDocument["entities"][number]): void {
    this.entities.set(entity.id, entity);
    for (const component of entity.components) {
      if (typeof component.data.materialId === "string") {
        let users = this.materialUsers.get(component.data.materialId);
        if (!users)
          this.materialUsers.set(
            component.data.materialId,
            (users = new Set()),
          );
        users.add(entity.id);
      }
    }
    for (const c of entity.components)
      if (c.enabled) {
        let set = this.components.get(c.type);
        if (!set) this.components.set(c.type, (set = new Set()));
        set.add(entity.id);
      }
  }
  change(change: ChangeSet): void {
    for (const id of change.entityIds) {
      const before = this.entities.get(id);
      for (const component of before?.components ?? [])
        if (typeof component.data.materialId === "string")
          this.materialUsers.get(component.data.materialId)?.delete(id);
      for (const c of before?.components ?? [])
        this.components.get(c.type)?.delete(id);
      this.entities.delete(id);
      const entity = change.after.entities.find((e) => e.id === id);
      if (entity) this.add(entity);
    }
  }
  query(type: string): string[] {
    return [...(this.components.get(type) ?? [])];
  }
}
