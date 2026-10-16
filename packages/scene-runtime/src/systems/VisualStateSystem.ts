import * as THREE from "three";
import type { SceneRuntime } from "../SceneRuntime";
import type { RuntimeSystem } from "./RuntimeSystem";
interface Scope {
  highlight: Set<string>;
  hidden: Set<string>;
  color: string;
}
/** One owner for all temporary highlight materials and isolation visibility. */
export class VisualStateSystem implements RuntimeSystem {
  readonly id = "studio.visual";
  private scopes = new Map<string, Scope>();
  private materials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private clones = new Set<THREE.Material>();
  private visibility = new Map<string, boolean>();
  constructor(private runtime: SceneRuntime) {}
  highlight(scope: string, ids: Iterable<string>, color = "#16ba9b"): void {
    this.scopes.set(scope, {
      highlight: new Set(ids),
      hidden: new Set(),
      color,
    });
    this.apply();
  }
  isolate(
    scope: string,
    selected: Iterable<string>,
    universe: Iterable<string>,
  ): void {
    const visible = new Set(selected);
    this.scopes.set(scope, {
      highlight: visible,
      hidden: new Set([...universe].filter((id) => !visible.has(id))),
      color: "#16ba9b",
    });
    this.apply();
  }
  setVisibility(id: string, visible: boolean): void {
    if (this.visibility.has(id)) this.visibility.set(id, visible);
    else {
      const object = this.runtime.getObject(id);
      if (object) object.visible = visible;
    }
  }
  reset(scope?: string): void {
    if (scope) this.scopes.delete(scope);
    else this.scopes.clear();
    this.apply();
  }
  private restore(): void {
    for (const [mesh, material] of this.materials) mesh.material = material;
    this.materials.clear();
    for (const material of this.clones)
      this.runtime.engine.resourceRegistry.release(material);
    this.clones.clear();
    for (const [id, visible] of this.visibility) {
      const object = this.runtime.getObject(id);
      if (object) object.visible = visible;
    }
    this.visibility.clear();
  }
  private apply(): void {
    this.restore();
    const colored = new Map<THREE.Mesh, string>();
    for (const scope of this.scopes.values()) {
      for (const id of scope.hidden) {
        const object = this.runtime.getObject(id);
        if (object) {
          if (!this.visibility.has(id)) this.visibility.set(id, object.visible);
          object.visible = false;
        }
      }
      for (const id of scope.highlight)
        this.runtime.getObject(id)?.traverse((object) => {
          if (object instanceof THREE.Mesh && !object.userData.collider)
            colored.set(object, scope.color);
        });
    }
    for (const [mesh, color] of colored) {
      this.materials.set(mesh, mesh.material);
      const clones = (
        Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      ).map((source) => {
        const material = source.clone();
        if ("emissive" in material)
          (material as THREE.MeshStandardMaterial).emissive.set(color);
        this.clones.add(material);
        this.runtime.engine.resourceRegistry.retain(material);
        return material;
      });
      mesh.material = Array.isArray(mesh.material) ? clones : clones[0];
    }
    this.runtime.engine.requestRender();
  }
  attach(): void {}
  beforeChange(): void {
    this.reset();
  }
  change(): void {}
  mode(): void {
    this.reset();
  }
  detach(): void {
    this.reset();
  }
}
