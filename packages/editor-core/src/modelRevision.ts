import * as THREE from "three";
import {
  componentDefinitions,
  getComponent,
  type Entity,
  type SceneAsset,
  type SceneDocument,
} from "@studio/scene-schema";
import type { EditorCommand } from "./EditorSession";
export interface ModelRevisionReport {
  matched: string[];
  unmatched: string[];
  newElements: string[];
  mapping: Record<string, string>;
  conflicts: string[];
}
export interface ModelRevisionOptions {
  mapping?: Record<string, string>;
  keepUnmatched?: boolean;
  acceptNew?: boolean;
  preserveTransforms?: boolean;
  clips?: string[];
  animationMap?: Record<string, string>;
}
function world(
  document: SceneDocument,
  id: string,
  seen = new Set<string>(),
): THREE.Matrix4 {
  const e = document.entities.find((e) => e.id === id);
  if (!e) return new THREE.Matrix4();
  if (seen.has(id)) throw Error("模型层级循环");
  seen.add(id);
  const local = new THREE.Matrix4().compose(
    new THREE.Vector3().fromArray(e.transform.position),
    new THREE.Quaternion().fromArray(e.transform.rotation),
    new THREE.Vector3().fromArray(e.transform.scale),
  );
  return e.parentId ? world(document, e.parentId, seen).multiply(local) : local;
}
function localPose(matrix: THREE.Matrix4): Entity["transform"] {
  const position = new THREE.Vector3(),
    rotation = new THREE.Quaternion(),
    scale = new THREE.Vector3();
  matrix.decompose(position, rotation, scale);
  const check = new THREE.Matrix4().compose(position, rotation, scale);
  if (check.elements.some((v, i) => Math.abs(v - matrix.elements[i]) > 0.001))
    throw Error("新层级产生剪切，无法无损保留当前姿态；可改用来源姿态");
  return {
    position: position.toArray(),
    rotation: rotation.normalize().toArray() as [
      number,
      number,
      number,
      number,
    ],
    scale: scale.toArray(),
  };
}
export function replaceModelRevision(
  document: SceneDocument,
  modelId: string,
  asset: SceneAsset,
  nodes: Entity[],
  options: ModelRevisionOptions = {},
): { report: ModelRevisionReport; command: EditorCommand } {
  const model = document.entities.find((e) => e.id === modelId);
  if (model?.locked) throw Error("模型根节点已锁定");
  if (!model || !getComponent(model, "Model"))
    throw Error("先选择待更新的模型根节点");
  const previous = document.entities.filter(
    (e) => getComponent(e, "ModelNode")?.data.modelEntityId === modelId,
  );
  const incoming = new Map(
    nodes.flatMap((e) => {
      const c = getComponent(e, "ModelNode");
      return c ? [[String(c.data.sourceElementId), e] as const] : [];
    }),
  );
  const mapping: Record<string, string> = {},
    used = new Set<string>(),
    conflicts: string[] = [];
  for (const e of previous) {
    const key = String(
      getComponent(e, "ModelNode")!.data.sourceElementId ?? "",
    );
    const chosen =
      options.mapping?.[e.id] ??
      (key && !key.startsWith("unresolved:") && incoming.has(key) ? key : "");
    if (chosen) {
      if (!incoming.has(chosen)) conflicts.push(e.name + " 的目标已不存在");
      else if (used.has(chosen)) conflicts.push("来源元素被重复映射 " + chosen);
      else {
        mapping[e.id] = chosen;
        used.add(chosen);
      }
    }
  }
  if (options.clips)
    for (const entity of document.entities)
      for (const c of entity.components)
        if (
          c.enabled &&
          c.type === "Animation" &&
          c.data.modelEntityId === modelId
        ) {
          const clip = String(
            options.animationMap?.[String(c.data.clip)] || c.data.clip,
          );
          if (!options.clips.includes(clip))
            conflicts.push(
              entity.name + " 动画片段需要重新映射：" + String(c.data.clip),
            );
        }
  const report = {
    matched: Object.keys(mapping),
    unmatched: previous.filter((e) => !mapping[e.id]).map((e) => e.id),
    newElements: [...incoming.keys()].filter((id) => !used.has(id)),
    mapping,
    conflicts,
  };
  return {
    report,
    command: {
      label: "更新来源模型与身份映射",
      mutate: (doc) => {
        if (conflicts.length) throw Error(conflicts.join("\n"));
        if (report.unmatched.length && !options.keepUnmatched)
          throw Error("仍有未匹配元素；请完成映射或明确保留待修复占位");
        if (report.newElements.length && !options.acceptNew)
          throw Error("来源包含新增元素；请确认将其纳入完整模型层级");
        const current = doc.entities.find((e) => e.id === modelId),
          component = current && getComponent(current, "Model");
        if (!component) throw Error("模型已不存在");
        if (!doc.assets.some((a) => a.id === asset.id)) doc.assets.push(asset);
        component.data.assetId = asset.id;
        for (const entity of doc.entities)
          for (const c of entity.components)
            if (
              c.type === "Animation" &&
              c.data.modelEntityId === modelId &&
              options.animationMap?.[String(c.data.clip)]
            )
              c.data.clip = options.animationMap[String(c.data.clip)];
        const oldWorld = new Map(
            previous.map((e) => [e.id, world(document, e.id)]),
          ),
          targetIds = new Map<string, string>();
        const sourceRoot = nodes.find((e) => !getComponent(e, "ModelNode"))!;
        targetIds.set(sourceRoot.id, modelId);
        for (const [oldId, key] of Object.entries(mapping))
          targetIds.set(incoming.get(key)!.id, oldId);
        for (const key of report.newElements) {
          const node = incoming.get(key)!;
          targetIds.set(node.id, node.id);
        }
        for (const source of nodes.filter((e) =>
          getComponent(e, "ModelNode"),
        )) {
          const id = targetIds.get(source.id)!;
          let entity = doc.entities.find((e) => e.id === id);
          if (!entity) {
            entity = structuredClone(source);
            entity.id = id;
            doc.entities.push(entity);
          }
          const oldBinding = getComponent(entity, "ModelNode"),
            oldKey = String(oldBinding?.data.sourceElementId ?? "");
          const sourceBinding = getComponent(source, "ModelNode")!;
          if (!oldBinding)
            entity.components.push(structuredClone(sourceBinding));
          const binding = getComponent(entity, "ModelNode")!;
          Object.assign(binding.data, {
            modelEntityId: modelId,
            nodeIndex: sourceBinding.data.nodeIndex,
            sourceElementId: sourceBinding.data.sourceElementId,
            meshRevision: asset.sha256,
            sourceStatus: "resolved",
          });
          entity.parentId =
            targetIds.get(source.parentId ?? sourceRoot.id) ?? modelId;
          if (options.preserveTransforms !== false && oldWorld.has(id)) {
            const parentWorld = entity.parentId
              ? world(doc, entity.parentId)
              : new THREE.Matrix4();
            entity.transform = localPose(
              parentWorld.invert().multiply(oldWorld.get(id)!),
            );
          } else entity.transform = structuredClone(source.transform);
          if (oldKey && oldKey !== String(sourceBinding.data.sourceElementId))
            for (const c of entity.components) {
              const definition = componentDefinitions.find(
                (d) => d.type === c.type,
              );
              for (const [field, spec] of Object.entries(
                definition?.fields ?? {},
              ))
                if (spec["x-source-element-id"] && c.data[field] === oldKey)
                  c.data[field] = sourceBinding.data.sourceElementId;
            }
        }
        for (const id of report.unmatched) {
          const entity = doc.entities.find((e) => e.id === id);
          if (!entity) continue;
          const binding = getComponent(entity, "ModelNode");
          if (binding) binding.data.sourceStatus = "unresolved";
          if (options.preserveTransforms !== false) {
            const parent = entity.parentId
              ? world(doc, entity.parentId)
              : new THREE.Matrix4();
            entity.transform = localPose(
              parent.invert().multiply(oldWorld.get(id)!),
            );
          }
        }
      },
    },
  };
}
