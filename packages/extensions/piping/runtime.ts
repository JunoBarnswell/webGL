import * as THREE from "three";
import {
  getComponent,
  type SceneDocument,
  type ChangeSet,
  type BehaviorAction,
} from "../../scene-schema/src/index";
import type { SceneRuntime } from "../../scene-runtime/src/SceneRuntime";
import type { RuntimeSystem } from "../../scene-runtime/src/systems/RuntimeSystem";
export class PipingSystem implements RuntimeSystem {
  readonly id = "studio.piping";
  readonly segmentsByLine = new Map<string, Set<string>>();
  private original = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private temporary = new Set<THREE.Material>();
  private visibility = new Map<string, boolean>();
  constructor(private runtime: SceneRuntime) {}
  attach(document: SceneDocument): void {
    for (const entity of document.entities) {
      const c = getComponent(entity, "studio.piping.Segment");
      if (c) {
        const id = String(c.data.lineId);
        let set = this.segmentsByLine.get(id);
        if (!set) this.segmentsByLine.set(id, (set = new Set()));
        set.add(entity.id);
      }
    }
  }
  beforeChange(): void {
    this.mode();
  }
  change(change: ChangeSet): void {
    this.segmentsByLine.clear();
    this.attach(change.after);
  }
  actions: Record<string, (action: BehaviorAction) => Promise<void>> = {
    "studio.piping.Highlight": async (action) => {
      this.restore();
      const ids = this.segmentsByLine.get(action.targetId);
      if (!ids) throw Error("管线没有关联管段");
      for (const id of ids)
        this.runtime.getObject(id)?.traverse((object) => {
          if (!(object instanceof THREE.Mesh) || object.userData.collider)
            return;
          this.original.set(object, object.material);
          const materials = (
            Array.isArray(object.material) ? object.material : [object.material]
          ).map((material) => {
            const clone = material.clone();
            if ("emissive" in clone)
              (clone as THREE.MeshStandardMaterial).emissive.set("#16ba9b");
            this.temporary.add(clone);
            return clone;
          });
          object.material = Array.isArray(object.material)
            ? materials
            : materials[0];
        });
      this.runtime.engine.requestRender();
    },
    "studio.piping.Isolate": async (action) => {
      this.restore();
      const selected = this.segmentsByLine.get(action.targetId);
      if (!selected) throw Error("管线没有关联管段");
      for (const ids of this.segmentsByLine.values())
        for (const id of ids) {
          const object = this.runtime.getObject(id);
          if (object) {
            this.visibility.set(id, object.visible);
            object.visible = selected.has(id);
          }
        }
      this.runtime.engine.requestRender();
    },
    "studio.piping.Restore": async () => this.restore(),
  };
  restore(): void {
    for (const [mesh, material] of this.original) mesh.material = material;
    this.original.clear();
    for (const material of this.temporary) material.dispose();
    this.temporary.clear();
    for (const [id, visible] of this.visibility) {
      const object = this.runtime.getObject(id);
      if (object) object.visible = visible;
    }
    this.visibility.clear();
    this.runtime.engine.requestRender();
  }
  mode(): void {
    this.restore();
  }
  update(): boolean {
    return false;
  }
  detach(): void {
    this.restore();
    this.segmentsByLine.clear();
  }
}

export default PipingSystem;
