import type { FieldSchema, JsonValue } from "./types";
export function fieldActive(
  spec: FieldSchema,
  parent: Record<string, JsonValue>,
): boolean {
  const when = spec["x-visible-when"] ?? spec["x-reference-when"];
  return !when || when.values.includes(String(parent[when.field]));
}
export function editField(
  data: Record<string, JsonValue>,
  fields: Record<string, FieldSchema>,
  key: string,
  value: JsonValue,
): void {
  if (data[key] !== value)
    for (const reset of fields[key]?.["x-resets"] ?? []) {
      const spec = fields[reset];
      if (spec) data[reset] = structuredClone(spec.default ?? null);
    }
  data[key] = value;
}
