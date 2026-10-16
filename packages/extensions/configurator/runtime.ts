import * as THREE from "three";
import {
  getComponent,
  type SceneDocument,
  type ChangeSet,
  type BehaviorAction,
  type JsonValue,
} from "../../scene-schema/src/index";
import type { SceneRuntime } from "../../scene-runtime/src/SceneRuntime";
import type { RuntimeSystem } from "../../scene-runtime/src/systems/RuntimeSystem";
import type { VisualOverride } from "../../scene-runtime/src/systems/VisualStateSystem";
import type { GpuResource } from "../../scene-runtime/src/AssetStore";
import {
  defaultConfiguration,
  resolveConfiguration,
  type ProductCatalog,
  type ConfigurationResult,
} from "./core";
interface Part {
  root: THREE.Group;
  owned: Set<GpuResource>;
}
interface Product {
  catalog: ProductCatalog;
  result: ConfigurationResult;
  nonce: number;
  parts: Map<string, Part>;
  pendingParts: Map<string, Promise<Part | undefined>>;
}
export default class ConfiguratorSystem implements RuntimeSystem {
  readonly id = "studio.configurator";
  private products = new Map<string, Product>();
  constructor(private runtime: SceneRuntime) {}
  attach(doc: SceneDocument): void {
    for (const entity of doc.entities) {
      const component = getComponent(entity, "studio.configurator.Catalog");
      if (component) {
        const catalog = component.data as unknown as ProductCatalog;
        this.products.set(entity.id, {
          catalog,
          result: resolveConfiguration(catalog, defaultConfiguration(catalog)),
          nonce: 0,
          parts: new Map(),
          pendingParts: new Map(),
        });
      }
    }
  }
  beforeChange(): void {
    this.detach();
  }
  change(change: ChangeSet): void {
    this.attach(change.after);
  }
  private product(id: string): Product {
    const p = this.products.get(id);
    if (!p) throw Error("产品配置目录不存在");
    return p;
  }
  private async part(
    id: string,
    p: Product,
    key: string,
    assetId: string,
    targetId: string,
    generation: number,
  ): Promise<Part | undefined> {
    const cached = p.parts.get(key);
    if (cached) return cached;
    let pending = p.pendingParts.get(key);
    if (!pending) {
      if (!this.runtime.store) throw Error("资源仓库未就绪");
      const store = this.runtime.store;
      pending = (async () => {
        const loaded = await store.instance(assetId),
          owned = this.runtime.engine.resourceRegistry.collect(
            loaded.root,
          ) as Set<GpuResource>;
        for (const resource of owned)
          this.runtime.engine.resourceRegistry.retain(resource);
        if (
          this.runtime.generation !== generation ||
          this.products.get(id) !== p
        ) {
          for (const resource of owned)
            this.runtime.engine.resourceRegistry.release(resource);
          return;
        }
        loaded.root.userData.entityId = targetId;
        if (!getComponent(this.runtime.entity(targetId)!, "ModelNode"))
          loaded.root.scale.multiplyScalar(1000);
        const part = { root: loaded.root, owned };
        p.parts.set(key, part);
        return part;
      })();
      p.pendingParts.set(key, pending);
      void pending.finally(() => p.pendingParts.delete(key)).catch(() => {});
    }
    return pending;
  }
  private publish(id: string, p: Product, pending = false, error = ""): void {
    this.runtime.state.patch({
      extensions: {
        ...this.runtime.getSnapshot().extensions,
        [this.id + ":" + id]: {
          result: p.result as unknown as JsonValue,
          pending,
          error,
        },
      },
    });
  }
  async select(id: string, groupId: string, optionId: string): Promise<void> {
    const p = this.product(id),
      group = p.catalog.groups.find((g) => g.id === groupId);
    if (!group) throw Error("配置属性不存在");
    const selected = p.result.selections[groupId] ?? [];
    const next = {
      ...p.result.selections,
      [groupId]:
        group.max === 1
          ? group.control === "toggle" && selected.includes(optionId)
            ? []
            : [optionId]
          : selected.includes(optionId)
            ? selected.filter((v) => v !== optionId)
            : [...selected, optionId],
    };
    await this.apply(
      id,
      resolveConfiguration(p.catalog, next, p.result.numericValues),
    );
  }
  async setNumber(id: string, groupId: string, value: number): Promise<void> {
    const p = this.product(id);
    if (
      !p.catalog.groups.some((g) => g.id === groupId && g.control === "number")
    )
      throw Error("配置数值属性不存在");
    await this.apply(
      id,
      resolveConfiguration(p.catalog, p.result.selections, {
        ...p.result.numericValues,
        [groupId]: value,
      }),
    );
  }
  async apply(id: string, result: ConfigurationResult): Promise<void> {
    const p = this.product(id);
    if (result.errors.length) throw Error(result.errors.join("；"));
    const nonce = ++p.nonce,
      generation = this.runtime.generation,
      overrides: VisualOverride[] = [];
    this.publish(id, p, true);
    try {
      const mappings = p.catalog.groups.flatMap((group) =>
        group.control === "number"
          ? (group.visuals ?? []).map((mapping) => ({
              ...mapping,
              value: String(result.numericValues[group.id]),
            }))
          : group.options
              .filter((o) => result.selections[group.id].includes(o.id))
              .flatMap((o) => o.visuals),
      );
      const lists = await Promise.all(
        mappings.map(async (mapping) => {
          const overrides: VisualOverride[] = [];
          if (mapping.operation === "camera") return overrides;
          const targetId = mapping.targetId,
            object = this.runtime.getObject(targetId);
          if (!object) throw Error("配置绑定对象不存在：" + targetId);
          if (mapping.operation === "visibility")
            overrides.push({
              targetId,
              channel: "visibility",
              composition: "replace",
              value: mapping.value === "true",
            });
          else if (mapping.operation === "color")
            overrides.push({
              targetId,
              channel: "color",
              composition: "replace",
              value: mapping.value,
            });
          else if (mapping.operation === "opacity")
            overrides.push({
              targetId,
              channel: "opacity",
              composition: "replace",
              value: Number(mapping.value),
            });
          else if (mapping.operation === "transform") {
            const units = this.runtime.sourceUnits(
              this.runtime.entity(targetId)!,
            );
            overrides.push({
              targetId,
              channel: "transform",
              composition: "replace",
              value: {
                ...mapping.transform,
                position: mapping.transform.position.map((v) => v / units) as [
                  number,
                  number,
                  number,
                ],
              },
            });
          } else if (mapping.operation === "variant") {
            const entity = this.runtime.entity(targetId)!,
              node = getComponent(entity, "ModelNode"),
              owner = node ? String(node.data.modelEntityId) : targetId,
              model = this.runtime.objects.get(owner),
              asset = getComponent(this.runtime.entity(owner)!, "Model");
            if (!model?.model || !asset || !this.runtime.store)
              throw Error("变体目标必须属于 GLTF 模型");
            const nativeTargets: THREE.Object3D[] = [];
            object.traverse((node) => {
              if (model.nativeObjects?.has(node)) nativeTargets.push(node);
            });
            const variants = await this.runtime.store.variant(
              String(asset.data.assetId),
              nativeTargets,
              mapping.variant,
            );
            for (const [mesh, material] of variants)
              overrides.push({
                targetId,
                object: mesh,
                channel: "material",
                composition: "replace",
                value: material,
              });
          } else if (mapping.operation === "swapPart") {
            const part = await this.part(
              id,
              p,
              JSON.stringify([mapping.id, mapping.assetId, targetId]),
              mapping.assetId,
              targetId,
              generation,
            );
            if (!part) return;
            overrides.push({
              targetId,
              channel: "attachment",
              composition: "replace",
              value: part.root,
            });
          }
          return overrides;
        }),
      );
      overrides.push(...lists.flatMap((list) => list ?? []));
      if (
        nonce !== p.nonce ||
        generation !== this.runtime.generation ||
        this.products.get(id) !== p
      )
        return;
      this.runtime.visual.setScope(
        "configuration:" + id,
        overrides,
        20,
        generation,
      );
      p.result = result;
      this.publish(id, p);
      const camera = mappings.find((m) => m.operation === "camera");
      if (camera)
        await this.runtime.flyToPose(
          camera.camera,
          0.6,
          this.runtime.playAbort.signal,
        );
    } catch (error) {
      if (nonce === p.nonce) {
        this.publish(id, p, false, String(error));
        throw error;
      }
    }
  }
  reset(id: string): Promise<void> {
    const p = this.product(id);
    return this.apply(
      id,
      resolveConfiguration(p.catalog, defaultConfiguration(p.catalog)),
    );
  }
  actions: Record<string, (a: BehaviorAction) => Promise<void>> = {
    "studio.configurator.Select": (a) =>
      this.select(a.targetId, String(a.data.groupId), String(a.data.optionId)),
    "studio.configurator.Reset": (a) => this.reset(a.targetId),
    "studio.configurator.SetNumber": (a) =>
      this.setNumber(a.targetId, String(a.data.groupId), Number(a.data.value)),
  };
  mode(mode: "edit" | "play"): void {
    for (const [id, p] of this.products) {
      p.nonce++;
      this.runtime.visual.reset("configuration:" + id);
      if (mode === "play")
        this.runtime.track(
          this.reset(id).catch((error) => this.runtime.issue(id, error)),
        );
    }
  }
  detach(): void {
    for (const [id, p] of this.products) {
      p.nonce++;
      this.runtime.visual.reset("configuration:" + id);
      for (const part of p.parts.values()) {
        part.root.removeFromParent();
        for (const resource of part.owned)
          this.runtime.engine.resourceRegistry.release(resource);
      }
      p.parts.clear();
    }
    this.products.clear();
  }
}
