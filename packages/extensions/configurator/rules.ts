import type { ConfigRule, ProductCatalog, ConfigurationResult } from "./core";
export interface RuleCondition {
  groupId: string;
  operator: "selected" | "notSelected" | "gte" | "lte" | "eq";
  optionId: string;
  value: number;
}
export interface RuleDiagnostic {
  code: string;
  severity: "error" | "warning";
  message: string;
  ruleIds: string[];
  optionKeys: string[];
}
export interface RuleEdge {
  from: string;
  to: string;
  ruleId: string;
  priority: number;
}
export interface RuleIR {
  catalog: ProductCatalog;
  rules: ConfigRule[];
  edges: RuleEdge[];
  diagnostics: RuleDiagnostic[];
  nodes: {
    key: string;
    groupId: string;
    optionId: string;
    selected: boolean;
  }[];
  explanations: Record<string, RuleDiagnostic>;
}
export interface ConfigurationIntent {
  groupId: string;
  optionId?: string;
  value?: number;
  selected?: boolean;
}
export interface RuleContext {
  intent?: ConfigurationIntent;
  compiled?: RuleIR;
}
const key = (group: string, option: string, selected = true) =>
  JSON.stringify([group, option, selected]);
const cached = new WeakMap<ProductCatalog, RuleIR>();
const diagnostic = (
  code: string,
  message: string,
  ruleIds: string[] = [],
  optionKeys: string[] = [],
): RuleDiagnostic => ({
  code,
  severity: "error",
  message,
  ruleIds,
  optionKeys,
});
export function ruleConditionMatches(
  rule: ConfigRule,
  selections: Record<string, string[]>,
  numeric: Record<string, number>,
): boolean {
  const primary =
    !rule.when.groupId ||
    Boolean(selections[rule.when.groupId]?.includes(rule.when.optionId));
  const conditions = rule.conditions ?? [];
  const matches = conditions.map((c) =>
    c.operator === "selected"
      ? Boolean(selections[c.groupId]?.includes(c.optionId))
      : c.operator === "notSelected"
        ? !selections[c.groupId]?.includes(c.optionId)
        : c.operator === "gte"
          ? numeric[c.groupId] >= c.value
          : c.operator === "lte"
            ? numeric[c.groupId] <= c.value
            : numeric[c.groupId] === c.value,
  );
  return (
    primary &&
    (!matches.length ||
      (rule.conditionJoin === "any"
        ? matches.some(Boolean)
        : matches.every(Boolean)))
  );
}
/** Immutable catalog -> one rule IR. Positive dependency cycles are legal; contradictions are not. */
export function compileRuleGraph(catalog: ProductCatalog): RuleIR {
  const previous = Object.isFrozen(catalog) ? cached.get(catalog) : undefined;
  if (previous) return previous;
  const groups = new Map(catalog.groups.map((g) => [g.id, g])),
    diagnostics: RuleDiagnostic[] = [],
    edges: RuleEdge[] = [],
    nodes: RuleIR["nodes"] = [];
  if (groups.size !== catalog.groups.length)
    diagnostics.push(diagnostic("duplicate-group", "属性组 ID 重复"));
  if (new Set(catalog.rules.map((r) => r.id)).size !== catalog.rules.length)
    diagnostics.push(diagnostic("duplicate-rule", "规则 ID 重复"));
  for (const group of catalog.groups) {
    if (
      group.control !== "number" &&
      new Set(group.options.map((o) => o.id)).size !== group.options.length
    )
      diagnostics.push(
        diagnostic("duplicate-option", "选项 ID 重复：" + group.name),
      );
    if (
      group.control !== "number" &&
      (!Number.isInteger(group.min) ||
        !Number.isInteger(group.max) ||
        group.min > group.max ||
        group.min < 0 ||
        group.max < 1)
    )
      diagnostics.push(
        diagnostic("cardinality", "选项数量范围无效：" + group.name),
      );
    for (const id of group.control === "number" ? [] : group.defaultIds)
      if (!group.options.some((o) => o.id === id))
        diagnostics.push(
          diagnostic("missing-default", "默认选项不存在：" + id),
        );
    if (group.control === "number") {
      const low = group.numericMinimum ?? 0,
        high = group.numericMaximum ?? 1,
        step = group.numericStep ?? 0.01;
      if (
        Number.isFinite(low) &&
        Number.isFinite(high) &&
        Number.isFinite(step) &&
        step > 0 &&
        (!Number.isSafeInteger(Math.floor((high - low) / step + 1e-9)) ||
          (low < high && (low + step === low || high - step === high)))
      )
        diagnostics.push(
          diagnostic(
            "unsafe-step-domain",
            "数值范围无法用安全且互异的步长索引表示：" + group.name,
          ),
        );
      if (
        !Number.isFinite(low) ||
        !Number.isFinite(high) ||
        low > high ||
        !Number.isFinite(step) ||
        step <= 0
      )
        diagnostics.push(
          diagnostic("numeric-domain", "数值范围或步长无效：" + group.name),
        );
    } else
      for (const option of group.options) {
        for (const selected of [true, false])
          nodes.push({
            key: key(group.id, option.id, selected),
            groupId: group.id,
            optionId: option.id,
            selected,
          });
        if (group.max === 1)
          for (const other of group.options)
            if (other.id !== option.id)
              edges.push({
                from: key(group.id, option.id),
                to: key(group.id, other.id, false),
                ruleId: "@cardinality:" + group.id,
                priority: Number.MAX_SAFE_INTEGER,
              });
      }
  }
  const rules = [...catalog.rules].sort(
    (a, b) =>
      b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  for (const rule of rules) {
    const source = groups.get(rule.when.groupId),
      target = groups.get(rule.then.groupId);
    if (
      !target ||
      (!["count", "range"].includes(rule.type) &&
        (target.control === "number" ||
          !target.options.some((o) => o.id === rule.then.optionId))) ||
      (rule.when.groupId &&
        (!source ||
          source.control === "number" ||
          !source.options.some((o) => o.id === rule.when.optionId)))
    ) {
      diagnostics.push(
        diagnostic("missing-option", "规则引用选项不存在：" + rule.id, [
          rule.id,
        ]),
      );
      continue;
    }
    if (
      !Number.isFinite(rule.priority) ||
      ![
        "require",
        "implies",
        "exclude",
        "default",
        "count",
        "range",
        "bundle",
      ].includes(rule.type)
    )
      diagnostics.push(
        diagnostic("invalid-rule", "规则类型或优先级无效：" + rule.id, [
          rule.id,
        ]),
      );
    if (
      ["count", "range"].includes(rule.type) &&
      (!Number.isFinite(rule.minimum) ||
        !Number.isFinite(rule.maximum) ||
        rule.minimum > rule.maximum)
    )
      diagnostics.push(
        diagnostic("invalid-range", "规则范围无效：" + rule.id, [rule.id]),
      );
    if (
      rule.type === "count" &&
      (target.control === "number" ||
        !Number.isInteger(rule.minimum) ||
        !Number.isInteger(rule.maximum) ||
        rule.minimum < 0)
    )
      diagnostics.push(
        diagnostic(
          "invalid-count",
          "数量规则需要非负整数和选项属性：" + rule.id,
          [rule.id],
        ),
      );
    for (const c of rule.conditions ?? []) {
      const g = groups.get(c.groupId);
      if (
        !g ||
        !["selected", "notSelected", "gte", "lte", "eq"].includes(c.operator) ||
        (["selected", "notSelected"].includes(c.operator)
          ? g.control === "number" ||
            !g.options.some((o) => o.id === c.optionId)
          : g.control !== "number" || !Number.isFinite(c.value))
      )
        diagnostics.push(
          diagnostic("invalid-condition", "条件字段或类型无效：" + rule.id, [
            rule.id,
          ]),
        );
    }
    if (
      rule.when.groupId &&
      !rule.conditions?.length &&
      ["require", "implies", "bundle", "exclude"].includes(rule.type)
    )
      edges.push({
        from: key(rule.when.groupId, rule.when.optionId),
        to: key(rule.then.groupId, rule.then.optionId, rule.type !== "exclude"),
        ruleId: rule.id,
        priority: rule.priority,
      });
  }
  const adjacency = new Map<string, RuleEdge[]>();
  for (const edge of edges)
    (
      adjacency.get(edge.from) ??
      (adjacency.set(edge.from, []), adjacency.get(edge.from)!)
    ).push(edge);
  const explanations: Record<string, RuleDiagnostic> = {};
  for (const seed of nodes.filter((n) => n.selected)) {
    const reached = new Map<string, { path: string[]; priority: number }>([
        [seed.key, { path: [], priority: Infinity }],
      ]),
      queue = [seed.key];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor],
        state = reached.get(current);
      if (!state) continue;
      for (const edge of adjacency.get(current) ?? []) {
        const rank = Math.min(state.priority, edge.priority);
        const parsed = JSON.parse(edge.to) as [string, string, boolean],
          opposite = key(parsed[0], parsed[1], !parsed[2]),
          opposing = reached.get(opposite);
        if (
          opposing &&
          opposing.priority !== rank &&
          Number.isFinite(opposing.priority) &&
          Number.isFinite(rank)
        ) {
          if (opposing.priority > rank) continue;
          reached.delete(opposite);
        }
        if (!reached.has(edge.to) || reached.get(edge.to)!.priority < rank) {
          reached.set(edge.to, {
            path: [...state.path, edge.ruleId],
            priority: rank,
          });
          queue.push(edge.to);
        }
        const contradiction = reached.get(opposite);
        if (contradiction) {
          const ids = [
            ...new Set([...state.path, edge.ruleId, ...contradiction.path]),
          ].filter((id) => !id.startsWith("@"));
          const names = ids.map(
            (id) => catalog.rules.find((r) => r.id === id)?.reason || id,
          );
          const d = diagnostic(
            "unreachable-option",
            "不可达选项 " +
              seed.groupId +
              " / " +
              seed.optionId +
              "：" +
              names.join(" → "),
            ids,
            [key(seed.groupId, seed.optionId)],
          );
          explanations[key(seed.groupId, seed.optionId)] = d;
          diagnostics.push(d);
          cursor = queue.length;
          break;
        }
      }
    }
  }
  const ir = { catalog, rules, edges, diagnostics, nodes, explanations };
  if (Object.isFrozen(catalog)) cached.set(catalog, ir);
  return ir;
}
type Resolution = Pick<
  ConfigurationResult,
  "selections" | "numericValues" | "numericSteps" | "changes" | "errors"
> & { diagnostics: RuleDiagnostic[] };
interface Vote {
  value: boolean;
  priority: number;
  ruleIds: string[];
  manual: boolean;
}
const stableSignature = (
  catalog: ProductCatalog,
  selections: Record<string, string[]>,
  numbers: Record<string, number>,
) =>
  JSON.stringify(
    catalog.groups.map((g) => [
      g.id,
      selections[g.id] ?? [],
      numbers[g.id] ?? null,
    ]),
  );
/** Every pass rebuilds consequences from the intent. Only the final stable pass supplies conflicts. */
export function resolveRuleIR(
  catalog: ProductCatalog,
  input: Record<string, string[]>,
  numericInput: Record<string, number>,
  context: RuleContext = {},
): Resolution {
  const ir = context.compiled ?? compileRuleGraph(catalog);
  if (ir.catalog !== catalog) throw Error("规则索引与目录修订不匹配");
  const groups = new Map(catalog.groups.map((g) => [g.id, g])),
    base: Record<string, string[]> = Object.fromEntries(
      catalog.groups.map((g) => [g.id, []]),
    ),
    baseNumeric: Record<string, number> = Object.fromEntries(
      catalog.groups
        .filter((g) => g.control === "number")
        .map((g) => [g.id, 0]),
    ),
    baseIssues = ir.diagnostics
      .filter((d) => d.code !== "unreachable-option")
      .slice(),
    changes: ConfigurationResult["changes"] = [];
  const issue = (
    list: RuleDiagnostic[],
    code: string,
    message: string,
    ruleIds: string[] = [],
    optionKeys: string[] = [],
    severity: RuleDiagnostic["severity"] = "error",
  ) =>
    list.push({ ...diagnostic(code, message, ruleIds, optionKeys), severity });
  for (const group of catalog.groups) {
    base[group.id] =
      group.control === "number"
        ? []
        : [
            ...new Set(
              Object.hasOwn(input, group.id)
                ? input[group.id]
                : group.defaultIds,
            ),
          ];
    if (base[group.id].some((id) => !group.options.some((o) => o.id === id)))
      issue(baseIssues, "unknown-option", "未知选项：" + group.name);
    if (
      group.control === "number" &&
      Object.hasOwn(input, group.id) &&
      input[group.id].length
    )
      issue(
        baseIssues,
        "numeric-choice",
        "数值属性不接受选项选择：" + group.name,
      );
    if (group.control === "number") {
      const value =
        (Object.hasOwn(numericInput, group.id)
          ? numericInput[group.id]
          : undefined) ??
        group.numericDefault ??
        group.numericMinimum ??
        0;
      baseNumeric[group.id] = value;
      if (
        !Number.isFinite(value) ||
        value < (group.numericMinimum ?? 0) ||
        value > (group.numericMaximum ?? 1)
      )
        issue(
          baseIssues,
          "numeric-domain",
          "数值越界或不是有限数字：" + group.name,
        );
    }
  }
  for (const id of Object.keys(input))
    if (!groups.has(id))
      issue(baseIssues, "unknown-group", "未知配置属性：" + id);
  for (const id of Object.keys(numericInput))
    if (groups.get(id)?.control !== "number")
      issue(baseIssues, "unknown-numeric-group", "未知数值属性：" + id);
  if (
    context.intent &&
    (!groups.has(context.intent.groupId) ||
      (context.intent.optionId &&
        !groups
          .get(context.intent.groupId)!
          .options.some((o) => o.id === context.intent!.optionId)))
  )
    issue(baseIssues, "unknown-intent", "手工操作的属性或选项不存在");
  let selections = structuredClone(base),
    numericValues = { ...baseNumeric },
    numericSteps: ConfigurationResult["numericSteps"] = Object.create(null),
    finalIssues: RuleDiagnostic[] = [],
    converged = false;
  const seen = new Set<string>(),
    budget = Math.min(
      1024,
      Math.max(32, ir.rules.length * 4 + catalog.groups.length * 2),
    );
  if (baseIssues.some((d) => d.severity === "error"))
    return {
      selections,
      numericValues,
      numericSteps,
      changes,
      errors: baseIssues
        .filter((d) => d.severity === "error")
        .map((d) => d.message),
      diagnostics: baseIssues,
    };
  for (let pass = 0; pass < budget; pass++) {
    const signature = stableSignature(catalog, selections, numericValues),
      issues: RuleDiagnostic[] = [];
    if (seen.has(signature)) {
      issue(
        issues,
        "negative-cycle",
        "规则条件形成无法收敛的冲突路径",
        ir.rules
          .filter((r) => ruleConditionMatches(r, selections, numericValues))
          .map((r) => r.id),
      );
      finalIssues = issues;
      break;
    }
    seen.add(signature);
    const active = ir.rules.filter((r) =>
        ruleConditionMatches(r, selections, numericValues),
      ),
      votes = new Map<string, Vote>(),
      next: Record<string, string[]> = Object.fromEntries(
        catalog.groups.map((g) => [g.id, []]),
      ),
      numbers = { ...baseNumeric },
      steps: ConfigurationResult["numericSteps"] = Object.create(null);
    const shadow = (
      ruleIds: string[],
      by: string[],
      message = "较低优先级规则被覆盖",
    ) =>
      issue(
        issues,
        "shadowed-rule",
        message + "：" + ruleIds.join(",") + " ← " + by.join(" → "),
        [...by, ...ruleIds],
        [],
        "warning",
      );
    for (const group of catalog.groups)
      for (const option of group.options)
        votes.set(key(group.id, option.id), {
          value: base[group.id].includes(option.id),
          priority: -Infinity,
          ruleIds: [],
          manual:
            context.intent?.groupId === group.id &&
            context.intent.optionId === option.id,
        });
    const vote = (
      groupId: string,
      optionId: string,
      value: boolean,
      rule: ConfigRule,
    ) => {
      const id = key(groupId, optionId),
        old = votes.get(id);
      if (!old) return;
      if (old.priority > rule.priority) {
        if (old.value !== value) shadow([rule.id], old.ruleIds);
        return;
      }
      if (old.priority === rule.priority && old.value !== value) {
        issue(
          issues,
          "equal-priority-conflict",
          "同优先级规则互相矛盾：" + [...old.ruleIds, rule.id].join(" → "),
          [...old.ruleIds, rule.id],
          [id],
        );
        return;
      }
      votes.set(id, {
        value,
        priority: rule.priority,
        ruleIds:
          old.priority === rule.priority
            ? [...new Set([...old.ruleIds, rule.id])]
            : [rule.id],
        manual: old.manual,
      });
      const group = groups.get(groupId)!;
      if (value && group.max === 1)
        for (const option of group.options)
          if (option.id !== optionId) {
            const other = votes.get(key(groupId, option.id))!;
            if (other.value && other.priority === rule.priority) {
              issue(
                issues,
                "equal-priority-conflict",
                "单选组的同优先级规则要求不同选项：" +
                  [...other.ruleIds, rule.id].join(" → "),
                [...other.ruleIds, rule.id],
              );
              continue;
            }
            if (other.priority <= rule.priority)
              votes.set(key(groupId, option.id), {
                value: false,
                priority: rule.priority,
                ruleIds: [rule.id],
                manual: other.manual,
              });
          }
    };
    for (const rule of active) {
      const group = groups.get(rule.then.groupId)!;
      if (["require", "implies", "bundle"].includes(rule.type))
        vote(group.id, rule.then.optionId, true, rule);
      else if (rule.type === "exclude")
        vote(group.id, rule.then.optionId, false, rule);
      else if (rule.type === "range" && group.control !== "number")
        for (const option of group.options) {
          const value = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(
            option.name.trim(),
          )
            ? Number(option.name)
            : NaN;
          if (
            !Number.isFinite(value) ||
            value < rule.minimum ||
            value > rule.maximum
          )
            vote(group.id, option.id, false, rule);
        }
    }
    for (const rule of active.filter((r) => r.type === "default")) {
      const group = groups.get(rule.then.groupId)!;
      if (
        !base[group.id].length &&
        !group.options.some((o) => votes.get(key(group.id, o.id))!.value) &&
        votes.get(key(group.id, rule.then.optionId))!.priority === -Infinity
      )
        vote(group.id, rule.then.optionId, true, rule);
    }
    const bounds = (rules: ConfigRule[], minimum: number, maximum: number) => {
      let low = minimum,
        high = maximum,
        minRule: ConfigRule | undefined,
        maxRule: ConfigRule | undefined;
      const accepted: ConfigRule[] = [];
      for (const rule of rules) {
        if (rule.minimum > maximum || rule.maximum < minimum) {
          issue(issues, "constraint-domain", "约束超出属性定义域：" + rule.id, [
            rule.id,
          ]);
          continue;
        }
        const conflict = accepted.find(
          (r) => r.minimum > rule.maximum || r.maximum < rule.minimum,
        );
        if (conflict) {
          if (conflict.priority > rule.priority) {
            shadow([rule.id], [conflict.id]);
            continue;
          }
          issue(
            issues,
            "equal-priority-range",
            "同优先级范围没有交集：" + conflict.id + " → " + rule.id,
            [conflict.id, rule.id],
          );
          continue;
        }
        accepted.push(rule);
        if (rule.minimum > low) {
          low = rule.minimum;
          minRule = rule;
        }
        if (rule.maximum < high) {
          high = rule.maximum;
          maxRule = rule;
        }
      }
      return { low, high, minRule, maxRule, accepted };
    };
    for (const group of catalog.groups) {
      if (group.control === "number") {
        const domain = bounds(
            active.filter(
              (r) => r.then.groupId === group.id && r.type === "range",
            ),
            group.numericMinimum ?? 0,
            group.numericMaximum ?? 1,
          ),
          step = group.numericStep ?? 0.01,
          origin = group.numericMinimum ?? 0,
          minIndex = Math.ceil((domain.low - origin) / step - 1e-9),
          maxIndex = Math.floor((domain.high - origin) / step + 1e-9);
        next[group.id] = [];
        if (minIndex > maxIndex) {
          issue(
            issues,
            "empty-step-domain",
            "范围内没有符合步长的数值：" + group.name,
            domain.accepted.map((r) => r.id),
          );
          continue;
        }
        if (
          context.intent?.groupId === group.id &&
          (baseNumeric[group.id] < domain.low ||
            baseNumeric[group.id] > domain.high)
        )
          issue(
            issues,
            "manual-numeric-conflict",
            "手工数值不满足约束：" + group.name,
            domain.accepted.map((r) => r.id),
          );
        if (
          !Number.isSafeInteger(minIndex) ||
          !Number.isSafeInteger(maxIndex)
        ) {
          issue(
            issues,
            "unsafe-step-domain",
            "离散域超出安全整数索引：" + group.name,
          );
          continue;
        }
        const index = Math.max(
            minIndex,
            Math.min(
              maxIndex,
              Math.round((baseNumeric[group.id] - origin) / step),
            ),
          ),
          value = origin + index * step;
        numbers[group.id] = value === 0 ? 0 : value;
        steps[group.id] = { index, origin, step };
        if (numbers[group.id] !== baseNumeric[group.id])
          issue(
            issues,
            "numeric-normalization",
            "数值按有效范围和步长调整：" +
              group.name +
              " → " +
              numbers[group.id],
            domain.accepted.map((r) => r.id),
            [],
            "warning",
          );
      } else {
        const counts = active
          .filter((r) => r.then.groupId === group.id && r.type === "count")
          .filter((rule) => {
            const hard = group.options.filter((o) => {
              const v = votes.get(key(group.id, o.id))!;
              return v.value && v.priority > rule.priority;
            }).length;
            if (hard > rule.maximum) {
              shadow(
                [rule.id],
                group.options.flatMap((o) => {
                  const v = votes.get(key(group.id, o.id))!;
                  return v.value && v.priority > rule.priority ? v.ruleIds : [];
                }),
                "数量上限被更高优先级必选项覆盖",
              );
              return false;
            }
            const possible = group.options.filter((o) => {
              const v = votes.get(key(group.id, o.id))!;
              return v.value || v.priority < rule.priority;
            }).length;
            if (possible < rule.minimum) {
              const stronger = group.options.filter((o) => {
                const v = votes.get(key(group.id, o.id))!;
                return !v.value && v.priority > rule.priority;
              });
              if (group.options.length - stronger.length < rule.minimum) {
                shadow(
                  [rule.id],
                  stronger.flatMap(
                    (o) => votes.get(key(group.id, o.id))!.ruleIds,
                  ),
                  "数量下限被更高优先级排除项覆盖",
                );
                return false;
              }
              issue(
                issues,
                "count-conflict",
                "数量下限与同优先级排除冲突：" + rule.id,
                [rule.id],
              );
            }
            return true;
          });
        const domain = bounds(counts, group.min, group.max),
          fill = domain.accepted.find((r) => r.minimum >= domain.low),
          sortOptions = () =>
            group.options
              .filter((o) => votes.get(key(group.id, o.id))!.value)
              .sort((a, b) => {
                const x = votes.get(key(group.id, a.id))!,
                  y = votes.get(key(group.id, b.id))!;
                return (
                  y.priority - x.priority ||
                  Number(y.manual) - Number(x.manual) ||
                  (base[group.id].indexOf(a.id) < 0
                    ? Infinity
                    : base[group.id].indexOf(a.id)) -
                    (base[group.id].indexOf(b.id) < 0
                      ? Infinity
                      : base[group.id].indexOf(b.id)) ||
                  group.options.indexOf(a) - group.options.indexOf(b)
                );
              });
        if (fill)
          for (const option of group.options)
            if (sortOptions().length < domain.low) {
              const old = votes.get(key(group.id, option.id))!;
              if (!old.value && old.priority < fill.priority)
                vote(group.id, option.id, true, fill);
            }
        const ordered = sortOptions(),
          kept = ordered.slice(0, domain.high),
          dropped = ordered.slice(domain.high),
          threshold = kept.length
            ? votes.get(key(group.id, kept[kept.length - 1].id))!.priority
            : -Infinity;
        for (const option of dropped) {
          const v = votes.get(key(group.id, option.id))!;
          if (Number.isFinite(v.priority)) {
            if (
              v.priority === threshold ||
              domain.maxRule?.priority === v.priority
            )
              issue(
                issues,
                "cardinality-conflict",
                "同优先级必选项超过数量上限：" + group.name,
                [
                  ...new Set([
                    ...v.ruleIds,
                    ...kept.flatMap(
                      (o) => votes.get(key(group.id, o.id))!.ruleIds,
                    ),
                    ...(domain.maxRule ? [domain.maxRule.id] : []),
                  ]),
                ],
              );
            else
              shadow(
                v.ruleIds,
                domain.maxRule
                  ? [domain.maxRule.id]
                  : kept.flatMap(
                      (o) => votes.get(key(group.id, o.id))!.ruleIds,
                    ),
                "较低优先级必选项受数量上限覆盖",
              );
          }
        }
        next[group.id] = kept.map((o) => o.id);
        if (next[group.id].length < domain.low)
          issue(
            issues,
            "cardinality",
            "选项数量不足：" + group.name,
            domain.accepted.map((r) => r.id),
          );
        const intent = context.intent;
        if (
          intent?.groupId === group.id &&
          intent.optionId &&
          next[group.id].includes(intent.optionId) !== (intent.selected ?? true)
        ) {
          const cause = votes.get(key(group.id, intent.optionId));
          issue(
            issues,
            "manual-choice-conflict",
            "手工选择与业务约束冲突：" +
              (cause?.ruleIds
                .map((id) => ir.rules.find((r) => r.id === id)?.reason || id)
                .join(" → ") || group.name),
            cause?.ruleIds,
            [key(group.id, intent.optionId)],
          );
        }
      }
    }
    const nextSignature = stableSignature(catalog, next, numbers);
    finalIssues = issues;
    numericSteps = steps;
    if (nextSignature === signature) {
      selections = next;
      numericValues = numbers;
      converged = true;
      break;
    }
    for (const rule of active)
      if (
        JSON.stringify(next[rule.then.groupId]) !==
          JSON.stringify(selections[rule.then.groupId]) ||
        numbers[rule.then.groupId] !== numericValues[rule.then.groupId]
      )
        changes.push({
          groupId: rule.then.groupId,
          optionId: rule.then.optionId || String(numbers[rule.then.groupId]),
          ruleId: rule.id,
          reason: rule.reason,
          operation: rule.type,
        });
    selections = next;
    numericValues = numbers;
  }
  if (!converged && !finalIssues.some((d) => d.severity === "error"))
    issue(finalIssues, "iteration-budget", "配置求解超过确定性迭代预算");
  for (const group of catalog.groups)
    if (
      group.control !== "number" &&
      (selections[group.id].length < group.min ||
        selections[group.id].length > group.max)
    )
      issue(finalIssues, "cardinality", group.name + " 选项数量不满足要求");
  const diagnostics = [...baseIssues, ...finalIssues].filter(
    (d, index, all) =>
      all.findIndex(
        (other) => other.code === d.code && other.message === d.message,
      ) === index,
  );
  return {
    selections,
    numericValues,
    numericSteps,
    changes,
    errors: diagnostics
      .filter((d) => d.severity === "error")
      .map((d) => d.message),
    diagnostics,
  };
}
