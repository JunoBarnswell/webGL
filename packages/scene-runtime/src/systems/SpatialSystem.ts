import { SpatialIndex } from "./SpatialIndex";
import * as THREE from "three";
import {
  getComponent,
  type ChangeSet,
  type SceneDocument,
} from "@studio/scene-schema";
import type { SceneRuntime } from "../SceneRuntime";
import type { RuntimeSystem } from "./RuntimeSystem";
export class SpatialSystem implements RuntimeSystem {
  readonly index = new SpatialIndex();
  invalidate(): void {
    this.index.invalidate();
  }
  pick(ray: THREE.Raycaster): THREE.Intersection[] {
    return this.index
      .raycast(this.runtime.root, ray, (object) => this.runtime.visible(object))
      .filter((hit) => this.runtime.visual.pointVisible(hit.point, hit.object));
  }
  readonly id = "studio.spatial";
  private colliders = new Map<string, THREE.Object3D>();
  private grounds = new Map<string, THREE.Object3D>();
  constructor(private runtime: SceneRuntime) {}
  attach(document: SceneDocument): void {
    this.refresh(document.entities.map((e) => e.id));
  }
  change(change: ChangeSet): void {
    this.refresh(change.entityIds);
  }
  refresh(ids?: readonly string[]): void {
    this.index.invalidate();
    const r = this.runtime;
    if (!r.document) return;
    for (const id of ids ?? r.index.entities.keys()) {
      this.colliders.delete(id);
      this.grounds.delete(id);
      const entity = r.index.entities.get(id),
        instance = r.objects.get(id);
      if (!entity || !instance) continue;
      const collider = getComponent(entity, "Collider");
      let box = instance.visual.children.find((node) => node.userData.collider);
      if (collider?.data.shape === "box") {
        if (!box) {
          box = new THREE.Mesh(
            new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshBasicMaterial({ visible: false }),
          );
          box.userData.collider = true;
          box.userData.ownerEntityId = id;
          instance.visual.add(box);
          r.graph.scope(instance);
        }
        box.position.fromArray(collider.data.offset as number[]);
        box.scale.fromArray(collider.data.size as number[]);
        this.colliders.set(id, box);
      } else {
        if (box) {
          box.removeFromParent();
          r.graph.scope(instance);
        }
        if (collider) this.colliders.set(id, instance.root);
      }
      if (getComponent(entity, "Ground")) this.grounds.set(id, instance.root);
    }
    if (!ids) r.root.updateMatrixWorld(true);
    else for (const id of ids) r.getObject(id)?.updateWorldMatrix(true, true);
    r.navigation.colliders = [...this.colliders.values()];
    r.navigation.grounds = [...this.grounds.values()];
  }
  mode(): void {}
  detach(): void {
    this.index.clear();
    this.colliders.clear();
    this.grounds.clear();
    this.runtime.navigation.colliders = [];
    this.runtime.navigation.grounds = [];
  }
}
