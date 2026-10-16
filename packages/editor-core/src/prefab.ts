import { current, isDraft } from "immer";
import {
  createDocument,
  assertDocument,
  documentReferences,
  type Entity,
  type SceneDocument,
} from "@studio/scene-schema";
import {
  compilePrefabs,
  effectivePrefab,
  prefabFieldDiff,
  prefabGroups,
  prefabOverrideKey,
  remapSceneReferences,
  sourceDocument,
  type PrefabInstance,
  type PrefabRevision,
  type PrefabConflict,
} from "../../scene-schema/src/prefab";
import schema from "../../scene-schema/scene-document.schema.json";
import { descendants } from "./commands";
import type { EditorCommand } from "./EditorSession";
const plain = <T>(value: T): T =>
  JSON.parse(JSON.stringify(isDraft(value) ? current(value as object) : value));
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function recompilePrefabs(document: SceneDocument): void {
  const next = compilePrefabs(sourceDocument(document));
  for (const key of Object.keys(
    prefabGroups,
  ) as (keyof typeof prefabGroups)[]) {
    const old = document[key] as { id: string }[],
      incoming = next[key] as { id: string }[],
      byId = new Map(old.map((e) => [e.id, e]));
    const merged = incoming.map((e) => {
      const previous = byId.get(e.id);
      return previous && eq(previous, e) ? previous : e;
    });
    if (
      old.length === merged.length &&
      old.every((e, i) => e.id === merged[i].id)
    ) {
      merged.forEach((e, i) => {
        if (old[i] !== e) old[i] = e;
      });
      (next as unknown as Record<string, unknown>)[key] = old;
    } else (next as unknown as Record<string, unknown>)[key] = merged;
  }
  Object.assign(document, next);
}
export function createPrefabRevision(
  document: SceneDocument,
  rootId: string,
  name: string,
  prefabId = crypto.randomUUID(),
  revisionId = crypto.randomUUID(),
): PrefabRevision {
  const ids = descendants(document, [rootId]);
  const source = plain(document);
  source.prefabs = source.prefabs?.filter((i) =>
    ids.has(i.bindings.entity[i.rootLocalId]),
  );
  source.entities = source.entities.filter((e) => ids.has(e.id));
  const root = source.entities.find((e) => e.id === rootId);
  if (!root) throw Error("先选择一个完整层级的根节点");
  root.parentId = null;
  const nestedRoot = source.prefabs?.find(
    (i) => i.bindings.entity[i.rootLocalId] === rootId,
  );
  if (nestedRoot) {
    nestedRoot.parentId = null;
    nestedRoot.transform = {
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    };
  }
  root.transform = {
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
  };
  source.behaviors = source.behaviors.filter(
    (b) => b.sourceKind === "entity" && ids.has(b.sourceId),
  );
  source.viewpoints = source.viewpoints.filter((v) => ids.has(v.anchorId));
  source.tours = source.tours.filter((t) =>
    t.stops.every((s) => source.viewpoints.some((v) => v.id === s.viewpointId)),
  );
  const contentIds = new Set(
    source.entities.flatMap((e) =>
      e.components.flatMap((c) =>
        typeof c.data.contentId === "string" ? [c.data.contentId] : [],
      ),
    ),
  );
  source.contents = source.contents.filter((c) => contentIds.has(c.id));
  const layouts = new Set(
    source.contents.map((c) => c.layoutId).filter(Boolean),
  );
  source.ui.layouts = source.ui.layouts.filter((l) => layouts.has(l.id));
  source.ui.nodes = source.ui.nodes.filter((n) => layouts.has(n.layoutId));
  const refs = documentReferences(source);
  const materials = new Set(
    refs.filter((r) => r.kind === "material").map((r) => r.id),
  );
  source.materials = source.materials.filter((m) => materials.has(m.id));
  source.settings = createDocument().settings;
  const usedAssets = new Set(
    documentReferences(source)
      .filter((r) => r.kind === "asset")
      .map((r) => r.id),
  );
  source.assets = source.assets.filter((a) => usedAssets.has(a.id));
  source.name = name;
  source.sceneId = prefabId;
  assertDocument(source);
  return {
    id: prefabId,
    revisionId,
    name,
    rootLocalId: rootId,
    document: sourceDocument(source),
  };
}
export function newPrefabInstance(
  revision: PrefabRevision,
  position: [number, number, number] = [0, 0, 0],
): PrefabInstance {
  const source = compilePrefabs(revision.document),
    bindings: PrefabInstance["bindings"] = {};
  for (const [key, kind] of Object.entries(prefabGroups))
    bindings[kind] = Object.fromEntries(
      (source[key as keyof typeof prefabGroups] as { id: string }[]).map(
        (e) => [e.id, crypto.randomUUID()],
      ),
    );
  for (const [key, kind] of [
    ["nodes", "ui"],
    ["layouts", "layout"],
  ])
    bindings[kind] = Object.fromEntries(
      source.ui[key as "nodes"].map((e) => [e.id, crypto.randomUUID()]),
    );
  return {
    id: crypto.randomUUID(),
    prefabId: revision.id,
    revisionId: revision.revisionId,
    rootLocalId: revision.rootLocalId,
    source: plain(revision.document),
    name: revision.name,
    bindings,
    parentId: null,
    transform: { position, rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    overrides: [],
    additions: [],
    tombstones: [],
  };
}
export function instantiatePrefab(
  revision: PrefabRevision,
  position?: [number, number, number],
): { instance: PrefabInstance; command: EditorCommand } {
  const instance = newPrefabInstance(revision, position);
  return {
    instance,
    command: {
      kind: "prefab",
      label: "实例化预制体 " + revision.name,
      mutate(doc) {
        const source = sourceDocument(doc);
        (source.prefabs ??= []).push(instance);
        Object.assign(doc, source);
        recompilePrefabs(doc);
      },
    },
  };
}
export function prefabForEntity(
  document: SceneDocument,
  id: string,
): PrefabInstance | undefined {
  return document.prefabs?.find((i) =>
    Object.values(i.bindings.entity).includes(id),
  );
}
function reverse(instance: PrefabInstance): PrefabInstance["bindings"] {
  return Object.fromEntries(
    Object.entries(instance.bindings).map(([kind, map]) => [
      kind,
      Object.fromEntries(Object.entries(map).map(([a, b]) => [b, a])),
    ]),
  );
}
/** The same command that edits an effective entity records its authoring override. */
export function capturePrefabEdits(
  before: SceneDocument,
  draft: SceneDocument,
): void {
  if (!draft.prefabs?.length) return;
  const old = new Map(before.entities.map((e) => [e.id, e])),
    now = new Map(draft.entities.map((e) => [e.id, e]));
  for (const instance of draft.prefabs) {
    if (!before.prefabs?.some((i) => i.id === instance.id)) continue;
    const changed = Object.values(instance.bindings.entity).some(
      (id) => !now.has(id) || !eq(now.get(id), old.get(id)),
    );
    const owned = new Set(Object.values(instance.bindings.entity));
    const added = draft.entities.filter(
      (e) => !owned.has(e.id) && e.parentId && owned.has(e.parentId),
    );
    const materialChanged = Object.values(
      instance.bindings.material ?? {},
    ).some((id) => {
      const material = draft.materials.find((m) => m.id === id);
      return (
        material &&
        !eq(
          material,
          before.materials.find((m) => m.id === id),
        )
      );
    });
    if (!changed && !added.length && !materialChanged) continue;
    const root = now.get(instance.bindings.entity[instance.rootLocalId]);
    if (!root) {
      draft.prefabs = draft.prefabs.filter((i) => i.id !== instance.id);
      continue;
    }
    instance.name = root.name;
    instance.parentId = root.parentId;
    instance.transform = plain(root.transform);
    const source = compilePrefabs(instance.source);
    const addedIds = descendants(
      draft,
      added.map((e) => e.id),
    );
    for (const id of addedIds)
      if (!owned.has(id)) instance.bindings.entity[crypto.randomUUID()] = id;
    const unmap = reverse(instance);
    const locals = [...source.entities, ...plain(instance.additions)].map(
      (e) => e.id,
    );
    instance.additions = draft.entities
      .filter(
        (e) =>
          addedIds.has(e.id) ||
          instance.additions.some(
            (a) => instance.bindings.entity[a.id] === e.id,
          ),
      )
      .map((e) => {
        const entity = remapSceneReferences(
          plain(e),
          schema.properties.entities.items,
          unmap,
        ) as Entity;
        entity.id = unmap.entity[e.id];
        return entity;
      });
    const baseIds = new Set(source.entities.map((e) => e.id));
    instance.tombstones = locals.filter(
      (local) =>
        baseIds.has(local) && !now.has(instance.bindings.entity[local]),
    );
    instance.overrides = [];
    for (const base of source.entities) {
      const entity = now.get(instance.bindings.entity[base.id]);
      if (!entity) continue;
      const next = remapSceneReferences(
        plain(entity),
        schema.properties.entities.items,
        unmap,
      ) as Entity;
      next.id = base.id;
      if (base.id === instance.rootLocalId) {
        next.name = base.name;
        next.parentId = base.parentId;
        next.transform = base.transform;
      }
      instance.overrides.push(...prefabFieldDiff(base, next));
    }
    for (const base of source.materials) {
      const material = draft.materials.find(
        (m) => m.id === instance.bindings.material?.[base.id],
      );
      if (!material) continue;
      const next = remapSceneReferences(
        plain(material),
        schema.$defs.material,
        unmap,
      ) as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(base))
        if (key !== "id" && !eq(value, next[key]))
          instance.overrides.push({
            localId: base.id,
            componentType: "$material",
            path: [key],
            value: next[key] as never,
            remove: false,
          });
    }
  }
}
export function revisionFromInstance(
  document: SceneDocument,
  instance: PrefabInstance,
  name: string,
  keys?: string[],
): PrefabRevision {
  if (keys)
    instance = {
      ...instance,
      overrides: instance.overrides.filter((o) =>
        keys.includes(prefabOverrideKey(o)),
      ),
      additions: [],
      tombstones: [],
    };
  const before = compilePrefabs(instance.source),
    source = effectivePrefab(instance);
  capturePrefabEdits(before, source);
  const materialIds = new Set(
    documentReferences(source)
      .filter((r) => r.kind === "material")
      .map((r) => r.id),
  );
  for (const material of document.materials)
    if (
      materialIds.has(material.id) &&
      !source.materials.some((m) => m.id === material.id)
    )
      source.materials.push(plain(material));
  const assetIds = new Set(
    documentReferences(source)
      .filter((r) => r.kind === "asset")
      .map((r) => r.id),
  );
  for (const asset of document.assets)
    if (assetIds.has(asset.id) && !source.assets.some((a) => a.id === asset.id))
      source.assets.push(plain(asset));
  source.name = name;
  source.sceneId = instance.prefabId;
  assertDocument(source);
  return {
    id: instance.prefabId,
    revisionId: crypto.randomUUID(),
    name,
    rootLocalId: instance.rootLocalId,
    document: sourceDocument(source),
  };
}
export function previewPrefabUpdate(
  instance: PrefabInstance,
  revision: PrefabRevision,
): PrefabConflict[] {
  if (revision.id !== instance.prefabId) throw Error("不同预制体不能直接升级");
  const base = compilePrefabs(instance.source),
    latest = compilePrefabs(revision.document);
  const changed = latest.entities.flatMap((e) => {
    const previous = base.entities.find((b) => b.id === e.id);
    return previous ? prefabFieldDiff(previous, e) : [];
  });
  for (const material of latest.materials) {
    const previous = base.materials.find((m) => m.id === material.id);
    if (previous)
      for (const [key, value] of Object.entries(material))
        if (
          key !== "id" &&
          !eq(value, (previous as unknown as Record<string, unknown>)[key])
        )
          changed.push({
            localId: material.id,
            componentType: "$material",
            path: [key],
            value: value as never,
            remove: false,
          });
  }
  const conflicts: PrefabConflict[] = [];
  for (const override of instance.overrides) {
    const incoming = changed.find(
      (c) =>
        c.localId === override.localId &&
        c.componentType === override.componentType &&
        (c.path.every((key, i) => override.path[i] === key) ||
          override.path.every((key, i) => c.path[i] === key)),
    );
    const baseEntity = base.entities.find((e) => e.id === override.localId);
    let baseValue: unknown =
      override.componentType === "$material"
        ? base.materials.find((m) => m.id === override.localId)
        : override.componentType
          ? baseEntity?.components.find(
              (c) => c.type === override.componentType,
            )
          : baseEntity;
    for (const key of override.path)
      baseValue =
        baseValue && typeof baseValue === "object"
          ? (baseValue as Record<string, unknown>)[key]
          : undefined;
    if (incoming && !eq(incoming.value, override.value))
      conflicts.push({
        key: prefabOverrideKey(override),
        localId: override.localId,
        field: [override.componentType, ...override.path].join("."),
        base: (baseValue ?? null) as never,
        source: incoming.value,
        instance: override.value,
      });
    if (
      !latest.entities.some((e) => e.id === override.localId) &&
      override.componentType !== "$material"
    )
      conflicts.push({
        key: prefabOverrideKey(override),
        localId: override.localId,
        field: "删除目标",
        base: null,
        source: null,
        instance: override.value,
      });
  }
  for (const addition of instance.additions)
    if (
      addition.parentId &&
      base.entities.some((e) => e.id === addition.parentId) &&
      !latest.entities.some((e) => e.id === addition.parentId)
    )
      conflicts.push({
        key: "addition:" + addition.id,
        localId: addition.parentId,
        field: "新增节点的父目标已删除",
        base: addition.parentId,
        source: null,
        instance: addition.id,
      });
  return conflicts;
}
export function updatePrefabInstances(
  ids: string[],
  revision: PrefabRevision,
  choices: Record<string, "source" | "instance"> = {},
): EditorCommand {
  return {
    kind: "prefab",
    label: "原子升级预制体实例",
    mutate(doc) {
      const source = sourceDocument(doc);
      for (const instance of source.prefabs?.filter((i) =>
        ids.includes(i.id),
      ) ?? []) {
        const conflicts = previewPrefabUpdate(instance, revision);
        for (const conflict of conflicts)
          if (!choices[instance.id + ":" + conflict.key])
            throw Error("覆盖冲突尚未处理：" + conflict.field);
        instance.overrides = instance.overrides.filter(
          (o) => choices[instance.id + ":" + prefabOverrideKey(o)] !== "source",
        );
        const next = compilePrefabs(revision.document);
        for (const conflict of conflicts)
          if (
            conflict.key.startsWith("addition:") &&
            choices[instance.id + ":" + conflict.key] === "source"
          ) {
            const removed = new Set([conflict.key.slice(9)]);
            for (let changed = true; changed; ) {
              changed = false;
              for (const e of instance.additions)
                if (
                  e.parentId &&
                  removed.has(e.parentId) &&
                  !removed.has(e.id)
                ) {
                  removed.add(e.id);
                  changed = true;
                }
            }
            instance.additions = instance.additions.filter(
              (e) => !removed.has(e.id),
            );
          }
        for (const conflict of conflicts)
          if (
            choices[instance.id + ":" + conflict.key] === "instance" &&
            ["删除目标", "新增节点的父目标已删除"].includes(conflict.field)
          ) {
            const previousDoc = effectivePrefab(instance);
            let previous = previousDoc.entities.find(
              (e) => e.id === conflict.localId,
            );
            while (
              previous &&
              !next.entities.some((e) => e.id === previous!.id) &&
              !instance.additions.some((e) => e.id === previous!.id)
            ) {
              instance.additions.push(previous);
              previous = previousDoc.entities.find(
                (e) => e.id === previous!.parentId,
              );
            }
          }
        instance.source = plain(revision.document);
        instance.revisionId = revision.revisionId;
        instance.rootLocalId = revision.rootLocalId;
        for (const [key, kind] of Object.entries(prefabGroups))
          for (const item of next[key as keyof typeof prefabGroups] as {
            id: string;
          }[])
            (instance.bindings[kind] ??= {})[item.id] ??= crypto.randomUUID();
        for (const [key, kind] of [
          ["nodes", "ui"],
          ["layouts", "layout"],
        ])
          for (const item of next.ui[key as "nodes"])
            (instance.bindings[kind] ??= {})[item.id] ??= crypto.randomUUID();
        instance.tombstones = instance.tombstones.filter((id) =>
          next.entities.some((e) => e.id === id),
        );
      }
      Object.assign(doc, source);
      recompilePrefabs(doc);
    },
  };
}
export function revertPrefabOverride(
  instanceId: string,
  keys?: string[],
): EditorCommand {
  return {
    kind: "prefab",
    label: "恢复预制体默认值",
    mutate(doc) {
      const source = sourceDocument(doc),
        instance = source.prefabs?.find((i) => i.id === instanceId);
      if (!instance) throw Error("实例不存在");
      instance.overrides = keys
        ? instance.overrides.filter((o) => !keys.includes(prefabOverrideKey(o)))
        : [];
      if (!keys) {
        instance.additions = [];
        instance.tombstones = [];
      }
      Object.assign(doc, source);
      recompilePrefabs(doc);
    },
  };
}
export function detachPrefab(instanceId: string): EditorCommand {
  return {
    kind: "prefab",
    label: "拆离预制体",
    mutate(doc) {
      doc.prefabs = doc.prefabs?.filter((i) => i.id !== instanceId);
    },
  };
}
export function emptyPrefabDocument(): SceneDocument {
  return createDocument("预制体");
}
