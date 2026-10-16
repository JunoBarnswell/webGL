import type { SceneDocument } from "../../scene-schema/src/types";
import { validateCatalog, type ProductCatalog } from "./core";
export function validate(document: SceneDocument, publish: boolean): string[] {
  return document.entities.flatMap((e) =>
    e.components
      .filter((c) => c.enabled && c.type === "studio.configurator.Catalog")
      .flatMap((c) =>
        publish ? validateCatalog(c.data as unknown as ProductCatalog) : [],
      ),
  );
}
