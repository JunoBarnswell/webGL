import {
  convertUnit,
  strictNumber,
  compatibleUnits,
  unitDefinition,
} from "../../scene-schema/src/units";
export { convertUnit } from "../../scene-schema/src/units";
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
  templateIds?: string[];
}
export interface SemanticRecord {
  id: string;
  sourceElementId: string;
  name: string;
  classId: string;
  properties: Record<string, unknown>;
  links: {
    kind: string;
    targetId: string;
    sourcePortId?: string;
    targetPortId?: string;
    direction?: "forward" | "both";
    systemId?: string;
  }[];
  ports?: SemanticPort[];
  systems?: string[];
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
export interface SemanticPort {
  id: string;
  name: string;
  elementId: string;
  direction: "in" | "out" | "both" | "unknown";
  type: string;
  systemId: string;
}
export interface SemanticSystem {
  id: string;
  name: string;
  type: string;
  elementIds: string[];
  ports: SemanticPort[];
  connections: {
    id: string;
    fromPortId: string;
    toPortId: string;
    kind: "connects" | "feeds";
    direction: "forward" | "both";
  }[];
}
export interface PropertyTemplate {
  id: string;
  name: string;
  fields: PropertyDefinition[];
}
export interface IndustrialReview {
  propertyTemplates?: PropertyTemplate[];
  systems?: SemanticSystem[];
  semanticAssetId: string;
  classes: AssetClass[];
  filters: ReviewFilter[];
  colors: ColorRule[];
  sections: SectionRef[];
  measurements: Measurement[];
  views: SavedView[];
}
export interface PropertyProvenance {
  path: string;
  rawValue: unknown;
  rawUnit: string;
  modelRevision: string;
  sourceElementId: string;
  origin: "source" | "default";
  declaredUnit?: string;
  upstream?: unknown;
}
export function mapProperties(
  record: SemanticRecord,
  definitions: PropertyDefinition[],
): { properties: Record<string, unknown>; errors: string[] } {
  const properties = { ...record.properties },
    errors: string[] = [];
  for (const field of definitions) {
    if (
      !["string", "number", "boolean"].includes(field.dataType) ||
      !["keep", "reject", "default"].includes(field.emptyPolicy)
    ) {
      errors.push(record.id + " / 属性映射类型或空值策略无效");
      continue;
    }
    if (
      !field.id ||
      field.id.length > 200 ||
      ["__proto__", "constructor", "prototype"].includes(field.id)
    ) {
      errors.push(record.id + " / 属性字段 ID 无效");
      continue;
    }
    const boxed = Object.hasOwn(record.properties, field.sourcePath)
        ? record.properties[field.sourcePath]
        : undefined,
      box =
        boxed && typeof boxed === "object" && !Array.isArray(boxed)
          ? (boxed as Record<string, unknown>)
          : null;
    let raw = box && "value" in box ? box.value : boxed,
      origin: PropertyProvenance["origin"] = "source";
    if (raw === undefined || raw === null || raw === "") {
      if (field.emptyPolicy === "keep" && !field.required) continue;
      if (field.emptyPolicy === "default") {
        raw = field.defaultValue;
        origin = "default";
      } else {
        errors.push(record.id + " / " + field.name + " 缺失");
        continue;
      }
    }
    try {
      const rawUnit =
        origin === "default"
          ? field.unit
          : field.sourceUnit || (typeof box?.unit === "string" ? box.unit : "");
      let value: unknown;
      if (field.dataType === "number")
        value = convertUnit(strictNumber(raw), rawUnit, field.unit);
      else if (field.dataType === "boolean") {
        if (
          ![true, false, "true", "false", "1", "0", 1, 0].includes(raw as never)
        )
          throw Error("非法布尔值");
        value = raw === true || raw === "true" || raw === 1 || raw === "1";
      } else {
        if (typeof raw === "number" && !Number.isFinite(raw))
          throw Error("数值必须有限");
        if (!["string", "number", "boolean"].includes(typeof raw))
          throw Error("字符串映射只接受标量");
        value = String(raw);
      }
      const source: PropertyProvenance = {
        path: field.sourcePath,
        rawValue: raw,
        rawUnit:
          origin === "source" && typeof box?.unit === "string"
            ? box.unit
            : rawUnit,
        ...(field.sourceUnit ? { declaredUnit: field.sourceUnit } : {}),
        modelRevision: record.modelRevision,
        sourceElementId: record.sourceElementId,
        origin,
        ...(box?.source ? { upstream: box.source } : {}),
      };
      properties[field.id] = { value, unit: field.unit, source };
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
export function validateReview(
  review: IndustrialReview,
  publish = false,
): string[] {
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
  for (const c of review.classes)
    try {
      effectiveClassFields(
        review.classes,
        c.id,
        review.propertyTemplates,
        publish,
      );
    } catch (error) {
      errors.push(String(error));
    }
  if (
    new Set(review.propertyTemplates?.map((t) => t.id) ?? []).size !==
    (review.propertyTemplates?.length ?? 0)
  )
    errors.push("属性模板 ID 重复");
  if (
    new Set(review.systems?.map((s) => s.id) ?? []).size !==
    (review.systems?.length ?? 0)
  )
    errors.push("系统 ID 重复");
  for (const system of review.systems ?? [])
    errors.push(...systemTopology(system).errors);
  return errors;
}

/** Root-to-leaf fields: inherited required constraints survive deterministic child overrides. */
export function effectiveClassFields(
  classes: AssetClass[],
  classId: string,
  templates: PropertyTemplate[] = [],
  strict = true,
): PropertyDefinition[] {
  const index = new Map(classes.map((c) => [c.id, c])),
    seen = new Set<string>(),
    chain: AssetClass[] = [];
  let current = index.get(classId);
  if (!current) throw Error("分类不存在：" + classId);
  while (current) {
    if (seen.has(current.id)) throw Error("分类层级循环");
    seen.add(current.id);
    chain.unshift(current);
    if (!current.parentId) break;
    current = index.get(current.parentId);
    if (!current) throw Error("分类父项不存在");
  }
  const fields = new Map<string, PropertyDefinition>();
  const add = (field: PropertyDefinition) => {
    const inherited = fields.get(field.id);
    if (
      inherited &&
      (inherited.dataType !== field.dataType ||
        (strict &&
          field.dataType === "number" &&
          !compatibleUnits(inherited.unit, field.unit)))
    )
      throw Error("继承字段类型或量纲不兼容：" + field.id);
    if (strict && field.dataType === "number") {
      unitDefinition(field.unit);
      if (field.sourceUnit && !compatibleUnits(field.sourceUnit, field.unit))
        throw Error("源单位量纲不兼容：" + field.id);
    }
    fields.set(field.id, {
      ...field,
      required: field.required || Boolean(inherited?.required),
    });
  };
  for (const item of chain) {
    for (const id of item.templateIds ?? []) {
      const template = templates.find((t) => t.id === id);
      if (!template) throw Error("属性模板不存在：" + id);
      template.fields.forEach(add);
    }
    item.fields.forEach(add);
  }
  return [...fields.values()];
}
export function classCompleteness(
  record: SemanticRecord,
  classes: AssetClass[],
  classId = record.classId,
  templates: PropertyTemplate[] = [],
): {
  complete: boolean;
  required: number;
  present: number;
  missing: string[];
  invalid: string[];
} {
  const fields = effectiveClassFields(classes, classId, templates),
    missing: string[] = [],
    invalid: string[] = [];
  let present = 0;
  for (const field of fields) {
    const raw = Object.hasOwn(record.properties, field.id)
        ? record.properties[field.id]
        : undefined,
      box =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : null,
      value = box && "value" in box ? box.value : raw;
    if (value === undefined || value === null || value === "") {
      if (field.required) missing.push(field.id);
      continue;
    }
    try {
      if (field.dataType === "number") {
        strictNumber(value);
        if (
          typeof box?.unit !== "string" ||
          !compatibleUnits(box.unit, field.unit)
        )
          throw Error("单位不兼容");
      } else if (typeof value !== field.dataType) throw Error("类型不兼容");
      if (field.required) present++;
    } catch {
      invalid.push(field.id);
    }
  }
  return {
    complete: !missing.length && !invalid.length,
    required: fields.filter((f) => f.required).length,
    present,
    missing,
    invalid,
  };
}
export function systemTopology(system: SemanticSystem): {
  nodes: SemanticPort[];
  edges: SemanticSystem["connections"];
  errors: string[];
} {
  const errors: string[] = [],
    ports = new Map(system.ports.map((p) => [p.id, p]));
  if (ports.size !== system.ports.length) errors.push("系统端口 ID 重复");
  for (const port of system.ports)
    if (
      !system.elementIds.includes(port.elementId) ||
      (port.systemId && port.systemId !== system.id)
    )
      errors.push("端口不属于系统成员：" + port.id);
  for (const edge of system.connections) {
    const from = ports.get(edge.fromPortId),
      to = ports.get(edge.toPortId);
    if (!from || !to) errors.push("连接端口不存在：" + edge.id);
    else if (
      edge.direction === "forward" &&
      (from.direction === "in" || to.direction === "out")
    )
      errors.push("端口流向与连接方向冲突：" + edge.id);
  }
  if (
    new Set(system.connections.map((c) => c.id)).size !==
    system.connections.length
  )
    errors.push("连接 ID 重复");
  return { nodes: [...ports.values()], edges: system.connections, errors };
}
