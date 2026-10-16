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
  role: VisualRole;
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
export const visualChannelMatrix = {
  configuration: {
    transform: 20,
    visibility: 20,
    opacity: 20,
    color: 20,
    material: 20,
    attachment: 20,
  },
  display: { visibility: 30, opacity: 30 },
  assembly: { transform: 40, visibility: 40, opacity: 40 },
  effect: { transform: 45, opacity: 45 },
  storyboard: {
    transform: 50,
    visibility: 50,
    opacity: 50,
    color: 50,
    material: 50,
  },
  review: {
    visibility: 60,
    opacity: 60,
    color: 60,
    clipping: 60,
    highlight: 60,
  },
  selection: { highlight: 100 },
  manipulation: { transform: 110 },
} satisfies Record<string, Partial<Record<VisualChannel, number>>>;
export type VisualRole = keyof typeof visualChannelMatrix;
const channelPriority = (role: VisualRole, channel: VisualChannel): number => {
  const priority = (
    visualChannelMatrix[role] as Partial<Record<VisualChannel, number>>
  )?.[channel];
  if (priority === undefined)
    throw Error("视觉角色不支持通道：" + role + " / " + channel);
  return priority;
};

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
    role: VisualRole,
    generation = this.runtime.generation,
  ): void {
    if (generation !== this.runtime.generation) return;
    if (!owner) throw Error("视觉覆盖必须有 Owner");
    for (const override of overrides) {
      channelPriority(role, override.channel);
      const valid =
        override.channel === "transform"
          ? ["replace", "add"]
          : override.channel === "visibility"
            ? ["replace", "and"]
            : override.channel === "opacity"
              ? ["replace", "multiply"]
              : override.channel === "clipping"
                ? ["replace", "and"]
                : ["replace"];
      if (!valid.includes(override.composition))
        throw Error("视觉通道不支持该合成方式 " + override.channel);
    }
    const old = this.scopes.get(owner);
    this.scopes.set(owner, { overrides, role, generation });
    this.apply(this.hasMaterial(old?.overrides) || this.hasMaterial(overrides));
  }
  private hasMaterial(overrides: readonly VisualOverride[] = []): boolean {
    return overrides.some((o) =>
      ["opacity", "color", "highlight", "material", "clipping", "attachment"].includes(
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
      "selection",
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
      "review",
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
  ): {
    owner: string;
    role: VisualRole;
    priority: number;
    channel: VisualChannel;
    composition: string;
    conflict: boolean;
  }[] {
    const layers = this.ordered().filter(
      (layer) => layer.override.targetId === targetId,
    );
    return layers.map((layer) => ({
      owner: layer.owner,
      role: layer.scope.role,
      priority: layer.priority,
      channel: layer.override.channel,
      composition: layer.override.composition,
      conflict:
        layer.override.composition === "replace" &&
        layers.some(
          (other) =>
            other.owner !== layer.owner &&
            other.priority === layer.priority &&
            other.override.channel === layer.override.channel &&
            other.override.composition === "replace",
        ),
    }));
  }
  get scopeCount(): number {
    return this.scopes.size;
  }
  private ordered(): {
    owner: string;
    scope: Scope;
    override: VisualOverride;
    priority: number;
    order: number;
  }[] {
    return [...this.scopes]
      .filter(([, scope]) => scope.generation === this.runtime.generation)
      .flatMap(([owner, scope]) =>
        scope.overrides.map((override, order) => ({
          owner,
          scope,
          override,
          order,
          priority: channelPriority(scope.role, override.channel),
        })),
      )
      .sort(
        (a, b) =>
          a.priority - b.priority ||
          a.owner.localeCompare(b.owner) ||
          a.order - b.order,
      );
  }
  private restoreObjects(): void {
    for (const base of this.baselines.values()) {
      base.object.position.copy(base.position);
      base.object.quaternion.copy(base.rotation);
      base.object.scale.copy(base.scale);
      base.object.visible = base.visible;
    }
  }
  baseTransform(object:THREE.Object3D):Transform {
    const base=this.baselines.get(object.uuid);
    return {position:(base?.position??object.position).toArray(),rotation:(base?.rotation??object.quaternion).toArray() as Transform["rotation"],scale:(base?.scale??object.scale).toArray()};
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
    for (const { override } of this.ordered()) {
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
            if (!(node instanceof THREE.Mesh) || node.userData.collider) return;
            const list = materialOverrides.get(node) ?? [];
            list.push(override);
            materialOverrides.set(node, list);
          });
        continue;
      }
      active.add(object.uuid);
      let base = this.baselines.get(object.uuid);
      if (!base || base.object !== object) {
        base = {
          object,
          position: object.position.clone(),
          rotation: object.quaternion.clone(),
          scale: object.scale.clone(),
          visible: object.visible,
        };
        this.baselines.set(object.uuid, base);
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
          object.scale.multiply(new THREE.Vector3().fromArray(transform.scale));
        }
      }
    }
    for (const id of this.baselines.keys())
      if (!active.has(id)) this.baselines.delete(id);
    if (materialDirty) {
      for(const attachment of this.attachments.values())if(attachment.object instanceof THREE.Mesh&&!materialOverrides.has(attachment.object))materialOverrides.set(attachment.object,[]);
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
          const oldClippingCount = clone.clippingPlanes?.length ?? 0;
          clone.copy(sources[index]);
          if([...this.attachments.values()].some(attachment=>attachment.object===mesh))clone.visible=false;
          for (const override of overrides) {
            if (override.channel === "clipping") {
              const planes = override.value as THREE.Plane[];
              clone.clippingPlanes =
                override.composition === "and"
                  ? [...(clone.clippingPlanes ?? []), ...planes]
                  : planes;
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
          if (oldClippingCount !== (clone.clippingPlanes?.length ?? 0))
            clone.needsUpdate = true;
        });
      }
    }
    this.runtime.spatial?.invalidate();
    this.runtime.engine.requestRender();
  }
  pointVisible(point: THREE.Vector3, object: THREE.Object3D,materialIndex=0): boolean {
    if(object instanceof THREE.Mesh) {
      const material=Array.isArray(object.material)?object.material[materialIndex]:object.material;
      if(material&&(!material.visible||material.transparent&&material.opacity===0))return false;
    }
    let planes: THREE.Plane[] = [];
    for (const { override } of this.ordered())
      if (override.channel === "clipping") {
        const target =
          override.object ?? this.runtime.getObject(override.targetId);
        let cursor: THREE.Object3D | null = object;
        while (cursor && cursor !== target) cursor = cursor.parent;
        if (cursor)
          planes =
            override.composition === "and"
              ? [...planes, ...(override.value as THREE.Plane[])]
              : (override.value as THREE.Plane[]);
      }
    return planes.every((plane) => plane.distanceToPoint(point) >= 0);
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
