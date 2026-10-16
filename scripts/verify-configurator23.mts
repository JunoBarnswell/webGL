import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import {
  compileRuleGraph,
  resolveConfiguration,
  defaultConfiguration,
  toggleConfigurationOption,
  resolveVisualCandidates,
  formatNumericValue,
  type ProductCatalog,
  type ConfigRule,
  type MappingSource,
} from "../packages/extensions/configurator/core";
import { analyzeCatalog } from "../packages/extensions/configurator/coverage";
const option = (id: string) => ({
  id,
  name: id,
  sku: id,
  color: "#ffffff",
  imageAssetId: "",
  description: "",
  bom: [{ partId: id, quantity: 1 }],
  visuals: [],
});
const group = (id: string) => ({
  id,
  name: id,
  control: "checkbox",
  min: 0,
  max: 2,
  defaultIds: [],
  options: [option("a"), option("b"), option("c")],
});
const catalog: ProductCatalog = {
  catalogId: "owned",
  revision: "embedded-7",
  name: "priority",
  market: "",
  priceSource: "",
  priceCurrency: "CNY",
  groups: [group("g"), group("h")],
  rules: [],
};
const rule = (
  id: string,
  type: string,
  priority: number,
  optionId = "a",
  minimum = 0,
  maximum = 2,
): ConfigRule => ({
  id,
  type,
  priority,
  when: { groupId: "", optionId: "" },
  then: { groupId: "g", optionId },
  minimum,
  maximum,
  reason: id,
});
const solve = (c: ProductCatalog) =>
  resolveConfiguration(c, defaultConfiguration(c));
const withRules = (...rules: ConfigRule[]) => ({
  ...structuredClone(catalog),
  rules,
});
let result = solve(
  withRules(rule("require", "require", 10), rule("exclude", "exclude", 5)),
);
assert.deepEqual(result.selections.g, ["a"]);
assert.deepEqual(result.errors, []);
assert.ok(result.diagnostics.some((d) => d.code === "shadowed-rule"));
assert.ok(
  solve(
    withRules(rule("require", "require", 10), rule("exclude", "exclude", 10)),
  ).errors.length,
);
assert.ok(
  solve(
    withRules(
      rule("a", "require", 10, "a"),
      rule("b", "require", 10, "b"),
      rule("c", "require", 10, "c"),
    ),
  ).errors.length,
);
result = solve(
  withRules(
    rule("a", "require", 10, "a"),
    rule("b", "require", 9, "b"),
    rule("c", "require", 8, "c"),
  ),
);
assert.deepEqual(result.selections.g, ["a", "b"]);
assert.deepEqual(result.errors, []);
const intentCatalog = structuredClone(catalog);
intentCatalog.groups[0].max = 1;
assert.deepEqual(
  toggleConfigurationOption(intentCatalog.groups[0], ["a"], "a"),
  [],
);
result = resolveConfiguration(
  intentCatalog,
  { g: ["a", "b"], h: [] },
  {},
  { intent: { groupId: "g", optionId: "b", selected: true } },
);
assert.deepEqual(result.selections.g, ["b"]);
result = resolveConfiguration(
  intentCatalog,
  { g: [], h: [] },
  {},
  { intent: { groupId: "g", optionId: "a", selected: false } },
);
assert.deepEqual(result.errors, []);
const conditional = withRules(
  {
    ...rule("transient", "exclude", 0),
    conditions: [
      { groupId: "h", operator: "selected", optionId: "a", value: 0 },
    ],
  },
  { ...rule("withdraw", "exclude", 10), then: { groupId: "h", optionId: "a" } },
);
conditional.groups[0].defaultIds = ["a"];
conditional.groups[1].defaultIds = ["a"];
result = solve(conditional);
assert.deepEqual(result.selections.g, ["a"]);
assert.deepEqual(result.errors, []);
const numeric: ProductCatalog = {
  ...structuredClone(catalog),
  groups: [
    {
      ...group("n"),
      control: "number",
      numericMinimum: 1000000000000000,
      numericMaximum: 1000000000000010,
      numericStep: 1,
      numericDefault: 1000000000000007,
    },
  ],
};
result = solve(numeric);
assert.equal(result.numericValues.n, 1000000000000007);
assert.equal(result.numericSteps.n.index, 7);
assert.equal(
  formatNumericValue(numeric.groups[0], result.numericValues.n),
  "1000000000000007",
);
const ranges = {
  ...numeric,
  groups: [
    {
      ...numeric.groups[0],
      numericMinimum: 0,
      numericMaximum: 100,
      numericDefault: 80,
    },
  ],
  rules: [
    {
      ...rule("range-high", "range", 10, "", 10, 20),
      then: { groupId: "n", optionId: "" },
    },
    {
      ...rule("range-low", "range", 1, "", 70, 90),
      then: { groupId: "n", optionId: "" },
    },
  ],
};
result = solve(ranges);
assert.deepEqual(result.errors, []);
assert.equal(result.numericValues.n, 20);
assert.ok(
  compileRuleGraph({
    ...numeric,
    groups: [{ ...numeric.groups[0], numericStep: 0.01 }],
  }).diagnostics.some((d) => d.code === "unsafe-step-domain"),
);
const source = (mappingId: string, priority: number): MappingSource => ({
  mappingId,
  priority,
  groupId: "g",
  optionId: "a",
  catalogId: "owned",
  catalogRevision: "7",
});
const candidate = (id: string, priority: number, signature: string) => ({
  key: "primitive",
  priority,
  signature,
  value: signature,
  source: source(id, priority),
});
assert.throws(() =>
  resolveVisualCandidates([
    candidate("a", 0, "red"),
    candidate("b", 0, "blue"),
  ]),
);
assert.equal(
  resolveVisualCandidates([
    candidate("a", 10, "red"),
    candidate("b", 0, "blue"),
  ]).get("primitive")?.value,
  "red",
);
const report = analyzeCatalog(catalog, {
  randomCases: 1000,
  maxCases: 5000,
  seed: 42,
});
assert.equal(report.byKind.random.attempted, 1000);
assert.ok(report.pairwise.covered > 0);
assert.deepEqual(
  report,
  analyzeCatalog(catalog, { randomCases: 1000, maxCases: 5000, seed: 42 }),
);
assert.ok(report.cases.some((c) => c.kind === "random"));
result = resolveConfiguration(catalog, { g: ["a"], h: [] });
assert.equal(result.bom[0].sources[0].revisionKind, "embedded");
assert.equal(result.bom[0].sources[0].catalogRevision, "embedded-7");
await mkdir(".local/acceptance/studio-2.3", { recursive: true });
await writeFile(
  ".local/acceptance/studio-2.3/configuration-coverage.json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    pass: true,
    cases: report.attempted,
    pairwise: report.pairwise,
    ternary: report.ternary,
    checks: [
      "priority/equal-conflict/cardinality/manual-selection-and-deselection",
      "withdrawn conditional consequences",
      "integer-index/large-number/range-priority",
      "per-primitive priorities",
      "1000 deterministic random and tuple coverage",
      "embedded BOM provenance",
    ],
  }),
);
