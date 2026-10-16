import {
  compileRuleGraph,
  defaultConfiguration,
  resolveConfiguration,
  type ProductCatalog,
  type ConfigurationResult,
} from "./core";
export interface CoverageOptions {
  seed?: number;
  randomCases?: number;
  maxCases?: number;
  detailsLimit?: number;
}
export interface CoverageCase {
  id: number;
  kind: string;
  valid: boolean;
  requested: Record<string, string[]>;
  numeric: Record<string, number>;
  resolved: Record<string, string[]>;
  resolvedNumeric: Record<string, number>;
  errors: string[];
  ruleIds: string[];
  skus: string[];
}
export interface CoverageReport {
  catalogId: string;
  catalogRevision: string;
  revisionKind: "library" | "embedded";
  seed: number;
  attempted: number;
  valid: number;
  invalid: number;
  byKind: Record<string, { attempted: number; valid: number }>;
  pairwise: { target: string; covered: number; unresolved: string };
  ternary: { target: string; covered: number; unresolved: string };
  truncated: boolean;
  detailsTruncated: boolean;
  detailsLimit: number;
  cases: CoverageCase[];
  staticDiagnostics: ReturnType<typeof compileRuleGraph>["diagnostics"];
  limitations: string[];
  catalog: ProductCatalog;
}
type Level = { selection?: string[]; number?: number; token: string };
const selectionToken = (values: string[]) => JSON.stringify([...values].sort());
/** Sampled coverage of declared levels. Uncovered tuples are never labelled globally impossible. */
export function analyzeCatalog(
  catalog: ProductCatalog,
  options: CoverageOptions = {},
  progress?: (completed: number, total: number) => void,
): CoverageReport {
  const randomCases = options.randomCases ?? 1000,
    maxCases = options.maxCases ?? 20000,
    detailsLimit = options.detailsLimit ?? 512,
    seed = (options.seed ?? 20260323) >>> 0;
  if (
    !Number.isInteger(randomCases) ||
    randomCases < 0 ||
    randomCases > 10000 ||
    !Number.isInteger(maxCases) ||
    maxCases < randomCases + 1 ||
    maxCases > 100000 ||
    !Number.isInteger(detailsLimit) ||
    detailsLimit < 0 ||
    detailsLimit > 5000
  )
    throw Error("覆盖分析预算无效");
  const ir = compileRuleGraph(catalog),
    defaults = defaultConfiguration(catalog),
    numericDefaults = Object.fromEntries(
      catalog.groups
        .filter((g) => g.control === "number")
        .map((g) => [g.id, g.numericDefault ?? g.numericMinimum ?? 0]),
    );
  let state = seed || 0x9e3779b9;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const levels = catalog.groups.map((group) => {
    const values: Level[] = [];
    if (group.control === "number") {
      const low = group.numericMinimum ?? 0,
        high = group.numericMaximum ?? 1,
        step = group.numericStep ?? 0.01;
      const candidates = [
        low,
        high,
        group.numericDefault ?? low,
        (low + high) / 2,
        ...catalog.rules
          .filter((r) => r.then.groupId === group.id && r.type === "range")
          .flatMap((r) => [
            r.minimum,
            r.maximum,
            r.minimum - step,
            r.minimum + step,
            r.maximum - step,
            r.maximum + step,
          ]),
      ];
      for (const value of candidates) {
        const index = Math.round((value - low) / step),
          number = low + index * step;
        if (
          Number.isFinite(number) &&
          number >= low - 1e-10 &&
          number <= high + 1e-10 &&
          Number.isSafeInteger(index)
        )
          values.push({
            number: number === 0 ? 0 : number,
            token: "n:" + index,
          });
      }
    } else {
      const candidates = [
        group.defaultIds,
        ...group.options.map((o) => [o.id]),
        ...(group.min === 0 ? [[]] : []),
        group.options.slice(0, group.max).map((o) => o.id),
        group.options.slice(-group.max).map((o) => o.id),
      ];
      for (const selection of candidates)
        if (selection.length >= group.min && selection.length <= group.max)
          values.push({
            selection: [...selection],
            token: selectionToken(selection),
          });
    }
    return [...new Map(values.map((value) => [value.token, value])).values()];
  });
  const target = [1n, 0n, 0n, 0n];
  for (const list of levels)
    for (let strength = 3; strength > 0; strength--)
      target[strength] += target[strength - 1] * BigInt(list.length);
  const pairs = new Set<string>(),
    triples = new Set<string>(),
    levelIndices = levels.map(
      (list) => new Map(list.map((level, index) => [level.token, index])),
    );
  let accounting = 0,
    detailBytes = 0;
  const counterexamples = new Set<string>();
  const accountingBudget = Math.min(500000, maxCases * 50),
    detailsBytesLimit = 8 * 1024 * 1024;
  const report: CoverageReport = {
    catalogId: catalog.catalogId,
    catalogRevision: catalog.libraryVersionId || catalog.revision,
    revisionKind: catalog.libraryVersionId ? "library" : "embedded",
    seed,
    attempted: 0,
    valid: 0,
    invalid: 0,
    byKind: {},
    pairwise: {
      target: String(target[2]),
      covered: 0,
      unresolved: String(target[2]),
    },
    ternary: {
      target: String(target[3]),
      covered: 0,
      unresolved: String(target[3]),
    },
    truncated: false,
    detailsTruncated: false,
    detailsLimit,
    cases: [],
    staticDiagnostics: ir.diagnostics,
    limitations: [
      "Pairwise/ternary levels include defaults, individual options, representative checkbox subsets and numeric boundaries; checkbox power sets are not exhaustively enumerated.",
      "Invalid sampled requests can normalize to another legal configuration. They do not prove a tuple is globally impossible.",
      "Uncovered or budget-truncated tuples remain unresolved. Static implication diagnostics and sampled results are reported separately.",
      "This report evaluates rule/catalog semantics. Model primitive admission and physical-device evidence are independent checks.",
    ],
    catalog,
  };
  const tokenFor = (index: number, result: ConfigurationResult) => {
    const group = catalog.groups[index];
    return group.control === "number"
      ? "n:" + result.numericSteps[group.id]?.index
      : selectionToken(result.selections[group.id]);
  };
  const tuple = (indices: number[], tokens: string[]) =>
    indices
      .map((index, i) => index + ":" + levelIndices[index].get(tokens[i]))
      .join("|");
  const sample = (
    kind: string,
    requested: Record<string, string[]>,
    numeric: Record<string, number>,
    assumptions: Map<number, Level> = new Map(),
  ): boolean => {
    if (report.attempted >= maxCases) {
      report.truncated = true;
      return false;
    }
    const result = resolveConfiguration(catalog, requested, numeric, {
        compiled: ir,
      }),
      errors = [...result.errors];
    for (const [index, level] of assumptions)
      if (tokenFor(index, result) !== level.token)
        errors.push(
          "请求条件被规则调整：" +
            catalog.groups[index].name +
            "；当前默认上下文尚未找到保留该条件的合法结果",
        );
    const valid = errors.length === 0;
    report.attempted++;
    if (valid) report.valid++;
    else report.invalid++;
    const counts = (report.byKind[kind] ??= { attempted: 0, valid: 0 });
    counts.attempted++;
    if (valid) counts.valid++;
    if (valid && accounting < accountingBudget) {
      const observed = catalog.groups.map((_, index) =>
          tokenFor(index, result),
        ),
        known = observed.map((token, index) => levelIndices[index].has(token));
      account: for (let a = 0; a < levels.length; a++)
        if (known[a])
          for (let b = a + 1; b < levels.length; b++)
            if (known[b]) {
              if (++accounting > accountingBudget) {
                report.truncated = true;
                break account;
              }
              pairs.add(tuple([a, b], [observed[a], observed[b]]));
              for (let c = b + 1; c < levels.length; c++)
                if (known[c]) {
                  if (++accounting > accountingBudget) {
                    report.truncated = true;
                    break account;
                  }
                  triples.add(
                    tuple([a, b, c], [observed[a], observed[b], observed[c]]),
                  );
                }
            }
    }
    const detail: CoverageCase = {
        id: report.attempted,
        kind,
        valid,
        requested,
        numeric,
        resolved: result.selections,
        resolvedNumeric: result.numericValues,
        errors,
        ruleIds: [...new Set(result.diagnostics.flatMap((d) => d.ruleIds))],
        skus: result.skus,
      },
      size = JSON.stringify(detail).length * 2;
    if (
      (counts.attempted <= Math.max(1, Math.floor(detailsLimit / 6)) ||
        (!valid && !counterexamples.has(kind))) &&
      detailBytes + size <= detailsBytesLimit &&
      detailsLimit > 0
    ) {
      if (report.cases.length >= detailsLimit) {
        if (!valid && !counterexamples.has(kind)) {
          const index = report.cases.findIndex((c) => c.valid);
          if (index >= 0) report.cases.splice(index, 1);
        }
      }
      if (report.cases.length < detailsLimit) {
        report.cases.push(detail);
        detailBytes += size;
        if (!valid) counterexamples.add(kind);
      } else report.detailsTruncated = true;
    } else report.detailsTruncated = true;
    if (valid && accounting >= accountingBudget) report.truncated = true;
    if (report.attempted % 100 === 0) progress?.(report.attempted, maxCases);
    return true;
  };
  sample("default", defaults, numericDefaults);
  if (
    ir.diagnostics.some(
      (d) => d.severity === "error" && d.code !== "unreachable-option",
    )
  )
    return report;
  for (let i = 0; i < randomCases; i++) {
    const choices = Object.fromEntries(
        catalog.groups.map((g) => [g.id, [] as string[]]),
      ),
      numbers = { ...numericDefaults },
      assumptions = new Map<number, Level>();
    catalog.groups.forEach((group, index) => {
      let level: Level;
      if (group.control === "number") {
        const low = group.numericMinimum ?? 0,
          step = group.numericStep ?? 0.01,
          max = Math.floor(((group.numericMaximum ?? 1) - low) / step + 1e-9),
          grid = Math.floor(random() * (max + 1));
        level = { number: low + grid * step, token: "n:" + grid };
        numbers[group.id] = level.number!;
      } else {
        const shuffled = [...group.options];
        for (let k = shuffled.length - 1; k > 0; k--) {
          const j = Math.floor(random() * (k + 1));
          [shuffled[k], shuffled[j]] = [shuffled[j], shuffled[k]];
        }
        const size =
            group.min +
            Math.floor(
              random() *
                Math.max(
                  1,
                  Math.min(group.max, shuffled.length) - group.min + 1,
                ),
            ),
          selection = shuffled.slice(0, size).map((o) => o.id);
        level = { selection, token: selectionToken(selection) };
        choices[group.id] = selection;
      }
      assumptions.set(index, level);
    });
    sample("random", choices, numbers, assumptions);
  }
  for (const group of catalog.groups)
    if (group.control === "number")
      for (const value of [
        (group.numericMinimum ?? 0) - (group.numericStep ?? 0.01),
        (group.numericMaximum ?? 1) + (group.numericStep ?? 0.01),
        ...catalog.rules
          .filter((r) => r.then.groupId === group.id && r.type === "range")
          .flatMap((r) => [
            r.minimum - (group.numericStep ?? 0.01),
            r.minimum,
            r.maximum,
            r.maximum + (group.numericStep ?? 0.01),
          ]),
      ])
        if (Number.isFinite(value))
          sample(
            "boundary",
            defaults,
            { ...numericDefaults, [group.id]: value },
            new Map([
              [
                catalog.groups.indexOf(group),
                {
                  number: value,
                  token:
                    "n:" +
                    Math.round(
                      (value - (group.numericMinimum ?? 0)) /
                        (group.numericStep ?? 0.01),
                    ),
                },
              ],
            ]),
          );
  const applyLevels = (indices: number[], chosen: Level[], kind: string) => {
    const choices = Object.fromEntries(
        Object.entries(defaults).map(([id, list]) => [id, [...list]]),
      ),
      numbers = { ...numericDefaults },
      assumptions = new Map<number, Level>();
    indices.forEach((index, i) => {
      const group = catalog.groups[index],
        level = chosen[i];
      if (group.control === "number") numbers[group.id] = level.number!;
      else choices[group.id] = level.selection!;
      assumptions.set(index, level);
    });
    return sample(kind, choices, numbers, assumptions);
  };
  for (let group = 0; group < levels.length; group++)
    for (const level of levels[group])
      if (!applyLevels([group], [level], "single-boundary")) break;
  for (const strength of [2, 3]) {
    const covered = strength === 2 ? pairs : triples;
    const visitGroups = (indices: number[], start: number): boolean => {
      if (indices.length === strength) {
        const selected: Level[] = [];
        const visitLevels = (depth: number): boolean => {
          if (depth === indices.length) {
            if (
              covered.has(
                tuple(
                  indices,
                  selected.map((level) => level.token),
                ),
              )
            )
              return true;
            return applyLevels(
              indices,
              selected,
              strength === 2 ? "pairwise" : "ternary",
            );
          }
          for (const level of levels[indices[depth]]) {
            selected[depth] = level;
            if (!visitLevels(depth + 1)) return false;
          }
          return true;
        };
        return visitLevels(0);
      }
      for (let index = start; index < levels.length; index++) {
        if (!visitGroups([...indices, index], index + 1)) return false;
      }
      return true;
    };
    if (!visitGroups([], 0)) break;
  }
  report.pairwise = {
    target: String(target[2]),
    covered: pairs.size,
    unresolved: String(target[2] - BigInt(pairs.size)),
  };
  report.ternary = {
    target: String(target[3]),
    covered: triples.size,
    unresolved: String(target[3] - BigInt(triples.size)),
  };
  progress?.(report.attempted, report.attempted);
  return report;
}
