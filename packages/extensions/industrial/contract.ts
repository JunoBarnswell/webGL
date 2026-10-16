import type { SceneDocument } from "../../scene-schema/src/types";
import { validateReview, type IndustrialReview } from "./core";
export function validate(document: SceneDocument, publish: boolean): string[] {
  const errors: string[] = [];
  for (const e of document.entities)
    for (const c of e.components)
      if (c.enabled && c.type === "studio.industrial.Review") {
        const data = c.data as unknown as IndustrialReview;
        errors.push(...validateReview(data));
        if (
          publish &&
          data.semanticAssetId &&
          !document.assets.some(
            (a) =>
              a.id === data.semanticAssetId &&
              (a.kind === "semantic" || a.files.includes("semantics.json")),
          )
        )
          errors.push("工业属性资产类型不匹配");
        if (publish)
          for (const m of data.measurements)
            for (const anchor of m.anchorRefs ?? []) {
              const target = document.entities.find(
                  (e) => e.id === anchor.entityId,
                ),
                binding = target?.components.find(
                  (c) => c.enabled && c.type === "ModelNode",
                );
              if (
                !target ||
                (anchor.sourceRevision &&
                  binding?.data.meshRevision !== anchor.sourceRevision) ||
                (anchor.sourceElementId &&
                  binding?.data.sourceElementId !== anchor.sourceElementId)
              )
                errors.push("测量来源已变化：" + m.name);
            }
      }
  return errors;
}
