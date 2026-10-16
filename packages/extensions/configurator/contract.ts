import type { SceneDocument } from "../../scene-schema/src/types";
import {
  validateCatalog,
  configurationOwnership,
  type ProductCatalog,
} from "./core";
export function validate(document: SceneDocument, publish: boolean): string[] {
  const errors = document.entities.flatMap((e) =>
    e.components
      .filter((c) => c.enabled && c.type === "studio.configurator.Catalog")
      .flatMap((c) =>
        publish ? validateCatalog(c.data as unknown as ProductCatalog) : [],
      ),
  );
  if (publish)
    errors.push(
      ...new Set([...configurationOwnership(document).values()].flat()),
    );
  return errors;
}
