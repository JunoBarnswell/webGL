import { fieldActive } from "./field-rules";
import type {
  Entity,
  FieldSchema,
  JsonValue,
  SceneDocument,
  ComponentDefinition,
} from "./types";
export function semanticFields(
  value: Record<string, JsonValue>,
  fields: Record<string, FieldSchema>,
  entities: Map<string, Entity>,
  entity: Entity,
  componentType: string,
  publish: boolean,
  unique: Map<string, string>,
  errors: string[],
  path = componentType,
): void {
  for (const [key, spec] of Object.entries(fields)) {
    if (!fieldActive(spec, value)) continue;
    const data = value[key],
      where = entity.name + "/" + path + "." + key;
    const when = spec["x-required-when"];
    if (
      publish &&
      (spec["x-required-publish"] ||
        (when && value[when.field] === when.value)) &&
      (data === undefined || data === null || data === "")
    )
      errors.push(where + " 尚未配置");
    if (
      spec["x-publish-enum"] &&
      publish &&
      data !== undefined &&
      !spec["x-publish-enum"]!.includes(String(data))
    )
      errors.push(where + " 存在未解决的来源状态");
    if (
      spec["x-less-than"] &&
      Number(data) >= Number(value[spec["x-less-than"]!])
    )
      errors.push(where + " 必须小于 " + spec["x-less-than"]);
    const capabilities =
      spec["x-target-components"] ??
      (spec["x-target-component"] ? [spec["x-target-component"]!] : []);
    if (
      capabilities.length &&
      typeof data === "string" &&
      data &&
      !entities
        .get(data)
        ?.components.some((c) => c.enabled && capabilities.includes(c.type))
    )
      errors.push(where + " 目标能力不匹配");
    if (spec["x-unique"] && data) {
      const identity =
        componentType + ":" + path + "." + key + ":" + JSON.stringify(data);
      const old = unique.get(identity);
      if (old && old !== entity.id) errors.push(where + " 重复");
      unique.set(identity, entity.id);
    }
    if (Array.isArray(data)) {
      if (
        spec["x-sum"] !== undefined &&
        Math.abs(
          data.reduce<number>((sum, n) => sum + Number(n), 0) - spec["x-sum"]!,
        ) > 0.001
      )
        errors.push(where + " 坐标和无效");
      if (spec["x-unique-by"]) {
        const ids = data.map((item) =>
          item && typeof item === "object" && !Array.isArray(item)
            ? item[spec["x-unique-by"]!]
            : undefined,
        );
        if (new Set(ids).size !== ids.length)
          errors.push(where + " 存在重复身份");
      }
      for (const [index, item] of data.entries())
        if (
          item &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          spec.items?.properties
        )
          semanticFields(
            item,
            spec.items.properties,
            entities,
            entity,
            componentType,
            publish,
            unique,
            errors,
            path + "." + key + "[" + index + "]",
          );
    } else if (data && typeof data === "object" && spec.properties)
      semanticFields(
        data,
        spec.properties,
        entities,
        entity,
        componentType,
        publish,
        unique,
        errors,
        path + "." + key,
      );
  }
}
export function semanticAnchor(
  document: SceneDocument,
  entity: Entity,
  data: Record<string, JsonValue>,
  errors: string[],
): void {
  if (data.anchorKind !== "surface") return;
  const target = document.entities.find((e) => e.id === data.entityId);
  if (!target) {
    errors.push(entity.name + " 标注附着目标不存在");
    return;
  }
  const binding = target.components.find(
      (c) => c.type === "ModelNode" && c.enabled,
    ),
    mesh = target.components.find((c) => c.type === "Mesh" && c.enabled);
  const revision = String(
    binding?.data.meshRevision ||
      document.assets.find((a) => a.id === mesh?.data.assetId)?.sha256 ||
      "",
  );
  const identity = String(binding?.data.sourceElementId || target.id);
  if (
    binding?.data.sourceStatus === "unresolved" ||
    identity !== data.sourceElementId ||
    revision !== data.meshRevision
  )
    errors.push(entity.name + " 标注来源或网格版本需要修复");
}
export function validateSemanticComponents(
  document: SceneDocument,
  definitions: readonly ComponentDefinition[],
  publish: boolean,
): string[] {
  const errors: string[] = [],
    unique = new Map<string, string>(),
    entities = new Map(document.entities.map((e) => [e.id, e]));
  for (const entity of document.entities)
    for (const component of entity.components) {
      const definition = definitions.find((d) => d.type === component.type);
      if (!definition) continue;
      semanticFields(
        component.data,
        definition.fields,
        entities,
        entity,
        component.type,
        publish && component.enabled,
        unique,
        errors,
      );
      if (publish && component.enabled && definition.anchor)
        semanticAnchor(document, entity, component.data, errors);
    }
  return errors;
}
