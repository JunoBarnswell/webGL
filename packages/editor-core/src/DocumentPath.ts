import type { JsonValue, SceneDocument } from "@studio/scene-schema";
export type DocumentPath = (
  | string
  | number
  | { id: string }
  | { type: string }
)[];
export function documentValue(
  document: SceneDocument,
  path: DocumentPath,
): unknown {
  let value: unknown = document;
  for (const key of path) {
    if (typeof key === "object") {
      if (!Array.isArray(value)) return;
      value = value.find(
        (item) =>
          item &&
          typeof item === "object" &&
          ("id" in key ? item.id === key.id : item.type === key.type),
      );
    } else {
      if (
        ["__proto__", "constructor", "prototype"].includes(String(key)) ||
        !value ||
        typeof value !== "object"
      )
        return;
      value = (value as Record<string, unknown>)[key];
    }
  }
  return value;
}
export function writeDocumentValue(
  document: SceneDocument,
  path: DocumentPath,
  value: JsonValue,
): void {
  if (!path.length) throw Error("文档路径不可为空");
  const parent = documentValue(document, path.slice(0, -1)),
    key = path.at(-1);
  if (
    !parent ||
    typeof parent !== "object" ||
    (typeof key !== "string" && typeof key !== "number") ||
    ["__proto__", "constructor", "prototype"].includes(String(key)) ||
    !(key in parent)
  )
    throw Error("编辑目标已不存在");
  (parent as Record<string, unknown>)[key] = value;
}
