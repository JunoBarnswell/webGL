import type { Transform } from "../../scene-schema/src/types";
import type { CameraPose } from "../../scene-runtime/src/RuntimeState";
export interface VisualMapping {
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
}
export interface ProductCatalog {
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
    sources: { groupId: string; optionId: string; quantity: number }[];
  }[];
  skus: string[];
  priceStatus: "inquiry";
  schemaRevision: string;
  numericValues: Record<string, number>;
}
export function defaultConfiguration(
  catalog: ProductCatalog,
): Record<string, string[]> {
  return Object.fromEntries(
    catalog.groups.map((g) => [g.id, [...g.defaultIds]]),
  );
}
/** Declarative, deterministic and bounded. Invalid input never reaches visual application. */
export function resolveConfiguration(
  catalog: ProductCatalog,
  input: Record<string, string[]>,
  numericInput: Record<string, number> = {},
): ConfigurationResult {
  const selections = Object.fromEntries(
    catalog.groups.map((g) => [
      g.id,
      [...new Set(input[g.id] ?? g.defaultIds)],
    ]),
  );
  const result: ConfigurationResult = {
    selections,
    changes: [],
    errors: [],
    bom: [],
    skus: [],
    priceStatus: "inquiry",
    schemaRevision: catalog.libraryVersionId || catalog.revision,
    numericValues: Object.fromEntries(
      catalog.groups
        .filter((g) => g.control === "number")
        .map((g) => [
          g.id,
          numericInput[g.id] ?? g.numericDefault ?? g.numericMinimum ?? 0,
        ]),
    ),
  };
  const groups = new Map(catalog.groups.map((g) => [g.id, g])),
    visited = new Set<string>(),
    rules = [...catalog.rules].sort(
      (a, b) => b.priority - a.priority || a.id.localeCompare(b.id),
    );
  for (let pass = 0; pass <= Math.max(16, rules.length * 2); pass++) {
    const signature = JSON.stringify([selections, result.numericValues]);
    if (visited.has(signature)) {
      result.errors.push("规则循环导致配置无法收敛");
      break;
    }
    visited.add(signature);
    let changed = false;
    for (const rule of rules) {
      if (!selections[rule.when.groupId]?.includes(rule.when.optionId))
        continue;
      const target = groups.get(rule.then.groupId);
      if (!target) {
        result.errors.push("规则目标属性不存在：" + rule.id);
        continue;
      }
      const list = selections[target.id];
      const update = (next: string[], operation: string) => {
        if (JSON.stringify(next) !== JSON.stringify(list)) {
          selections[target.id] = next;
          result.changes.push({
            groupId: target.id,
            optionId: rule.then.optionId,
            ruleId: rule.id,
            reason: rule.reason,
            operation,
          });
          changed = true;
        }
      };
      if (rule.type === "range" && target.control === "number") {
        const previous = result.numericValues[target.id],
          next = Math.max(rule.minimum, Math.min(rule.maximum, previous));
        if (next !== previous) {
          result.numericValues[target.id] = next;
          result.changes.push({
            groupId: target.id,
            optionId: String(next),
            ruleId: rule.id,
            reason: rule.reason,
            operation: "range",
          });
          changed = true;
        }
      }
      if (
        ["require", "implies", "bundle"].includes(rule.type) &&
        !list.includes(rule.then.optionId)
      )
        update(
          target.max === 1
            ? [rule.then.optionId]
            : [...list, rule.then.optionId],
          "require",
        );
      if (rule.type === "exclude" && list.includes(rule.then.optionId))
        update(
          list.filter((id) => id !== rule.then.optionId),
          "exclude",
        );
      if (rule.type === "default" && !list.length)
        update([rule.then.optionId], "default");
    }
    if (!changed) break;
    if (pass === Math.max(16, rules.length * 2))
      result.errors.push("规则求值超过安全步数");
  }
  for (const group of catalog.groups) {
    const list = selections[group.id];
    if (group.control === "number") {
      const value = result.numericValues[group.id];
      if (
        !Number.isFinite(value) ||
        value < (group.numericMinimum ?? 0) ||
        value > (group.numericMaximum ?? 1)
      )
        result.errors.push(group.name + " 数值超出范围");
      continue;
    }
    if (list.length < group.min || list.length > group.max)
      result.errors.push(
        group.name + " 需要 " + group.min + "～" + group.max + " 个选项",
      );
    for (const id of list)
      if (!group.options.some((o) => o.id === id))
        result.errors.push(group.name + " 包含已删除选项 " + id);
  }
  for (const rule of rules)
    if (selections[rule.when.groupId]?.includes(rule.when.optionId)) {
      const list = selections[rule.then.groupId] ?? [];
      if (
        ["require", "implies", "bundle"].includes(rule.type) &&
        !list.includes(rule.then.optionId)
      )
        result.errors.push(rule.reason);
      if (rule.type === "exclude" && list.includes(rule.then.optionId))
        result.errors.push(rule.reason);
      if (
        rule.type === "count" &&
        (list.length < rule.minimum || list.length > rule.maximum)
      )
        result.errors.push(rule.reason);
      if (
        rule.type === "range" &&
        groups.get(rule.then.groupId)?.control !== "number" &&
        list.some((id) => {
          const value = Number(
            groups.get(rule.then.groupId)?.options.find((o) => o.id === id)
              ?.name,
          );
          return (
            !Number.isFinite(value) ||
            value < rule.minimum ||
            value > rule.maximum
          );
        })
      )
        result.errors.push(rule.reason);
    }
  const bom = new Map<
    string,
    {
      quantity: number;
      sources: { groupId: string; optionId: string; quantity: number }[];
    }
  >();
  for (const group of catalog.groups)
    for (const option of group.options)
      if (selections[group.id].includes(option.id)) {
        if (option.sku) result.skus.push(option.sku);
        for (const part of option.bom) {
          const row = bom.get(part.partId) ?? { quantity: 0, sources: [] };
          row.quantity += part.quantity;
          row.sources.push({
            groupId: group.id,
            optionId: option.id,
            quantity: part.quantity,
          });
          bom.set(part.partId, row);
        }
      }
  result.bom = [...bom].map(([partId, row]) => ({ partId, ...row }));
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
  const reasons: Record<string, string> = {};
  for (const group of catalog.groups)
    for (const option of group.options) {
      const next = {
          ...current,
          [group.id]:
            group.max === 1
              ? [option.id]
              : [...new Set([...(current[group.id] ?? []), option.id])],
        },
        resolved = resolveConfiguration(catalog, next, numeric);
      if (resolved.errors.length)
        reasons[configurationOptionKey(group.id, option.id)] =
          resolved.errors.join("；");
      else if (!resolved.selections[group.id].includes(option.id))
        reasons[configurationOptionKey(group.id, option.id)] =
          resolved.changes.find(
            (c) => c.groupId === group.id && c.operation === "exclude",
          )?.reason ?? "此选项被兼容规则排除";
    }
  return reasons;
}
export function validateCatalog(catalog: ProductCatalog): string[] {
  const errors: string[] = [],
    groups = new Map(catalog.groups.map((g) => [g.id, g]));
  if (groups.size !== catalog.groups.length) errors.push("属性组 ID 重复");
  for (const group of catalog.groups) {
    if (new Set(group.options.map((o) => o.id)).size !== group.options.length)
      errors.push("选项 ID 重复");
    if (group.min > group.max) errors.push("选项数量范围无效");
    for (const id of group.defaultIds)
      if (!group.options.some((o) => o.id === id))
        errors.push("默认选项不存在");
  }
  for (const rule of catalog.rules)
    for (const [index, condition] of [rule.when, rule.then].entries())
      if (
        !groups.has(condition.groupId) ||
        (!(index === 1 && ["range", "count"].includes(rule.type)) &&
          !groups
            .get(condition.groupId)
            ?.options.some((o) => o.id === condition.optionId))
      )
        errors.push("规则引用选项不存在：" + rule.id);
  return [
    ...errors,
    ...resolveConfiguration(catalog, defaultConfiguration(catalog)).errors,
  ];
}
