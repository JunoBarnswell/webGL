import {
  compileRuleGraph,
  resolveRuleIR,
  type RuleCondition,
  type RuleContext,
  type RuleDiagnostic,
} from "./rules";
export * from "./rules";
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
  conditions?: RuleCondition[];
  conditionJoin?: "all" | "any";
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
    catalog.groups.map((g) => [g.id, [...g.defaultIds]]),
  );
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
      sources: { groupId: string; optionId: string; quantity: number }[];
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
  const reasons: Record<string, string> = {},
    compiled = compileRuleGraph(catalog);
  for (const group of catalog.groups)
    for (const option of group.options) {
      const next = {
          ...current,
          [group.id]:
            group.max === 1
              ? [option.id]
              : [...new Set([...(current[group.id] ?? []), option.id])],
        },
        resolved = resolveConfiguration(catalog, next, numeric, {
          compiled,
          intent: { groupId: group.id, optionId: option.id },
        });
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
  const ir = compileRuleGraph(catalog);
  return [
    ...new Set([
      ...ir.diagnostics
        .filter((d) => d.severity === "error")
        .map((d) => d.message),
      ...resolveConfiguration(
        catalog,
        defaultConfiguration(catalog),
        {},
        { compiled: ir },
      ).errors,
    ]),
  ];
}
