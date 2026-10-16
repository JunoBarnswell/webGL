import schema from "../scene-document.schema.json";
import { remapSceneReferences, type ReferenceSchema } from "./references";
import type { Entity, JsonValue, SceneDocument, Transform } from "./types";
export interface PrefabOverride {
  localId: string;
  componentType: string;
  path: string[];
  value: JsonValue;
  remove: boolean;
}
export interface PrefabInstance {
  id: string;
  prefabId: string;
  revisionId: string;
  rootLocalId: string;
  name: string;
  parentId: string | null;
  transform: Transform;
  source: SceneDocument;
  bindings: Record<string, Record<string, string>>;
  overrides: PrefabOverride[];
  additions: Entity[];
  tombstones: string[];
}
export interface PrefabRevision {
  id: string;
  revisionId: string;
  name: string;
  rootLocalId: string;
  document: SceneDocument;
}
export type PrefabConflict = {
  key: string;
  localId: string;
  field: string;
  base: JsonValue;
  source: JsonValue;
  instance: JsonValue;
};
export const prefabGroups = {
  entities: "entity",
  materials: "material",
  contents: "content",
  viewpoints: "viewpoint",
  tours: "tour",
  variables: "variable",
  behaviors: "behavior",
} as const;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export function sourceDocument(document: SceneDocument): SceneDocument {
  const result = copy(document);
  for (const instance of result.prefabs ?? []) {
    for (const [key, kind] of Object.entries(prefabGroups)) {
      const generated = new Set(Object.values(instance.bindings[kind] ?? {}));
      (result as unknown as Record<string, unknown>)[key] = (
        result[key as keyof typeof prefabGroups] as { id: string }[]
      ).filter((x) => !generated.has(x.id));
    }
    for (const [key, kind] of [
      ["nodes", "ui"],
      ["layouts", "layout"],
    ]) {
      const generated = new Set(Object.values(instance.bindings[kind] ?? {}));
      result.ui[key as "nodes"] = result.ui[key as "nodes"].filter(
        (x) => !generated.has(x.id),
      );
    }
  }
  return result;
}
export function effectivePrefab(
  instance: PrefabInstance,
  chain: string[] = [],
): SceneDocument {
  if (chain.includes(instance.prefabId) || chain.length >= 8)
    throw Error(
      "预制体循环或嵌套过深：" + [...chain, instance.prefabId].join(" → "),
    );
  const source = compilePrefabs(instance.source, [...chain, instance.prefabId]);
  source.entities.push(...copy(instance.additions));
  const removed = new Set(instance.tombstones);
  for (let changed = true; changed; ) {
    changed = false;
    for (const e of source.entities)
      if (e.parentId && removed.has(e.parentId) && !removed.has(e.id)) {
        removed.add(e.id);
        changed = true;
      }
  }
  source.entities = source.entities.filter((e) => !removed.has(e.id));
  for (const override of instance.overrides) {
    if (override.componentType === "$material") {
      const material = source.materials.find((m) => m.id === override.localId);
      if (!material || override.path.length !== 1)
        throw Error("覆盖材质已丢失");
      (material as unknown as Record<string, unknown>)[override.path[0]] = copy(
        override.value,
      );
      continue;
    }
    const entity = source.entities.find((e) => e.id === override.localId);
    if (!entity) throw Error("覆盖目标已丢失：" + override.localId);
    let target: Record<string, unknown> = entity as unknown as Record<
      string,
      unknown
    >;
    if (override.componentType) {
      const index = entity.components.findIndex(
        (c) => c.type === override.componentType,
      );
      if (!override.path.length) {
        if (index >= 0) entity.components.splice(index, 1);
        if (!override.remove)
          entity.components.push(
            copy(override.value) as unknown as Entity["components"][number],
          );
        continue;
      }
      if (index < 0) throw Error("覆盖组件已丢失：" + override.componentType);
      target = entity.components[index] as unknown as Record<string, unknown>;
    }
    for (const key of override.path.slice(0, -1)) {
      if (
        !target[key] ||
        typeof target[key] !== "object" ||
        Array.isArray(target[key])
      )
        throw Error("覆盖路径不可解析");
      target = target[key] as Record<string, unknown>;
    }
    const key = override.path.at(-1);
    if (
      !key ||
      ["__proto__", "constructor", "prototype"].some((v) =>
        override.path.includes(v),
      )
    )
      throw Error("覆盖路径非法");
    if (override.remove) delete target[key];
    else target[key] = copy(override.value);
  }
  if (!source.entities.some((e) => e.id === instance.rootLocalId))
    throw Error("预制体根节点已丢失");
  return source;
}
export function compilePrefabs(
  input: SceneDocument,
  chain: string[] = [],
): SceneDocument {
  if (!input.prefabs?.length) return copy(input);
  const document = sourceDocument(input);
  const unique = new Set(document.entities.map((e) => e.id));
  for (const instance of document.prefabs ?? []) {
    const source = effectivePrefab(instance, chain);
    const mapped = remapSceneReferences(
      source,
      schema as unknown as ReferenceSchema,
      instance.bindings,
    ) as SceneDocument;
    for (const [key, kind] of Object.entries(prefabGroups)) {
      const group = mapped[key as keyof typeof prefabGroups] as {
        id: string;
      }[];
      for (const item of group) {
        const id = instance.bindings[kind]?.[item.id];
        if (!id) throw Error("预制体映射缺失：" + kind + "/" + item.id);
        if (kind === "entity" && unique.has(id))
          throw Error("预制体实体映射冲突：" + id);
        if (kind === "entity") unique.add(id);
        const localId = item.id;
        item.id = id;
        if (kind === "entity" && localId === instance.rootLocalId)
          Object.assign(item, {
            name: instance.name,
            parentId: instance.parentId,
            transform: copy(instance.transform),
          });
        (document[key as keyof typeof prefabGroups] as { id: string }[]).push(
          item,
        );
      }
    }
    for (const [key, kind] of [
      ["nodes", "ui"],
      ["layouts", "layout"],
    ])
      for (const item of mapped.ui[key as "nodes"]) {
        const id = instance.bindings[kind]?.[item.id];
        if (!id) throw Error("预制体 UI 映射缺失");
        item.id = id;
        (document.ui[key as "nodes"] as { id: string }[]).push(item);
      }
    for (const asset of source.assets)
      if (!document.assets.some((a) => a.id === asset.id))
        document.assets.push(asset);
    for (const required of source.requiredExtensions)
      if (!document.requiredExtensions.some((e) => e.id === required.id))
        document.requiredExtensions.push(required);
    if (document.entities.length > 100000)
      throw Error("预制体展开超过实体限额");
  }
  return document;
}
export function prefabFieldDiff(base: Entity, next: Entity): PrefabOverride[] {
  const result: PrefabOverride[] = [];
  const walk = (
    a: unknown,
    b: unknown,
    path: string[],
    componentType: string,
  ) => {
    if (equal(a, b)) return;
    if (
      a &&
      b &&
      typeof a === "object" &&
      typeof b === "object" &&
      !Array.isArray(a) &&
      !Array.isArray(b)
    ) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
        walk(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
          [...path, key],
          componentType,
        );
    } else
      result.push({
        localId: base.id,
        componentType,
        path,
        value: (b ?? null) as JsonValue,
        remove: b === undefined,
      });
  };
  for (const key of [
    "name",
    "parentId",
    "visible",
    "locked",
    "transform",
  ] as const)
    walk(base[key], next[key], [key], "");
  const types = new Set(
    [...base.components, ...next.components].map((c) => c.type),
  );
  for (const type of types) {
    const a = base.components.find((c) => c.type === type),
      b = next.components.find((c) => c.type === type);
    if (!a || !b) {
      if (!equal(a, b))
        result.push({
          localId: base.id,
          componentType: type,
          path: [],
          value: (b ?? null) as unknown as JsonValue,
          remove: !b,
        });
    } else walk(a, b, [], type);
  }
  return result;
}
export function prefabOverrideKey(override: PrefabOverride): string {
  return [override.localId, override.componentType, ...override.path].join("/");
}
