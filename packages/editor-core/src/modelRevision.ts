import {
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
}
export function replaceModelRevision(
  document: SceneDocument,
  modelId: string,
  asset: SceneAsset,
  nodes: Entity[],
): { report: ModelRevisionReport; command: EditorCommand } {
  const previous = document.entities.filter(
    (e) => getComponent(e, "ModelNode")?.data.modelEntityId === modelId,
  );
  const incoming = new Map(
    nodes.flatMap((e) => {
      const c = getComponent(e, "ModelNode");
      return c ? [[String(c.data.sourceElementId), e] as const] : [];
    }),
  );
  const report: ModelRevisionReport = {
    matched: [],
    unmatched: [],
    newElements: [...incoming.keys()],
  };
  for (const entity of previous) {
    const key = String(
      getComponent(entity, "ModelNode")!.data.sourceElementId ?? "",
    );
    if (key && !key.startsWith("unresolved:") && incoming.has(key)) {
      report.matched.push(entity.id);
      report.newElements = report.newElements.filter((k) => k !== key);
    } else report.unmatched.push(entity.id);
  }
  return {
    report,
    command: {
      label: "更新来源模型",
      mutate: (doc) => {
        if (report.unmatched.length)
          throw Error(
            "存在 " +
              report.unmatched.length +
              " 个未匹配元素，原模型保持不变；先修复来源身份",
          );
        if (report.newElements.length)
          throw Error("新模型含新增元素，须明确导入后再更新绑定");
        const model = doc.entities.find((e) => e.id === modelId),
          component = model && getComponent(model, "Model");
        if (!component) throw Error("模型不存在");
        if (!doc.assets.some((a) => a.id === asset.id)) doc.assets.push(asset);
        component.data.assetId = asset.id;
        for (const entity of doc.entities) {
          const binding = getComponent(entity, "ModelNode");
          if (binding?.data.modelEntityId !== modelId) continue;
          const next = incoming.get(String(binding.data.sourceElementId));
          const nextBinding = next && getComponent(next, "ModelNode");
          if (nextBinding) {
            binding.data.nodeIndex = nextBinding.data.nodeIndex;
            binding.data.meshRevision = asset.sha256;
          }
        }
      },
    },
  };
}
