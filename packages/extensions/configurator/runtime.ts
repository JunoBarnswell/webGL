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
  toggleConfigurationOption,
  configurationOwnership,
  resolveVisualCandidates,
  type VisualCandidate,
  type MappingSource,
  type VisualMapping,
  type OptionGroup,
  compileRuleGraph,
  resolveConfiguration,
  type ProductCatalog,
  type ConfigurationResult,
} from "./core";
interface Part {
  root: THREE.Group;
  owned: Set<GpuResource>;
  assetId: string;
  nativeObjects: Set<THREE.Object3D>;
  sourceObjects: Map<string, THREE.Object3D[]>;
}
interface Product {
  catalog: ProductCatalog;
  compiled: import("./rules").RuleIR;
  result: ConfigurationResult;
  desired: ConfigurationResult;
  nonce: number;
  parts: Map<string, Part>;
  pendingParts: Map<string, Promise<Part | undefined>>;
  wantedParts: Set<string>;
  activeParts: Set<string>;
  materialAssignments: MaterialAssignment[];
}
interface MaterialAssignment {
  modelEntityId: string;
  sourceElementId: string;
  meshIndex: number;
  primitiveIndex: number;
  materialIndex: number;
  assetId: string;
  variants: string[];
  sources: MappingSource[];
  shadowed: MappingSource[];
}
interface SelectedMapping {
  mapping: VisualMapping;
  source: MappingSource;
}
interface Slot {
  targetId: string;
  object: THREE.Object3D;
  part: Part;
  key: string;
}
import { convertUnit, strictNumber } from "../../scene-schema/src/units";
export default class ConfiguratorSystem implements RuntimeSystem {
  readonly id = "studio.configurator";
  private products = new Map<string, Product>();
  private ownershipErrors = new Map<string, string[]>();
  private cameraIntent = 0;
  constructor(private runtime: SceneRuntime) {}
  attach(doc: SceneDocument): void {
    this.ownershipErrors = configurationOwnership(doc);
    for (const entity of doc.entities) {
      const component = getComponent(entity, "studio.configurator.Catalog");
      if (component) {
        const catalog = component.data as unknown as ProductCatalog;
        const initial = resolveConfiguration(
          catalog,
          defaultConfiguration(catalog),
        );
        this.products.set(entity.id, {
          catalog,
          compiled: compileRuleGraph(catalog),
          result: initial,
          desired: initial,
          nonce: 0,
          parts: new Map(),
          pendingParts: new Map(),
          wantedParts: new Set(),
          activeParts: new Set(),
          materialAssignments: [],
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
          this.products.get(id) !== p ||
          !p.wantedParts.has(key)
        ) {
          for (const resource of owned)
            this.runtime.engine.resourceRegistry.release(resource);
          return;
        }
        loaded.root.userData.entityId = targetId;
        if (!getComponent(this.runtime.entity(targetId)!, "ModelNode"))
          loaded.root.scale.multiplyScalar(1000);
        const nativeObjects = new Set<THREE.Object3D>(),
          sourceObjects = new Map<string, THREE.Object3D[]>();
        loaded.root.traverse((object) => {
          nativeObjects.add(object);
          const source = String(object.userData.gltfSourceElementId ?? "");
          if (
            source &&
            object.parent?.userData.gltfSourceElementId !== source
          ) {
            const list = sourceObjects.get(source) ?? [];
            list.push(object);
            sourceObjects.set(source, list);
          }
        });
        const part: Part = {
          root: loaded.root,
          owned,
          assetId,
          nativeObjects,
          sourceObjects,
        };
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
          requestedResult: (pending
            ? p.desired
            : p.result) as unknown as JsonValue,
          materialAssignments: p.materialAssignments as unknown as JsonValue,
          pending,
          error,
        },
      },
    });
  }
  async select(id: string, groupId: string, optionId: string): Promise<void> {
    const p = this.product(id),
      group = p.catalog.groups.find((g) => g.id === groupId);
    if (!group || group.control === "number")
      throw Error("请选择选项属性；数值属性使用 SetNumber");
    const selected = p.desired.selections[groupId] ?? [];
    const next = {
      ...p.desired.selections,
      [groupId]: toggleConfigurationOption(group, selected, optionId),
    };
    await this.apply(
      id,
      resolveConfiguration(p.catalog, next, p.desired.numericValues, {
        compiled: p.compiled,
        intent: {
          groupId,
          optionId,
          selected: next[groupId].includes(optionId),
        },
      }),
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
      resolveConfiguration(
        p.catalog,
        p.desired.selections,
        {
          ...p.desired.numericValues,
          [groupId]: value,
        },
        { compiled: p.compiled, intent: { groupId, value } },
      ),
    );
  }
  private releaseUnused(p: Product): void {
    for (const [key, part] of p.parts)
      if (!p.activeParts.has(key) && !p.wantedParts.has(key)) {
        part.root.removeFromParent();
        for (const resource of part.owned)
          this.runtime.engine.resourceRegistry.release(resource);
        p.parts.delete(key);
      }
  }
  private numericMapping(
    group: OptionGroup,
    mapping: VisualMapping,
    value: number,
  ): VisualMapping {
    if (!["transform", "opacity"].includes(mapping.operation))
      throw Error("数值属性需要变换或透明度绑定");
    const binding = mapping.numericBinding;
    const ratio = (raw: number) =>
      binding && (binding.reference ?? 0) > 0
        ? raw / binding.reference!
        : convertUnit(raw, group.numericUnit || "1", "1");
    if (mapping.operation === "opacity") {
      const number =
        ratio(binding ? value * binding.factor + binding.offset : value) +
        (binding?.mode === "add" ? strictNumber(mapping.value) : 0);
      return { ...mapping, value: String(number) };
    }
    if (!binding || binding.property === "opacity")
      throw Error("数值变换需要明确绑定属性、轴和单位");
    const transform = structuredClone(mapping.transform),
      raw = value * binding.factor + binding.offset,
      target = binding.property === "position" ? "mm" : "rad",
      number =
        binding.property === "scale"
          ? ratio(raw)
          : convertUnit(
              raw,
              group.numericUnit || (target === "rad" ? "deg" : target),
              target,
            );
    if (binding.property === "rotation") {
      if (binding.axis === "all") throw Error("旋转绑定需要单轴");
      const axes = {
        x: new THREE.Vector3(1, 0, 0),
        y: new THREE.Vector3(0, 1, 0),
        z: new THREE.Vector3(0, 0, 1),
      };
      transform.rotation = new THREE.Quaternion()
        .setFromAxisAngle(axes[binding.axis], number)
        .toArray() as typeof transform.rotation;
    } else {
      const vector = transform[binding.property],
        axes =
          binding.axis === "all"
            ? [0, 1, 2]
            : [{ x: 0, y: 1, z: 2 }[binding.axis]];
      for (const axis of axes) vector[axis] = number;
    }
    return { ...mapping, transform };
  }
  private mappings(p: Product, result: ConfigurationResult): SelectedMapping[] {
    return p.catalog.groups.flatMap((group) => {
      const selected =
        group.control === "number"
          ? (group.visuals ?? []).map((mapping) => ({
              mapping: this.numericMapping(
                group,
                mapping,
                result.numericValues[group.id],
              ),
              optionId: "",
            }))
          : group.options
              .filter((option) =>
                result.selections[group.id].includes(option.id),
              )
              .flatMap((option) =>
                option.visuals.map((mapping) => ({
                  mapping: { ...mapping, numericBinding: undefined },
                  optionId: option.id,
                })),
              );
      return selected.map(({ mapping, optionId }) => ({
        mapping,
        source: {
          mappingId: mapping.id,
          groupId: group.id,
          optionId,
          priority: mapping.priority ?? 0,
          catalogId: p.catalog.catalogId,
          catalogRevision: result.schemaRevision,
        },
      }));
    });
  }
  async apply(
    id: string,
    result: ConfigurationResult,
    focusCamera = true,
  ): Promise<void> {
    const p = this.product(id);
    if (result.errors.length) throw Error(result.errors.join("；"));
    if (this.ownershipErrors.has(id))
      throw Error(this.ownershipErrors.get(id)!.join("；"));
    const mappings = this.mappings(p, result);
    const slotChoices = resolveVisualCandidates(
      mappings
        .filter((item) => item.mapping.operation === "swapPart")
        .map((item) => ({
          key: item.mapping.targetId,
          priority: item.source.priority,
          signature: item.mapping.assetId,
          value: item,
          source: item.source,
        })),
    );
    const nonce = ++p.nonce,
      generation = this.runtime.generation,
      cameraIntent = focusCamera ? ++this.cameraIntent : 0,
      candidates: VisualCandidate<VisualOverride>[] = [],
      transformFields = new Map<
        VisualOverride,
        { property: "position" | "scale" | "rotation"; axis: number }
      >(),
      materialProof = new Map<
        VisualOverride,
        Omit<MaterialAssignment, "variants" | "sources" | "shadowed"> & {
          variant: string;
        }
      >();
    p.desired = result;
    p.wantedParts = new Set(
      [...slotChoices].map(([targetId, choice]) =>
        JSON.stringify([targetId, choice.value.mapping.assetId]),
      ),
    );
    this.publish(id, p, true);
    try {
      const slots = await Promise.all(
        [...slotChoices].map(
          async ([targetId, choice]): Promise<Slot | undefined> => {
            const object = this.runtime.getObject(targetId);
            if (!object) throw Error("配置槽位不存在：" + targetId);
            const key = JSON.stringify([
                targetId,
                choice.value.mapping.assetId,
              ]),
              part = await this.part(
                id,
                p,
                key,
                choice.value.mapping.assetId,
                targetId,
                generation,
              );
            return part ? { targetId, object, part, key } : undefined;
          },
        ),
      );
      if (
        nonce !== p.nonce ||
        generation !== this.runtime.generation ||
        this.products.get(id) !== p
      )
        return;
      const activeSlots = slots.filter((slot): slot is Slot => Boolean(slot));
      const descendant = (object: THREE.Object3D, parent: THREE.Object3D) => {
        let cursor: THREE.Object3D | null = object;
        while (cursor) {
          if (cursor === parent) return true;
          cursor = cursor.parent;
        }
        return false;
      };
      for (const a of activeSlots)
        for (const b of activeSlots)
          if (a !== b && descendant(a.object, b.object))
            throw Error(
              "配置部件槽位重叠，请合并为独立槽位：" +
                a.targetId +
                " / " +
                b.targetId,
            );
      const oldPartRoots = new Set<THREE.Object3D>(
        [...p.parts.values()].map((part) => part.root),
      );
      const effective = (targetId: string) => {
        const object = this.runtime.getObject(targetId);
        if (!object) throw Error("配置绑定对象不存在：" + targetId);
        const slot = activeSlots.find((slot) =>
          descendant(object, slot.object),
        );
        if (slot) {
          let target: THREE.Object3D = slot.part.root;
          if (object !== slot.object) {
            const binding = getComponent(
                this.runtime.entity(targetId)!,
                "ModelNode",
              ),
              source = String(
                binding?.data.sourceElementId ??
                  object.userData.gltfSourceElementId ??
                  "",
              );
            if (!source || source.startsWith("unresolved:"))
              throw Error("替换部件的子映射需要稳定来源 ID：" + targetId);
            const matches = slot.part.sourceObjects.get(source) ?? [];
            if (matches.length !== 1)
              throw Error("替换部件中子绑定缺失或不唯一：" + source);
            target = matches[0];
            target.userData.entityId = targetId;
          }
          return {
            object: target,
            assetId: slot.part.assetId,
            nativeObjects: slot.part.nativeObjects,
            ownerId: slot.targetId,
            globalRoot: object === slot.object,
          };
        }
        const entity = this.runtime.entity(targetId)!,
          node = getComponent(entity, "ModelNode"),
          ownerId = node ? String(node.data.modelEntityId) : targetId,
          owner = this.runtime.objects.get(ownerId),
          model = getComponent(this.runtime.entity(ownerId)!, "Model");
        return {
          object,
          assetId: String(model?.data.assetId ?? ""),
          nativeObjects: owner?.nativeObjects ?? new Set<THREE.Object3D>(),
          ownerId,
          globalRoot: !node && Boolean(model),
        };
      };
      const renderMeshes = (targetId: string): THREE.Mesh[] => {
        const context = effective(targetId),
          meshes: THREE.Mesh[] = [];
        const walk = (object: THREE.Object3D, prepared = false) => {
          const slot = !prepared
            ? activeSlots.find((slot) => slot.object === object)
            : undefined;
          if (slot) {
            walk(slot.part.root, true);
            return;
          }
          if (!prepared && oldPartRoots.has(object)) return;
          if (object instanceof THREE.Mesh && !object.userData.collider)
            meshes.push(object);
          for (const child of object.children) walk(child, prepared);
        };
        walk(
          context.object,
          activeSlots.some((slot) =>
            descendant(context.object, slot.part.root),
          ),
        );
        return meshes;
      };
      for (const slot of activeSlots) {
        const choice = slotChoices.get(slot.targetId)!;
        for (const source of choice.sources)
          candidates.push({
            key: slot.object.uuid + ":attachment",
            priority: source.priority,
            signature: slot.part.assetId,
            source,
            value: {
              targetId: slot.targetId,
              object: slot.object,
              channel: "attachment",
              composition: "replace",
              value: slot.part.root,
            },
          });
      }
      const globalVariants = new Map<string, string>();
      await Promise.all(
        mappings
          .filter(
            (item) => !["swapPart", "camera"].includes(item.mapping.operation),
          )
          .map(async ({ mapping, source }) => {
            const context = effective(mapping.targetId),
              push = (
                object: THREE.Object3D,
                channel: VisualOverride["channel"],
                value: VisualOverride["value"],
                signature: string,
              ) => {
                const override: VisualOverride = {
                  targetId: mapping.targetId,
                  object,
                  channel,
                  composition: "replace",
                  value,
                };
                candidates.push({
                  key: object.uuid + ":" + channel,
                  priority: source.priority,
                  signature,
                  value: override,
                  source,
                });
                return override;
              };
            if (mapping.operation === "variant") {
              if (!context.assetId || !this.runtime.store)
                throw Error("变体目标必须属于 GLTF 模型");
              if (p.catalog.variantPolicy === "global-variant") {
                if (!context.globalRoot)
                  throw Error("全局 glTF 变体必须绑定模型或部件根");
                const previous = globalVariants.get(context.ownerId);
                if (previous && previous !== mapping.variant)
                  throw Error("同一 GLTF 模型只能激活一个全局变体");
                globalVariants.set(context.ownerId, mapping.variant);
              }
              const targets = renderMeshes(mapping.targetId).filter((object) =>
                  context.nativeObjects.has(object),
                ),
                variants = await this.runtime.store.variant(
                  context.assetId,
                  targets,
                  mapping.variant,
                );
              if (!variants.size)
                throw Error(
                  "所选目标没有此变体的 primitive 映射：" + mapping.variant,
                );
              for (const [mesh, assignment] of variants) {
                const override = push(
                  mesh,
                  "material",
                  assignment.material,
                  context.assetId + ":" + assignment.materialIndex,
                );
                let node: THREE.Object3D | null = mesh;
                while (node && !node.userData.gltfSourceElementId)
                  node = node.parent;
                materialProof.set(override, {
                  modelEntityId: context.ownerId,
                  sourceElementId: String(
                    node?.userData.gltfSourceElementId ?? "",
                  ),
                  assetId: context.assetId,
                  meshIndex: assignment.meshIndex,
                  primitiveIndex: assignment.primitiveIndex,
                  materialIndex: assignment.materialIndex,
                  variant: mapping.variant,
                });
              }
            } else if (
              mapping.operation === "color" ||
              mapping.operation === "opacity"
            ) {
              const value =
                mapping.operation === "opacity"
                  ? strictNumber(mapping.value)
                  : mapping.value;
              if (typeof value === "number" && (value < 0 || value > 1))
                throw Error("透明度必须为 0～1");
              for (const mesh of renderMeshes(mapping.targetId))
                push(mesh, mapping.operation, value, String(value));
            } else if (mapping.operation === "visibility") {
              if (!["true", "false"].includes(mapping.value))
                throw Error("可见性必须为 true 或 false");
              push(
                activeSlots.find((slot) => slot.targetId === mapping.targetId)
                  ?.object ?? context.object,
                "visibility",
                mapping.value === "true",
                mapping.value,
              );
            } else if (mapping.operation === "transform") {
              const object =
                  activeSlots.find((slot) => slot.targetId === mapping.targetId)
                    ?.object ?? context.object,
                units = this.runtime.sourceUnits(
                  this.runtime.entity(mapping.targetId)!,
                ),
                base = this.runtime.visual.baseTransform(object),
                binding = mapping.numericBinding,
                transform = binding
                  ? structuredClone(base)
                  : {
                      ...structuredClone(mapping.transform),
                      position: mapping.transform.position.map(
                        (value) => value / units,
                      ) as [number, number, number],
                    };
              const fields: {
                property: "position" | "scale" | "rotation";
                axis: number;
              }[] = [];
              if (binding && binding.property !== "opacity") {
                if (binding.property === "rotation") {
                  const q = new THREE.Quaternion().fromArray(
                    mapping.transform.rotation,
                  );
                  if (binding.mode === "add")
                    q.premultiply(
                      new THREE.Quaternion().fromArray(base.rotation),
                    );
                  transform.rotation = q.toArray() as typeof transform.rotation;
                  fields.push({ property: "rotation", axis: -1 });
                } else
                  for (const axis of binding.axis === "all"
                    ? [0, 1, 2]
                    : [{ x: 0, y: 1, z: 2 }[binding.axis]]) {
                    const value =
                      mapping.transform[binding.property][axis] /
                      (binding.property === "position" ? units : 1);
                    transform[binding.property][axis] =
                      (binding.mode === "add"
                        ? base[binding.property][axis]
                        : 0) + value;
                    fields.push({ property: binding.property, axis });
                  }
              } else {
                for (const property of ["position", "scale"] as const)
                  for (const axis of [0, 1, 2]) fields.push({ property, axis });
                fields.push({ property: "rotation", axis: -1 });
              }
              for (const field of fields) {
                const override: VisualOverride = {
                  targetId: mapping.targetId,
                  object,
                  channel: "transform",
                  composition: "replace",
                  value: transform,
                };
                transformFields.set(override, field);
                candidates.push({
                  key:
                    object.uuid +
                    ":transform:" +
                    field.property +
                    ":" +
                    field.axis,
                  priority: source.priority,
                  signature: JSON.stringify([
                    binding?.mode ?? "set",
                    field.axis < 0
                      ? mapping.transform.rotation
                      : mapping.transform[field.property][field.axis] /
                        (field.property === "position" ? units : 1),
                  ]),
                  source,
                  value: override,
                });
              }
            }
          }),
      );
      if (
        nonce !== p.nonce ||
        generation !== this.runtime.generation ||
        this.products.get(id) !== p
      )
        return;
      const resolved = resolveVisualCandidates(candidates),
        overrides = [...resolved.values()]
          .filter((choice) => choice.value.channel !== "transform")
          .map((choice) => choice.value),
        table: MaterialAssignment[] = [],
        transforms = new Map<THREE.Object3D, VisualOverride>();
      for (const choice of resolved.values())
        if (choice.value.channel === "transform") {
          const override = choice.value,
            object = override.object!,
            field = transformFields.get(override)!,
            merged = transforms.get(object) ?? {
              ...override,
              value: this.runtime.visual.baseTransform(object),
            },
            transform =
              merged.value as import("../../scene-schema/src/types").Transform,
            incoming = override.value as typeof transform;
          if (field.axis < 0) transform.rotation = [...incoming.rotation];
          else
            transform[field.property][field.axis] =
              incoming[field.property][field.axis];
          transforms.set(object, merged);
        }
      overrides.push(...transforms.values());
      for (const choice of resolved.values())
        if (choice.value.channel === "material") {
          const proof = materialProof.get(choice.value)!;
          table.push({
            ...proof,
            variants: [
              ...new Set(
                choice.sources.map(
                  (source) =>
                    mappings.find(
                      (item) => item.source.mappingId === source.mappingId,
                    )?.mapping.variant ?? proof.variant,
                ),
              ),
            ],
            sources: choice.sources,
            shadowed: choice.shadowed,
          });
        }
      const cameras = resolveVisualCandidates(
        mappings
          .filter((item) => item.mapping.operation === "camera")
          .map((item) => ({
            key: "camera",
            priority: item.source.priority,
            signature: JSON.stringify([
              item.mapping.camera.position,
              item.mapping.camera.target,
              item.mapping.camera.fov,
            ]),
            source: item.source,
            value: item.mapping.camera,
          })),
      );
      this.runtime.visual.setScope(
        "configuration:" + id,
        overrides,
        "configuration",
        generation,
      );
      p.result = result;
      p.desired = result;
      p.materialAssignments = table.sort((a, b) =>
        JSON.stringify([
          a.modelEntityId,
          a.sourceElementId,
          a.meshIndex,
          a.primitiveIndex,
        ]).localeCompare(
          JSON.stringify([
            b.modelEntityId,
            b.sourceElementId,
            b.meshIndex,
            b.primitiveIndex,
          ]),
        ),
      );
      p.activeParts = new Set(activeSlots.map((slot) => slot.key));
      p.wantedParts = new Set(p.activeParts);
      this.releaseUnused(p);
      this.publish(id, p);
      const camera = cameras.get("camera")?.value;
      if (
        camera &&
        focusCamera &&
        cameraIntent === this.cameraIntent &&
        this.runtime.cameraOwnership.canAcquire("configuration")
      )
        await this.runtime.flyToPose(
          camera,
          0.6,
          this.runtime.playAbort.signal,
          undefined,
          "configuration",
        );
    } catch (error) {
      if (nonce === p.nonce) {
        p.desired = p.result;
        p.wantedParts = new Set(p.activeParts);
        this.releaseUnused(p);
        this.publish(id, p, false, String(error));
        throw error;
      }
    }
  }
  cancel(id: string): void {
    const p = this.product(id);
    p.nonce++;
    p.desired = p.result;
    p.wantedParts = new Set(p.activeParts);
    this.releaseUnused(p);
    this.publish(id, p, false, "已取消准备，保留上一有效配置");
  }
  reset(id: string, focusCamera = true): Promise<void> {
    const p = this.product(id);
    return this.apply(
      id,
      resolveConfiguration(
        p.catalog,
        defaultConfiguration(p.catalog),
        {},
        { compiled: p.compiled },
      ),
      focusCamera,
    );
  }
  actions: Record<string, (a: BehaviorAction) => Promise<void>> = {
    "studio.configurator.Select": (a) =>
      this.select(a.targetId, String(a.data.groupId), String(a.data.optionId)),
    "studio.configurator.Reset": (a) => this.reset(a.targetId),
    "studio.configurator.Cancel": async (a) => this.cancel(a.targetId),
    "studio.configurator.SetNumber": (a) =>
      this.setNumber(a.targetId, String(a.data.groupId), Number(a.data.value)),
  };
  mode(mode: "edit" | "play"): void {
    for (const [id, p] of this.products) {
      p.nonce++;
      this.runtime.visual.reset("configuration:" + id);
      p.activeParts.clear();
      p.wantedParts.clear();
      this.releaseUnused(p);
      if (mode === "play")
        this.runtime.track(
          this.reset(id, false).catch((error) => this.runtime.issue(id, error)),
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
