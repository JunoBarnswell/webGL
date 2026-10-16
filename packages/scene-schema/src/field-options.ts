import type { FieldSchema, JsonValue, SceneDocument } from "./types";
export interface FieldOptionsRule {
  component: string;
  relation: string;
  rootComponent?: string;
  rootField?: string;
  array: string;
  value: string;
  label: string;
  sort?: string;
}
export function fieldOptions(
  document: SceneDocument,
  spec: FieldSchema,
  targetId: string,
): { value: string; label: string }[] | undefined {
  const rule = spec["x-options"];
  if (!rule) return;
  const options = new Map<
    string,
    { value: string; label: string; sort: number }
  >();
  for (const entity of document.entities) {
    const component = entity.components.find(
      (c) => c.enabled && c.type === rule.component,
    );
    if (!component) continue;
    const related = String(component.data[rule.relation] ?? "");
    if (related !== targetId) {
      const root = document.entities
        .find((e) => e.id === related)
        ?.components.find((c) => c.enabled && c.type === rule.rootComponent);
      if (!root || root.data[rule.rootField ?? ""] !== targetId) continue;
    }
    const rows = component.data[rule.array];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const value = String(row[rule.value] ?? "");
      if (value && !options.has(value))
        options.set(value, {
          value,
          label: String(row[rule.label] ?? value),
          sort: Number(row[rule.sort ?? ""] ?? 0),
        });
    }
  }
  return [...options.values()]
    .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
    .map(({ value, label }) => ({ value, label }));
}
export function optionErrors(
  document: SceneDocument,
  fields: Record<string, FieldSchema>,
  data: Record<string, JsonValue>,
  targetId: string,
  publish: boolean,
): string[] {
  const errors: string[] = [];
  for (const [field, spec] of Object.entries(fields)) {
    const options = fieldOptions(document, spec, targetId);
    if (
      options &&
      ((data[field] !== "" &&
        data[field] !== undefined &&
        !options.some((option) => option.value === data[field])) ||
        (publish && spec["x-required-publish"] && !data[field]))
    )
      errors.push((spec.title ?? field) + " 引用的步骤不存在");
  }
  return errors;
}
