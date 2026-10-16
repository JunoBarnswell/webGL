import type { Vec3 } from "../../scene-schema/src/types";
import type { CameraPose } from "../../scene-runtime/src/RuntimeState";
export interface PropertyDefinition {
  id: string;
  name: string;
  dataType: "string" | "number" | "boolean";
  unit: string;
  precision: number;
  required: boolean;
  sourcePath: string;
  sourceUnit: string;
  emptyPolicy: string;
  defaultValue: string;
}
export interface AssetClass {
  id: string;
  code: string;
  name: string;
  parentId: string;
  fields: PropertyDefinition[];
}
export interface SemanticRecord {
  id: string;
  sourceElementId: string;
  name: string;
  classId: string;
  properties: Record<string, unknown>;
  links: { kind: string; targetId: string }[];
  modelRevision: string;
}
export interface SemanticPage {
  total: number;
  page: number;
  pageSize: number;
  items: SemanticRecord[];
  sourceIds: string[];
  modelRevisions?: string[];
  values?: Record<string, number | null>;
}
export interface ReviewFilter {
  id: string;
  field: string;
  operator: string;
  value: string;
  join: "and" | "or";
}
export interface ColorRule {
  id: string;
  field: string;
  value: string;
  min: number;
  max: number;
  mode: "category" | "range" | "missing";
  color: string;
  colorEnd?: string;
  priority: number;
}
export interface SectionRef {
  entityId: string;
  enabled: boolean;
}
export interface Section {
  id: string;
  entityId: string;
  kind: "plane" | "box";
  enabled: boolean;
  matrix: number[];
  size: Vec3;
  flipped: boolean;
}
export interface Measurement {
  id: string;
  name: string;
  kind: "distance" | "angle" | "path" | "bounds";
  entityId: string;
  points: Vec3[];
  sourceRevision: string;
  unit: "mm" | "cm" | "m";
  tolerance: number;
  anchorRefs?: {
    entityId: string;
    position: Vec3;
    sourceRevision: string;
    sourceElementId: string;
  }[];
}
export interface SavedView {
  id: string;
  name: string;
  camera: CameraPose;
  filters: ReviewFilter[];
  colors?: ColorRule[];
  sections: Section[];
  hiddenIds: string[];
  thumbnailAssetId: string;
}
export interface IndustrialReview {
  semanticAssetId: string;
  classes: AssetClass[];
  filters: ReviewFilter[];
  colors: ColorRule[];
  sections: SectionRef[];
  measurements: Measurement[];
  views: SavedView[];
}
const unitScale: Record<string, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  km: 1000000,
  in: 25.4,
  ft: 304.8,
};
export function convertUnit(value: number, from: string, to: string): number {
  if (from === to || (!from && !to)) return value;
  if (!unitScale[from] || !unitScale[to])
    throw Error("不支持的单位换算：" + from + " → " + to);
  return (value * unitScale[from]) / unitScale[to];
}
export function mapProperties(
  record: SemanticRecord,
  definitions: PropertyDefinition[],
): { properties: Record<string, unknown>; errors: string[] } {
  const properties = { ...record.properties },
    errors: string[] = [];
  for (const field of definitions) {
    let raw = record.properties[field.sourcePath];
    if (raw && typeof raw === "object" && "value" in raw)
      raw = (raw as { value: unknown }).value;
    if (raw === undefined || raw === null || raw === "") {
      if (field.emptyPolicy === "keep" && !field.required) continue;
      if (field.emptyPolicy === "default") raw = field.defaultValue;
      else {
        errors.push(record.id + " / " + field.name + " 缺失");
        continue;
      }
    }
    try {
      let value: unknown = String(raw);
      if (field.dataType === "number") {
        value = Number(raw);
        if (!Number.isFinite(value)) throw Error("非法数值");
        value = convertUnit(value as number, field.sourceUnit, field.unit);
      } else if (field.dataType === "boolean") {
        if (
          ![true, false, "true", "false", "1", "0", 1, 0].includes(raw as never)
        )
          throw Error("非法布尔值");
        value = raw === true || raw === "true" || raw === 1 || raw === "1";
      }
      properties[field.id] = {
        value,
        unit: field.unit,
        source: field.sourcePath,
      };
    } catch (error) {
      errors.push(record.id + " / " + field.name + "：" + String(error));
    }
  }
  return { properties, errors };
}
export function measure(
  kind: Measurement["kind"],
  points: Vec3[],
  unit: Measurement["unit"],
): number {
  const distance = (a: Vec3, b: Vec3) =>
    Math.hypot(...a.map((v, i) => v - b[i]));
  let value = 0;
  if (kind === "angle") {
    if (points.length < 3) throw Error("角度测量需要三个点");
    const a = points[0].map((v, i) => v - points[1][i]),
      b = points[2].map((v, i) => v - points[1][i]),
      length = Math.hypot(...a) * Math.hypot(...b);
    if (!length) throw Error("角度测量不能包含重合边");
    return (
      (Math.acos(
        Math.max(
          -1,
          Math.min(1, a.reduce((s, v, i) => s + v * b[i], 0) / length),
        ),
      ) *
        180) /
      Math.PI
    );
  }
  if (points.length < 2) throw Error("距离测量至少需要两个点");
  if (kind === "distance" || kind === "bounds")
    value = distance(points[0], points.at(-1)!);
  else
    for (let i = 1; i < points.length; i++)
      value += distance(points[i - 1], points[i]);
  return convertUnit(value, "mm", unit);
}
export function validateReview(review: IndustrialReview): string[] {
  const errors: string[] = [],
    classes = new Map(review.classes.map((c) => [c.id, c]));
  for (const color of review.colors)
    if (color.mode === "range" && color.min >= color.max)
      errors.push("连续颜色范围需要递增的上下界");
  for (const c of review.classes) {
    const visited = new Set<string>();
    let cursor: AssetClass | undefined = c;
    while (cursor) {
      if (visited.has(cursor.id)) {
        errors.push("分类层级循环");
        break;
      }
      visited.add(cursor.id);
      cursor = classes.get(cursor.parentId);
    }
    if (c.parentId && !classes.has(c.parentId)) errors.push("分类父项不存在");
    if (new Set(c.fields.map((f) => f.id)).size !== c.fields.length)
      errors.push("属性字段 ID 重复");
  }
  return errors;
}
