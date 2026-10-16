import { current, isDraft, original, freeze } from "immer";
import {
  createDocument,
  assertDocument,
  documentReferences,
  remapSceneReferences,
  rewriteDocumentReferences,
  validateDocument,
  type ReferenceEdge,
  type Entity,
  type SceneDocument,
} from "@studio/scene-schema";
import {
  compilePrefabs,
  effectivePrefab,
  prefabFieldDiff,
  prefabGroups,
  prefabOverrideKey,
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
export interface PrefabSourceLevel {
  path: string;
  instance: PrefabInstance;
  document: SceneDocument;
  parentRevision: string;
}
/** Resolve ancestry in each source's own ID space; outer edits become overrides of its pinned child. */
export function prefabSourcePath(
  document: SceneDocument,
  entityId: string,
): PrefabSourceLevel[] {
  const levels: PrefabSourceLevel[] = [];
  let context = document,
    selected = entityId,
    parentRevision = "",
    path = "";
  for (let depth = 0; depth < 8; depth++) {
    const instance = prefabForEntity(context, selected);
    if (!instance) break;
    path += (path ? "/" : "") + instance.id;
    levels.push({ path, instance, document: context, parentRevision });
    const local = Object.entries(instance.bindings.entity ?? {}).find(
      ([, global]) => global === selected,
    )?.[0];
    if (!local) break;
    const before = compilePrefabs(instance.source),
      effective = effectivePrefab(instance);
    capturePrefabEdits(before, effective);
    parentRevision = instance.revisionId;
    context = effective;
    selected = local;
  }
  return levels;
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
function preparePrefabRevision(
  doc: SceneDocument,
  ids: string[],
  revision: PrefabRevision,
  choices: Record<string, "source" | "instance">,
): SceneDocument {
  const source = sourceDocument(doc);
  for (const instance of source.prefabs?.filter((i) => ids.includes(i.id)) ??
    []) {
    const conflicts = previewPrefabUpdate(instance, revision);
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
            if (e.parentId && removed.has(e.parentId) && !removed.has(e.id)) {
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
  return source;
}

export interface PrefabTreeChange {
  instanceId: string;
  collection: string;
  localId: string;
  kind:
    | "added"
    | "removed"
    | "renamed"
    | "moved"
    | "component"
    | "field"
    | "resource";
  path: string[];
  base: unknown;
  source: unknown;
}
export interface PrefabReferenceMigration {
  kind: string;
  fromId: string;
  toId?: string;
  retain?: boolean;
}
export interface PrefabUpdatePlan {
  prefabId: string;
  newRevision: string;
  oldRevisions: Record<string, string>;
  selectedInstances: string[];
  conflicts: (PrefabConflict & {
    instanceId: string;
    choice?: "source" | "instance";
  })[];
  changes: PrefabTreeChange[];
  impactedReferences: (ReferenceEdge & { resolution: string })[];
  migrations: PrefabReferenceMigration[];
  changedEntities: string[];
  validationErrors: string[];
  ready: boolean;
}
const preparedPrefabPlans = new WeakMap<
  PrefabUpdatePlan,
  { base: SceneDocument; source: SceneDocument }
>();
export interface PreparedPrefabUpdate {
  plan: PrefabUpdatePlan;
  source: SceneDocument;
}
/** Transfer a derived plan from the editor's cancellable worker, never into authored documents. */
export function exportPrefabPlan(plan: PrefabUpdatePlan): PreparedPrefabUpdate {
  const prepared = preparedPrefabPlans.get(plan);
  if (!prepared) throw Error("未知模板计划");
  return { plan: plain(plan), source: plain(prepared.source) };
}
export function acceptPrefabPlan(
  base: SceneDocument,
  prepared: PreparedPrefabUpdate,
): PrefabUpdatePlan {
  if (
    base.sceneId !== prepared.source.sceneId ||
    prepared.plan.selectedInstances.some(
      (id) =>
        base.prefabs?.find((i) => i.id === id)?.revisionId !==
        prepared.plan.oldRevisions[id],
    )
  )
    throw Error("计划来源场景或固定修订已变化");
  const plan = freeze(prepared.plan, true);
  preparedPrefabPlans.set(plan, { base, source: prepared.source });
  return plan;
}
export function prefabRevisionDiff(
  instance: PrefabInstance,
  revision: PrefabRevision,
): PrefabTreeChange[] {
  const base = compilePrefabs(instance.source),
    next = compilePrefabs(revision.document),
    changes: PrefabTreeChange[] = [];
  const group = (
    collection: string,
    before: { id: string }[],
    after: { id: string }[],
  ) => {
    const old = new Map(before.map((value) => [value.id, value])),
      now = new Map(after.map((value) => [value.id, value]));
    for (const id of new Set([...old.keys(), ...now.keys()])) {
      const a = old.get(id),
        b = now.get(id);
      if (!a || !b)
        changes.push({
          instanceId: instance.id,
          collection,
          localId: id,
          kind: a ? "removed" : "added",
          path: [],
          base: a ?? null,
          source: b ?? null,
        });
      else if (collection === "entities")
        for (const field of prefabFieldDiff(a as Entity, b as Entity)) {
          let previous: unknown = field.componentType
            ? (a as Entity).components.find(
                (c) => c.type === field.componentType,
              )
            : a;
          for (const key of field.path)
            previous =
              previous && typeof previous === "object"
                ? (previous as Record<string, unknown>)[key]
                : undefined;
          changes.push({
            instanceId: instance.id,
            collection,
            localId: id,
            kind: field.componentType
              ? "component"
              : field.path[0] === "name"
                ? "renamed"
                : field.path[0] === "parentId"
                  ? "moved"
                  : "field",
            path: [
              ...(field.componentType ? [field.componentType] : []),
              ...field.path,
            ],
            base: previous ?? null,
            source: field.remove ? null : field.value,
          });
        }
      else if (!eq(a, b))
        changes.push({
          instanceId: instance.id,
          collection,
          localId: id,
          kind: collection === "assets" ? "resource" : "field",
          path: [],
          base: a,
          source: b,
        });
    }
  };
  for (const key of [...Object.keys(prefabGroups), "assets"] as (
    | keyof typeof prefabGroups
    | "assets"
  )[])
    group(key, base[key], next[key]);
  group("ui.nodes", base.ui.nodes, next.ui.nodes);
  group("ui.layouts", base.ui.layouts, next.ui.layouts);
  group("prefabs", base.prefabs ?? [], next.prefabs ?? []);
  return changes;
}
/** Plan generation is pure. Every reference impact is known before any edit is submitted. */
export function planPrefabUpdate(
  document: SceneDocument,
  selectedIds: string[],
  revision: PrefabRevision,
  choices: Record<string, "source" | "instance"> = {},
  migrations: PrefabReferenceMigration[] = [],
): PrefabUpdatePlan {
  assertDocument(revision.document);
  const selected =
    document.prefabs?.filter((i) => selectedIds.includes(i.id)) ?? [];
  if (!selected.length || new Set(selectedIds).size !== selected.length)
    throw Error("升级计划包含已删除或重复的实例");
  if (selected.some((i) => i.prefabId !== revision.id))
    throw Error("升级计划不能混合不同来源的模板");
  const conflicts = selected.flatMap((instance) =>
    previewPrefabUpdate(instance, revision).map((conflict) => ({
      ...conflict,
      instanceId: instance.id,
      choice: choices[instance.id + ":" + conflict.key],
    })),
  );
  const effectiveChoices = { ...choices };
  for (const conflict of conflicts)
    effectiveChoices[conflict.instanceId + ":" + conflict.key] ??= "instance";
  const source = preparePrefabRevision(
    document,
    selectedIds,
    revision,
    effectiveChoices,
  );
  const preliminary = compilePrefabs(source);
  const available = new Map<string, Set<string>>();
  for (const [key, kind] of Object.entries(prefabGroups))
    available.set(
      kind,
      new Set(
        (preliminary[key as keyof typeof prefabGroups] as { id: string }[]).map(
          (item) => item.id,
        ),
      ),
    );
  available.set("asset", new Set(preliminary.assets.map((a) => a.id)));
  available.set("ui", new Set(preliminary.ui.nodes.map((n) => n.id)));
  available.set("layout", new Set(preliminary.ui.layouts.map((l) => l.id)));
  const impacts = documentReferences(preliminary)
    .filter(
      (edge) =>
        available.has(edge.kind) && !available.get(edge.kind)!.has(edge.id),
    )
    .map((edge) => ({ ...edge, resolution: "" }));
  for (const migration of migrations) {
    if (migration.retain) {
      if (migration.kind !== "entity" || migration.toId)
        throw Error("仅实体可保留为本地增项，且不能同时重定向");
      const oldInstance = selected.find((i) =>
        Object.values(i.bindings.entity ?? {}).includes(migration.fromId),
      );
      if (!oldInstance) throw Error("保留目标不属于选中的模板实例");
      const instance = source.prefabs!.find((i) => i.id === oldInstance.id)!;
      const localId = Object.entries(oldInstance.bindings.entity).find(
        ([, id]) => id === migration.fromId,
      )![0];
      const previous = effectivePrefab(oldInstance),
        next = effectivePrefab(instance),
        present = new Set(next.entities.map((e) => e.id));
      let entity = previous.entities.find((e) => e.id === localId);
      while (entity && !present.has(entity.id)) {
        instance.additions.push(plain(entity));
        present.add(entity.id);
        entity = previous.entities.find((e) => e.id === entity!.parentId);
      }
      for (const impact of impacts)
        if (impact.kind === migration.kind && impact.id === migration.fromId)
          impact.resolution = "保留为本地增项";
    }
  }
  const beforeRewrite = compilePrefabs(source),
    redirects: Record<string, Record<string, string>> = {};
  for (const migration of migrations)
    if (migration.toId) {
      if (migration.retain || migration.fromId === migration.toId)
        throw Error("引用迁移目标无效");
      const targets =
        migration.kind === "entity"
          ? beforeRewrite.entities
          : migration.kind === "material"
            ? beforeRewrite.materials
            : migration.kind === "asset"
              ? beforeRewrite.assets
              : migration.kind === "content"
                ? beforeRewrite.contents
                : migration.kind === "viewpoint"
                  ? beforeRewrite.viewpoints
                  : migration.kind === "tour"
                    ? beforeRewrite.tours
                    : migration.kind === "variable"
                      ? beforeRewrite.variables
                      : migration.kind === "ui"
                        ? beforeRewrite.ui.nodes
                        : migration.kind === "layout"
                          ? beforeRewrite.ui.layouts
                          : [];
      if (!targets.some((target) => target.id === migration.toId))
        throw Error("引用迁移目标不存在：" + migration.toId);
      (redirects[migration.kind] ??= {})[migration.fromId] = migration.toId;
      for (const impact of impacts)
        if (impact.kind === migration.kind && impact.id === migration.fromId)
          impact.resolution = migration.toId;
    }
  const candidate = rewriteDocumentReferences(beforeRewrite, redirects);
  capturePrefabEdits(beforeRewrite, candidate);
  // Old bindings cannot claim ownership of author-authored objects after a source deletion.
  for (const instance of candidate.prefabs!.filter((i) =>
    selectedIds.includes(i.id),
  )) {
    const effective = effectivePrefab(instance);
    for (const [key, kind] of Object.entries(prefabGroups)) {
      const localIds = new Set(
        (effective[key as keyof typeof prefabGroups] as { id: string }[]).map(
          (item) => item.id,
        ),
      );
      instance.bindings[kind] = Object.fromEntries(
        Object.entries(instance.bindings[kind] ?? {}).filter(([id]) =>
          localIds.has(id),
        ),
      );
    }
    for (const [key, kind] of [
      ["nodes", "ui"],
      ["layouts", "layout"],
    ] as const) {
      const ids = new Set(effective.ui[key].map((item) => item.id));
      instance.bindings[kind] = Object.fromEntries(
        Object.entries(instance.bindings[kind] ?? {}).filter(([id]) =>
          ids.has(id),
        ),
      );
    }
  }

  const validationErrors = validateDocument(candidate);
  const beforeIds = new Map(document.entities.map((e) => [e.id, e])),
    afterIds = new Map(candidate.entities.map((e) => [e.id, e]));
  const plan: PrefabUpdatePlan = freeze(
    {
      prefabId: revision.id,
      newRevision: revision.revisionId,
      oldRevisions: Object.fromEntries(
        selected.map((i) => [i.id, i.revisionId]),
      ),
      selectedInstances: [...selectedIds],
      conflicts,
      changes: selected.flatMap((instance) =>
        prefabRevisionDiff(instance, revision),
      ),
      impactedReferences: impacts,
      migrations: plain(migrations),
      changedEntities: [
        ...new Set([...beforeIds.keys(), ...afterIds.keys()]),
      ].filter((id) => !eq(beforeIds.get(id), afterIds.get(id))),
      validationErrors,
      ready:
        conflicts.every((c) => Boolean(c.choice)) && !validationErrors.length,
    },
    true,
  );
  preparedPrefabPlans.set(plan, {
    base: document,
    source: sourceDocument(candidate),
  });
  return plan;
}
export function applyPrefabUpdatePlan(plan: PrefabUpdatePlan): EditorCommand {
  return {
    kind: "prefab",
    label: "执行预制体变更计划",
    mutate(doc) {
      const prepared = preparedPrefabPlans.get(plan);
      if (!prepared || (isDraft(doc) ? original(doc) : doc) !== prepared.base)
        throw Error("场景已变化，请重新生成预制体升级计划");
      if (!plan.ready)
        throw Error(
          "升级计划未就绪：" +
            [
              ...plan.conflicts.filter((c) => !c.choice).map((c) => c.field),
              ...plan.validationErrors,
            ].join("；"),
        );
      Object.assign(doc, plain(prepared.source));
      recompilePrefabs(doc);
    },
  };
}
export function updatePrefabInstances(
  ids: string[],
  revision: PrefabRevision,
  choices: Record<string, "source" | "instance"> = {},
  migrations: PrefabReferenceMigration[] = [],
): EditorCommand {
  return {
    kind: "prefab",
    label: "原子升级预制体实例",
    mutate(doc) {
      const base = (isDraft(doc) ? original(doc) : doc) as SceneDocument;
      const plan = planPrefabUpdate(base, ids, revision, choices, migrations);
      applyPrefabUpdatePlan(plan).mutate(doc);
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
