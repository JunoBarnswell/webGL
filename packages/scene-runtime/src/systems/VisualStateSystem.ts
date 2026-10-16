import * as THREE from "three";
import type { SceneRuntime } from "../SceneRuntime";
import type { RuntimeSystem } from "./RuntimeSystem";
import type { Transform } from "@studio/scene-schema";

export type VisualChannel =
  | "transform"
  | "visibility"
  | "opacity"
  | "color"
  | "highlight"
  | "material"
  | "attachment"
  | "clipping";
export interface VisualOverride {
  targetId: string;
  object?: THREE.Object3D;
  channel: VisualChannel;
  composition: "replace" | "add" | "multiply" | "and";
  value:
    | Transform
    | boolean
    | number
    | string
    | THREE.Material
    | THREE.Material[]
    | THREE.Object3D
    | THREE.Plane[];
}
interface Scope {
  priority: number;
  generation: number;
  overrides: readonly VisualOverride[];
}
interface Baseline {
  object: THREE.Object3D;
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  scale: THREE.Vector3;
  visible: boolean;
}
interface MaterialEffect {
  source: THREE.Material | THREE.Material[];
  clones: THREE.Material[];
}
export const visualPriorities = {
  configuration: 20,
  assembly: 40,
  storyboard: 50,
  review: 60,
  selection: 100,
} as const;

/** The sole writer of transient object and material channels. */
export class VisualStateSystem implements RuntimeSystem {
  readonly id = "studio.visual";
  private scopes = new Map<string, Scope>();
  private baselines = new Map<string, Baseline>();
  private attachments = new Map<
    string,
    {
      object: THREE.Object3D;
      children: Map<THREE.Object3D, boolean>;
      replacement: THREE.Object3D;
    }
  >();
  private materials = new Map<THREE.Mesh, MaterialEffect>();
  constructor(private runtime: SceneRuntime) {}
  setScope(
    owner: string,
    overrides: readonly VisualOverride[],
    priority: number,
    generation = this.runtime.generation,
  ): void {
    if (generation !== this.runtime.generation) return;
    if (!owner) throw Error("视觉覆盖必须有 Owner");
    for (const override of overrides) {
      const valid =
        override.channel === "transform"
          ? ["replace", "add"]
          : override.channel === "visibility"
            ? ["replace", "and"]
            : override.channel === "opacity"
              ? ["replace", "multiply"]
              : ["replace"];
      if (!valid.includes(override.composition))
        throw Error("视觉通道不支持该合成方式 " + override.channel);
    }
    const old = this.scopes.get(owner);
    this.scopes.set(owner, { overrides, priority, generation });
    this.apply(this.hasMaterial(old?.overrides) || this.hasMaterial(overrides));
  }
  private hasMaterial(overrides: readonly VisualOverride[] = []): boolean {
    return overrides.some((o) =>
      ["opacity", "color", "highlight", "material", "clipping"].includes(
        o.channel,
      ),
    );
  }
  highlight(scope: string, ids: Iterable<string>, color = "#16ba9b"): void {
    this.setScope(
      scope,
      [...ids].map((targetId) => ({
        targetId,
        channel: "highlight",
        composition: "replace",
        value: color,
      })),
      visualPriorities.selection,
    );
  }
  isolate(
    scope: string,
    selected: Iterable<string>,
    universe: Iterable<string>,
  ): void {
    const ids = new Set(selected);
    this.setScope(
      scope,
      [...universe].map((targetId) => ({
        targetId,
        channel: "visibility",
        composition: "and",
        value: ids.has(targetId),
      })),
      visualPriorities.review,
    );
  }
  reset(owner?: string): void {
    const material = owner
      ? this.hasMaterial(this.scopes.get(owner)?.overrides)
      : true;
    if (owner) this.scopes.delete(owner);
    else this.scopes.clear();
    this.apply(material);
  }
  describe(
    targetId: string,
  ): { owner: string; priority: number; channel: VisualChannel }[] {
    return this.ordered().flatMap(([owner, scope]) =>
      scope.overrides
        .filter((o) => o.targetId === targetId)
        .map((o) => ({ owner, priority: scope.priority, channel: o.channel })),
    );
  }
  get scopeCount(): number {
    return this.scopes.size;
  }
  private ordered(): [string, Scope][] {
    return [...this.scopes]
      .filter(([, s]) => s.generation === this.runtime.generation)
      .sort(([a, x], [b, y]) => x.priority - y.priority || a.localeCompare(b));
  }
  private restoreObjects(): void {
    for (const base of this.baselines.values()) {
      base.object.position.copy(base.position);
      base.object.quaternion.copy(base.rotation);
      base.object.scale.copy(base.scale);
      base.object.visible = base.visible;
    }
  }
  private releaseMaterial(mesh: THREE.Mesh, effect: MaterialEffect): void {
    mesh.material = effect.source;
    for (const clone of effect.clones)
      this.runtime.engine.resourceRegistry.release(clone);
    this.materials.delete(mesh);
  }
  private apply(materialDirty: boolean): void {
    for (const effect of this.attachments.values()) {
      effect.replacement.removeFromParent();
      for (const [child, visible] of effect.children) child.visible = visible;
    }
    this.attachments.clear();
    this.restoreObjects();
    const active = new Set<string>();
    const materialOverrides = new Map<THREE.Mesh, VisualOverride[]>();
    for (const [, scope] of this.ordered())
      for (const override of scope.overrides) {
        const object =
          override.object ?? this.runtime.getObject(override.targetId);
        if (!object) continue;
        if (override.channel === "attachment") {
          const previous = this.attachments.get(override.targetId);
          if (previous) previous.replacement.removeFromParent();
          const children =
            previous?.children ??
            new Map(object.children.map((child) => [child, child.visible]));
          for (const child of children.keys()) child.visible = false;
          const replacement = override.value as THREE.Object3D;
          object.add(replacement);
          replacement.visible = true;
          this.attachments.set(override.targetId, {
            object,
            children,
            replacement,
          });
          continue;
        }
        if (
          ["opacity", "color", "highlight", "material", "clipping"].includes(
            override.channel,
          )
        ) {
          if (materialDirty)
            object.traverse((node) => {
              if (!(node instanceof THREE.Mesh) || node.userData.collider)
                return;
              const list = materialOverrides.get(node) ?? [];
              list.push(override);
              materialOverrides.set(node, list);
            });
          continue;
        }
        active.add(override.targetId);
        let base = this.baselines.get(override.targetId);
        if (!base || base.object !== object) {
          base = {
            object,
            position: object.position.clone(),
            rotation: object.quaternion.clone(),
            scale: object.scale.clone(),
            visible: object.visible,
          };
          this.baselines.set(override.targetId, base);
        }
        if (override.channel === "visibility") {
          object.visible =
            override.composition === "and"
              ? object.visible && Boolean(override.value)
              : Boolean(override.value);
        } else if (override.channel === "transform") {
          const transform = override.value as Transform;
          if (override.composition === "replace") {
            object.position.fromArray(transform.position);
            object.quaternion.fromArray(transform.rotation);
            object.scale.fromArray(transform.scale);
          } else {
            object.position.add(
              new THREE.Vector3().fromArray(transform.position),
            );
            object.quaternion.multiply(
              new THREE.Quaternion().fromArray(transform.rotation),
            );
            object.scale.multiply(
              new THREE.Vector3().fromArray(transform.scale),
            );
          }
        }
      }
    for (const id of this.baselines.keys())
      if (!active.has(id)) this.baselines.delete(id);
    if (materialDirty) {
      this.runtime.engine.renderer.localClippingEnabled = [
        ...materialOverrides.values(),
      ].some((list) => list.some((o) => o.channel === "clipping"));
      for (const [mesh, effect] of this.materials)
        if (!materialOverrides.has(mesh)) this.releaseMaterial(mesh, effect);
      for (const [mesh, overrides] of materialOverrides) {
        let effect = this.materials.get(mesh);
        if (!effect) {
          const source = mesh.material;
          const clones = (Array.isArray(source) ? source : [source]).map((m) =>
            m.clone(),
          );
          effect = { source, clones };
          this.materials.set(mesh, effect);
          for (const clone of clones)
            this.runtime.engine.resourceRegistry.retain(clone);
          mesh.material = Array.isArray(source) ? clones : clones[0];
        }
        const selected = overrides
          .filter((o) => o.channel === "material")
          .at(-1)?.value as THREE.Material | THREE.Material[] | undefined;
        const effective = selected ?? effect.source;
        const sources = Array.isArray(effective) ? effective : [effective];
        if (
          effect.clones.length !== sources.length ||
          sources.some((source, i) => source.type !== effect!.clones[i].type)
        ) {
          for (const clone of effect.clones)
            this.runtime.engine.resourceRegistry.release(clone);
          effect.clones = sources.map((source) => source.clone());
          for (const clone of effect.clones)
            this.runtime.engine.resourceRegistry.retain(clone);
          mesh.material = Array.isArray(effective)
            ? effect.clones
            : effect.clones[0];
        }

        effect.clones.forEach((clone, index) => {
          clone.copy(sources[index]);
          for (const override of overrides) {
            if (override.channel === "clipping") {
              const planes = override.value as THREE.Plane[];
              if (clone.clippingPlanes?.length !== planes.length)
                clone.needsUpdate = true;
              clone.clippingPlanes = planes;
              clone.clipIntersection = false;
            } else if (override.channel === "material") continue;
            else if (override.channel === "opacity") {
              clone.opacity = THREE.MathUtils.clamp(
                override.composition === "multiply"
                  ? clone.opacity * Number(override.value)
                  : Number(override.value),
                0,
                1,
              );
              clone.transparent =
                clone.opacity < 1 || sources[index].transparent;
              clone.depthWrite =
                clone.opacity < 1 ? false : sources[index].depthWrite;
            } else if (override.channel === "highlight" && "emissive" in clone)
              (clone as THREE.MeshStandardMaterial).emissive.set(
                String(override.value),
              );
            else if ("color" in clone)
              (clone as THREE.MeshStandardMaterial).color.set(
                String(override.value),
              );
          }
        });
      }
    }
    this.runtime.spatial?.invalidate();
    this.runtime.engine.requestRender();
  }
  pointVisible(point: THREE.Vector3, object: THREE.Object3D): boolean {
    for (const [, scope] of this.ordered())
      for (const override of scope.overrides)
        if (override.channel === "clipping") {
          const target =
            override.object ?? this.runtime.getObject(override.targetId);
          let cursor: THREE.Object3D | null = object;
          while (cursor && cursor !== target) cursor = cursor.parent;
          if (
            cursor &&
            (override.value as THREE.Plane[]).some(
              (plane) => plane.distanceToPoint(point) < 0,
            )
          )
            return false;
        }
    return true;
  }
  rebase(updateSource: () => void): void {
    this.beforeChange();
    updateSource();
    this.change();
  }
  attach(): void {}
  beforeChange(): void {
    for (const effect of this.attachments.values()) {
      effect.replacement.removeFromParent();
      for (const [child, visible] of effect.children) child.visible = visible;
    }
    this.attachments.clear();
    this.restoreObjects();
    this.baselines.clear();
    for (const [mesh, effect] of this.materials)
      this.releaseMaterial(mesh, effect);
  }
  change(): void {
    this.apply(true);
  }
  mode(): void {
    this.reset();
  }
  detach(): void {
    this.reset();
  }
}
