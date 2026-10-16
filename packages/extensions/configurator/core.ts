import {
  compileRuleGraph,
  resolveRuleIR,
  type RuleCondition,
  type RuleContext,
  type RuleDiagnostic,
} from "./rules";
export * from "./rules";
import type { Transform } from "../../scene-schema/src/types";
import {
  compatibleUnits,
  strictNumber,
  unitDefinition,
} from "../../scene-schema/src/units";
import { documentReferenceEdges } from "../../scene-schema/src/references";
import type { SceneDocument } from "../../scene-schema/src/types";
import type { CameraPose } from "../../scene-runtime/src/RuntimeState";
export interface VisualMapping {
  numericBinding?: {
    property: "position" | "scale" | "rotation" | "opacity";
    axis: "x" | "y" | "z" | "all";
    mode: "set" | "add";
    factor: number;
    offset: number;
    reference?: number;
  };
  priority?: number;
  id: string;
  targetId: string;
  operation:
    | "visibility"
    | "color"
    | "opacity"
    | "transform"
    | "variant"
    | "swapPart"
    | "camera";
  value: string;
  transform: Transform;
  camera: CameraPose;
  assetId: string;
  variant: string;
}
export interface MappingSource {
  mappingId: string;
  groupId: string;
  optionId: string;
  priority: number;
  catalogId: string;
  catalogRevision: string;
}
export interface VisualCandidate<T> {
  key: string;
  priority: number;
  signature: string;
  value: T;
  source: MappingSource;
}
export interface ResolvedVisual<T> {
  value: T;
  sources: MappingSource[];
  shadowed: MappingSource[];
}
/** Explicit mapping priority, independent of async completion and authored array order. */
export function resolveVisualCandidates<T>(
  candidates: VisualCandidate<T>[],
): Map<string, ResolvedVisual<T>> {
  const result = new Map<string, ResolvedVisual<T>>(),
    groups = new Map<string, VisualCandidate<T>[]>();
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.priority))
      throw Error("视觉映射优先级必须有限");
    const group = groups.get(candidate.key) ?? [];
    group.push(candidate);
    groups.set(candidate.key, group);
  }
  for (const [key, group] of groups) {
    group.sort(
      (a, b) =>
        b.priority - a.priority ||
        (a.source.mappingId < b.source.mappingId
          ? -1
          : a.source.mappingId > b.source.mappingId
            ? 1
            : 0),
    );
    const winner = group[0],
      peers = group.filter((c) => c.priority === winner.priority);
    if (peers.some((c) => c.signature !== winner.signature))
      throw Error(
        "同优先级视觉映射冲突：" +
          key +
          "；" +
          peers
            .map(
              (c) =>
                c.source.groupId +
                " / " +
                c.source.optionId +
                " / " +
                c.source.mappingId,
            )
            .join(" ↔ "),
      );
    result.set(key, {
      value: winner.value,
      sources: peers.map((c) => c.source),
      shadowed: group
        .filter((c) => c.priority < winner.priority)
        .map((c) => c.source),
    });
  }
  return result;
}
/** One catalog owns a model's configuration dimensions; independent products keep independent catalogs. */
export function configurationOwnership(
  document: SceneDocument,
): Map<string, string[]> {
  const entities = new Map(document.entities.map((e) => [e.id, e])),
    children = new Map<string, string[]>(),
    catalogs = new Set(
      document.entities
        .filter((e) =>
          e.components.some(
            (c) => c.enabled && c.type === "studio.configurator.Catalog",
          ),
        )
        .map((e) => e.id),
    ),
    targets = new Map([...catalogs].map((id) => [id, new Set<string>()]));
  if (!catalogs.size) return new Map();
  for (const entity of document.entities)
    if (entity.parentId) {
      const list = children.get(entity.parentId) ?? [];
      list.push(entity.id);
      children.set(entity.parentId, list);
    }
  for (const edge of documentReferenceEdges(document))
    if (
      edge.componentType === "studio.configurator.Catalog" &&
      edge.kind === "entity" &&
      catalogs.has(edge.ownerId)
    )
      targets.get(edge.ownerId)!.add(edge.id);
  const claims = new Map<string, Set<string>>();
  for (const [id, ids] of targets) {
    const models = new Set<string>();
    for (const target of ids) {
      let cursor = entities.get(target),
        found = false;
      const visited = new Set<string>();
      while (cursor && !visited.has(cursor.id)) {
        visited.add(cursor.id);
        const node = cursor.components.find(
          (c) => c.enabled && c.type === "ModelNode",
        );
        if (node) {
          models.add(String(node.data.modelEntityId));
          found = true;
          break;
        }
        if (cursor.components.some((c) => c.enabled && c.type === "Model")) {
          models.add(cursor.id);
          found = true;
          break;
        }
        cursor = cursor.parentId ? entities.get(cursor.parentId) : undefined;
      }
      if (!found) {
        const pending = [target],
          seen = new Set<string>();
        while (pending.length) {
          const current = pending.pop()!;
          if (seen.has(current)) continue;
          seen.add(current);
          if (
            entities
              .get(current)
              ?.components.some((c) => c.enabled && c.type === "Model")
          )
            models.add(current);
          pending.push(...(children.get(current) ?? []));
        }
      }
    }
    claims.set(id, models);
  }
  const ancestor = (id: string, set: Set<string>) => {
    const seen = new Set<string>();
    let cursor = entities.get(id);
    while (cursor && !seen.has(cursor.id)) {
      if (set.has(cursor.id)) return true;
      seen.add(cursor.id);
      cursor = cursor.parentId ? entities.get(cursor.parentId) : undefined;
    }
    return false;
  };
  const errors = new Map<string, string[]>();
  const ids = [...catalogs];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i],
        b = ids[j],
        overlap =
          [...claims.get(a)!].some((id) => claims.get(b)!.has(id)) ||
          [...targets.get(a)!].some((id) => ancestor(id, targets.get(b)!)) ||
          [...targets.get(b)!].some((id) => ancestor(id, targets.get(a)!));
      if (overlap) {
        const message =
          "同一模型或槽位由多个目录控制：" +
          (entities.get(a)?.name ?? a) +
          " ↔ " +
          (entities.get(b)?.name ?? b) +
          "；请把配置维度合并为同一目录的属性组";
        errors.set(a, [...(errors.get(a) ?? []), message]);
        errors.set(b, [...(errors.get(b) ?? []), message]);
      }
    }
  return errors;
}
export interface ProductOption {
  id: string;
  name: string;
  sku: string;
  color: string;
  imageAssetId: string;
  description: string;
  bom: { partId: string; quantity: number }[];
  visuals: VisualMapping[];
}
export interface OptionGroup {
  numericUnit?: string;
  id: string;
  name: string;
  control: string;
  min: number;
  max: number;
  defaultIds: string[];
  options: ProductOption[];
  numericMinimum?: number;
  numericMaximum?: number;
  numericStep?: number;
  numericDefault?: number;
  visuals?: VisualMapping[];
}
export interface ConfigRule {
  id: string;
  type: string;
  when: { groupId: string; optionId: string };
  then: { groupId: string; optionId: string };
  minimum: number;
  maximum: number;
  priority: number;
  reason: string;
  conditions?: RuleCondition[];
  conditionJoin?: "all" | "any";
}
export interface ProductCatalog {
  variantPolicy?: "global-variant" | "compose-primitives";
  catalogId: string;
  libraryVersionId?: string;
  revision: string;
  name: string;
  market: string;
  groups: OptionGroup[];
  rules: ConfigRule[];
  priceSource: string;
  priceCurrency: string;
}
export interface ConfigurationResult {
  selections: Record<string, string[]>;
  changes: {
    groupId: string;
    optionId: string;
    ruleId: string;
    reason: string;
    operation: string;
  }[];
  errors: string[];
  bom: {
    partId: string;
    quantity: number;
    sources: {
      catalogId: string;
      catalogRevision: string;
      revisionKind: "library" | "embedded";
      groupId: string;
      optionId: string;
      quantity: number;
    }[];
  }[];
  skus: string[];
  priceStatus: "inquiry";
  schemaRevision: string;
  numericValues: Record<string, number>;
  numericSteps: Record<string, { index: number; origin: number; step: number }>;
  diagnostics: RuleDiagnostic[];
  skuSources: {
    sku: string;
    catalogId: string;
    catalogRevision: string;
    groupId: string;
    optionId: string;
  }[];
}
export function defaultConfiguration(
  catalog: ProductCatalog,
): Record<string, string[]> {
  return Object.fromEntries(
    catalog.groups.map((g) => [
      g.id,
      g.control === "number" ? [] : [...g.defaultIds],
    ]),
  );
}
export function toggleConfigurationOption(
  group: OptionGroup,
  selected: string[],
  optionId: string,
): string[] {
  const removable =
    group.control === "toggle" || group.control === "checkbox" || group.max > 1;
  if (removable && selected.includes(optionId))
    return selected.filter((id) => id !== optionId);
  return group.max === 1 ? [optionId] : [...new Set([...selected, optionId])];
}
export function formatNumericValue(group: OptionGroup, value: number): string {
  const decimals = (number: number) => {
    const [mantissa, exponent = "0"] = String(number).toLowerCase().split("e");
    return Math.max(
      0,
      (mantissa.split(".")[1]?.length ?? 0) - Number(exponent),
    );
  };
  return Number.isFinite(value)
    ? value.toFixed(
        Math.min(
          15,
          Math.max(
            decimals(group.numericStep ?? 0.01),
            decimals(group.numericMinimum ?? 0),
          ),
        ),
      )
    : "";
}
/** Declarative, deterministic and bounded. Invalid input never reaches visual application. */
export function resolveConfiguration(
  catalog: ProductCatalog,
  input: Record<string, string[]>,
  numericInput: Record<string, number> = {},
  context: RuleContext = {},
): ConfigurationResult {
  const resolved = resolveRuleIR(catalog, input, numericInput, context);
  const selections = resolved.selections;
  const result: ConfigurationResult = {
    ...resolved,
    bom: [],
    skus: [],
    skuSources: [],
    priceStatus: "inquiry",
    schemaRevision: catalog.libraryVersionId || catalog.revision,
  };
  const bom = new Map<
    string,
    {
      quantity: number;
      sources: {
        catalogId: string;
        catalogRevision: string;
        revisionKind: "library" | "embedded";
        groupId: string;
        optionId: string;
        quantity: number;
      }[];
    }
  >();
  for (const group of catalog.groups)
    for (const option of group.options)
      if (selections[group.id].includes(option.id)) {
        if (option.sku) {
          result.skus.push(option.sku);
          result.skuSources.push({
            sku: option.sku,
            catalogId: catalog.catalogId,
            catalogRevision: result.schemaRevision,
            groupId: group.id,
            optionId: option.id,
          });
        }
        for (const part of option.bom) {
          const row = bom.get(part.partId) ?? { quantity: 0, sources: [] };
          row.quantity += part.quantity;
          row.sources.push({
            catalogId: catalog.catalogId,
            catalogRevision: result.schemaRevision,
            revisionKind: catalog.libraryVersionId ? "library" : "embedded",
            groupId: group.id,
            optionId: option.id,
            quantity: part.quantity,
          });
          bom.set(part.partId, row);
        }
      }
  result.bom = [...bom].map(([partId, row]) => ({ partId, ...row }));
  for (const row of result.bom)
    if (!Number.isFinite(row.quantity) || row.quantity < 0)
      result.errors.push("BOM 数量必须为有限非负数：" + row.partId);
  result.errors = [...new Set(result.errors)];
  return result;
}
export const configurationOptionKey = (groupId: string, optionId: string) =>
  JSON.stringify([groupId, optionId]);
export function optionAvailability(
  catalog: ProductCatalog,
  current: Record<string, string[]>,
  numeric: Record<string, number> = {},
): Record<string, string> {
  const reasons: Record<string, string> = {},
    compiled = compileRuleGraph(catalog);
  for (const group of catalog.groups.filter(
    (group) => group.control !== "number",
  ))
    for (const option of group.options) {
      const next = {
          ...current,
          [group.id]: toggleConfigurationOption(
            group,
            current[group.id] ?? [],
            option.id,
          ),
        },
        resolved = resolveConfiguration(catalog, next, numeric, {
          compiled,
          intent: {
            groupId: group.id,
            optionId: option.id,
            selected: next[group.id].includes(option.id),
          },
        });
      if (resolved.errors.length)
        reasons[configurationOptionKey(group.id, option.id)] =
          resolved.errors.join("；");
      else if (
        next[group.id].includes(option.id) &&
        !resolved.selections[group.id].includes(option.id)
      )
        reasons[configurationOptionKey(group.id, option.id)] =
          resolved.changes.find(
            (c) => c.groupId === group.id && c.operation === "exclude",
          )?.reason ?? "此选项被兼容规则排除";
    }
  return reasons;
}
export function validateCatalog(catalog: ProductCatalog): string[] {
  const ir = compileRuleGraph(catalog);
  const visualErrors: string[] = [],
    mappingIds = new Set<string>();
  for (const group of catalog.groups)
    for (const mapping of group.control === "number"
      ? (group.visuals ?? [])
      : group.options.flatMap((option) => option.visuals)) {
      if (!mapping.id || mappingIds.has(mapping.id))
        visualErrors.push("视觉映射 ID 为空或重复：" + mapping.id);
      mappingIds.add(mapping.id);
      if (!Number.isFinite(mapping.priority ?? 0))
        visualErrors.push("视觉映射优先级必须有限：" + mapping.id);
      if (
        group.control === "number" &&
        (group.visuals ?? []).includes(mapping)
      ) {
        if (!["transform", "opacity"].includes(mapping.operation))
          visualErrors.push("数值属性支持变换或透明度映射：" + mapping.id);
        if (mapping.operation === "transform" && !mapping.numericBinding)
          visualErrors.push(
            "数值变换需要明确绑定属性、轴和单位：" + mapping.id,
          );
        if (mapping.operation === "opacity" && !mapping.numericBinding)
          try {
            if (!compatibleUnits(group.numericUnit || "1", "1"))
              throw Error("量纲不兼容");
          } catch {
            visualErrors.push("数值映射单位不兼容：" + mapping.id);
          }
        if (mapping.numericBinding) {
          const binding = mapping.numericBinding,
            target =
              binding.property === "position"
                ? "mm"
                : binding.property === "rotation"
                  ? "rad"
                  : "1";
          try {
            if (target === "1" && (binding.reference ?? 0) > 0)
              unitDefinition(group.numericUnit || "1");
            else if (
              !compatibleUnits(
                group.numericUnit || (target === "rad" ? "deg" : target),
                target,
              )
            )
              throw Error("量纲不兼容");
          } catch {
            visualErrors.push("数值映射单位不兼容：" + mapping.id);
          }
          if (
            !Number.isFinite(binding.factor) ||
            !Number.isFinite(binding.offset) ||
            !Number.isFinite(binding.reference ?? 0) ||
            (binding.reference ?? 0) < 0
          )
            visualErrors.push(
              "数值映射参数必须有限，基准不可为负：" + mapping.id,
            );
          if (binding.property === "rotation" && binding.axis === "all")
            visualErrors.push("旋转绑定必须选择单轴：" + mapping.id);
          if (
            (mapping.operation === "opacity" &&
              binding.property !== "opacity") ||
            (mapping.operation === "transform" &&
              binding.property === "opacity")
          )
            visualErrors.push("数值绑定与操作不匹配：" + mapping.id);
        }
      } else if (mapping.operation === "opacity")
        try {
          const value = strictNumber(mapping.value);
          if (value < 0 || value > 1) throw Error("透明度越界");
        } catch {
          visualErrors.push("透明度必须为 0～1 的数值：" + mapping.id);
        }
      if (
        mapping.operation === "visibility" &&
        !["true", "false"].includes(mapping.value)
      )
        visualErrors.push("可见性必须明确为 true 或 false：" + mapping.id);
    }
  return [
    ...new Set([
      ...ir.diagnostics
        .filter((d) => d.severity === "error")
        .map((d) => d.message),
      ...visualErrors,
      ...resolveConfiguration(
        catalog,
        defaultConfiguration(catalog),
        {},
        { compiled: ir },
      ).errors,
    ]),
  ];
}
