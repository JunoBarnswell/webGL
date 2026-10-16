import type { SceneDocument } from "../../scene-schema/src/types";
export function validate(document: SceneDocument, publish: boolean): string[] {
  const errors: string[] = [];
  for (const entity of document.entities)
    for (const component of entity.components)
      if (
        component.enabled &&
        component.type === "studio.virtualTour.Panorama"
      ) {
        const asset = document.assets.find(
            (a) => a.id === component.data.assetId,
          ),
          expected = component.data.video ? "video" : "image";
        if (
          asset &&
          asset.kind !== expected &&
          !(expected === "image" && asset.kind === "texture")
        )
          errors.push(entity.name + " 全景媒体类型不匹配");
        if (publish && !asset) errors.push(entity.name + " 缺少全景媒体");
      }
  return errors;
}
