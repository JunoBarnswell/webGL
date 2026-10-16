import { current } from "immer";
import * as THREE from "three";
import {
  actionDefinitions,
  entityReferences,
  walkActions,
  componentDefinitions,
  createEntity,
  type Entity,
  type JsonValue,
  type SceneDocument,
  type FieldSchema,
} from "@studio/scene-schema";
import type { EditorCommand } from "./EditorSession";

function walkReference(
  value: JsonValue,
  field: FieldSchema,
  remap: Map<string, string>,
): JsonValue {
  if (field["x-reference"] === "entity" && typeof value === "string")
    return remap.get(value) ?? value;
  if (Array.isArray(value) && field.items)
    return value.map((item) => walkReference(item, field.items!, remap));
  if (
    value &&
    !Array.isArray(value) &&
    typeof value === "object" &&
    field.properties
  )
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        field.properties![key]
          ? walkReference(item, field.properties![key], remap)
          : item,
      ]),
    );
  return value;
}
export function descendants(
  document: SceneDocument,
  selected: string[],
): Set<string> {
  const result = new Set(selected);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const entity of document.entities)
      if (
        entity.parentId &&
        result.has(entity.parentId) &&
        !result.has(entity.id)
      ) {
        result.add(entity.id);
        expanded = true;
      }
  }
  return result;
}
export function addEntity(entity = createEntity()): EditorCommand {
  return {
    label: "新增节点",
    mutate: (doc) => {
      doc.entities.push(entity);
    },
  };
}
export function duplicateEntities(selected: string[]): EditorCommand {
  return {
    label: "复制节点",
    mutate: (doc) => {
      for (const id of selected) {
        const entity = doc.entities.find((e) => e.id === id);
        const node = entity?.components.find((c) => c.type === "ModelNode");
        if (node && !selected.includes(String(node.data.modelEntityId)))
          throw new Error("请复制所属模型实例，以保留骨骼和动画关联");
      }
      const ids = descendants(doc, selected);
      const remap = new Map([...ids].map((id) => [id, crypto.randomUUID()]));
      const copies = doc.entities
        .filter((e) => ids.has(e.id))
        .map((entity) => {
          const copy = structuredClone(current(entity));
          copy.id = remap.get(entity.id)!;
          copy.name += " 副本";
          copy.legacyUuid = "";
          if (copy.parentId)
            copy.parentId = remap.get(copy.parentId) ?? copy.parentId;
          for (const component of copy.components) {
            const definition = componentDefinitions.find(
              (d) => d.type === component.type,
            );
            for (const [key, field] of Object.entries(definition?.fields ?? {}))
              component.data[key] = walkReference(
                component.data[key],
                field,
                remap,
              );
          }
          return copy;
        });
      doc.entities.push(...copies);
      for (const behavior of [...doc.behaviors])
        if (ids.has(behavior.sourceId)) {
          const copy = structuredClone(current(behavior));
          copy.id = crypto.randomUUID();
          copy.sourceId = remap.get(copy.sourceId)!;
          walkActions(copy.actions, (action) => {
            const definition = actionDefinitions.find(
              (d) => d.type === action.type,
            );
            if (definition?.target === "entity")
              action.targetId = remap.get(action.targetId) ?? action.targetId;
            for (const [key, field] of Object.entries(definition?.fields ?? {}))
              action.data[key] = walkReference(action.data[key], field, remap);
          });
          doc.behaviors.push(copy);
        }
    },
  };
}
export function deleteEntities(selected: string[]): EditorCommand {
  return {
    label: "删除节点",
    mutate: (doc) => {
      const ids = descendants(doc, selected);
      if (
        doc.entities
          .filter((e) => !ids.has(e.id))
          .some((entity) =>
            entityReferences(entity).some(
              (ref) => ref.kind === "entity" && ids.has(ref.id),
            ),
          )
      )
        throw Error("对象仍被组件引用，请先解除锚定或关系");
      if (doc.entities.some((e) => ids.has(e.id) && e.locked))
        throw new Error("包含锁定节点，请先解锁");
      doc.entities = doc.entities.filter((entity) => !ids.has(entity.id));
      const clean = (
        actions: (typeof doc.behaviors)[number]["actions"],
      ): typeof actions =>
        actions
          .filter(
            (a) =>
              !(
                actionDefinitions.find((d) => d.type === a.type)?.target ===
                  "entity" && ids.has(a.targetId)
              ),
          )
          .map((a) => ({
            ...a,
            ...(a.then ? { then: clean(a.then) } : {}),
            ...(a.else ? { else: clean(a.else) } : {}),
          }));
      doc.behaviors = doc.behaviors
        .filter((b) => b.sourceKind !== "entity" || !ids.has(b.sourceId))
        .map((b) => ({ ...b, actions: clean(b.actions) }));
      for (const content of doc.contents)
        if (ids.has(content.audioEntityId)) content.audioEntityId = "";
      for (const node of doc.ui.nodes) {
        if (
          ["audioControls", "animationControls", "panoramaControls"].includes(
            node.kind,
          ) &&
          ids.has(node.targetId)
        )
          node.targetId = "";
        if (node.action) node.action = clean([node.action])[0] ?? null;
      }
      for (const view of doc.viewpoints)
        if (ids.has(view.anchorId))
          throw new Error("对象仍被稳定视点引用，请先解除视点锚定");
      for (const entity of doc.entities)
        entity.components = entity.components.filter(
          (c) =>
            !["ModelNode", "Animation"].includes(c.type) ||
            !ids.has(String(c.data.modelEntityId)),
        );
    },
  };
}
function world(document: SceneDocument, entity: Entity): THREE.Matrix4 {
  const local = new THREE.Matrix4().compose(
    new THREE.Vector3().fromArray(entity.transform.position),
    new THREE.Quaternion().fromArray(entity.transform.rotation),
    new THREE.Vector3().fromArray(entity.transform.scale),
  );
  const parent = document.entities.find((e) => e.id === entity.parentId);
  return parent ? world(document, parent).multiply(local) : local;
}
export function reparentEntity(
  id: string,
  parentId: string | null,
): EditorCommand {
  return {
    label: "调整层级",
    mutate: (doc) => {
      const entity = doc.entities.find((e) => e.id === id);
      if (!entity || entity.locked) return;
      if (parentId && descendants(doc, [id]).has(parentId))
        throw new Error("不能将节点放入其子节点");
      const before = world(doc, entity);
      const parent = doc.entities.find((e) => e.id === parentId);
      const local = parent
        ? world(doc, parent).invert().multiply(before)
        : before;
      const position = new THREE.Vector3(),
        rotation = new THREE.Quaternion(),
        scale = new THREE.Vector3();
      local.decompose(position, rotation, scale);
      // A non-uniformly scaled/rotated ancestry can introduce shear; reject rather than silently change shape.
      const reconstructed = new THREE.Matrix4().compose(
        position,
        rotation,
        scale,
      );
      if (
        reconstructed.elements.some(
          (n, index) => Math.abs(n - local.elements[index]) > 0.001,
        )
      )
        throw new Error("当前父级变换产生剪切，请先整理非均匀缩放");
      entity.parentId = parentId;
      entity.transform = {
        position: position.toArray(),
        rotation: rotation.normalize().toArray() as [
          number,
          number,
          number,
          number,
        ],
        scale: scale.toArray(),
      };
    },
  };
}
