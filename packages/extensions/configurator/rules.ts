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
    if (new Set(group.options.map((o) => o.id)).size !== group.options.length)
      diagnostics.push(
        diagnostic("duplicate-option", "选项 ID 重复：" + group.name),
      );
    if (group.min > group.max || group.min < 0 || group.max < 1)
      diagnostics.push(
        diagnostic("cardinality", "选项数量范围无效：" + group.name),
      );
    for (const id of group.defaultIds)
      if (!group.options.some((o) => o.id === id))
        diagnostics.push(
          diagnostic("missing-default", "默认选项不存在：" + id),
        );
    if (group.control === "number") {
      const low = group.numericMinimum ?? 0,
        high = group.numericMaximum ?? 1,
        step = group.numericStep ?? 0.01;
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
    (a, b) => b.priority - a.priority || a.id.localeCompare(b.id),
  );
  for (const rule of rules) {
    const source = groups.get(rule.when.groupId),
      target = groups.get(rule.then.groupId);
    if (
      !target ||
      (!["count", "range"].includes(rule.type) &&
        !target.options.some((o) => o.id === rule.then.optionId)) ||
      (rule.when.groupId &&
        (!source || !source.options.some((o) => o.id === rule.when.optionId)))
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
    for (const c of rule.conditions ?? []) {
      const g = groups.get(c.groupId);
      if (
        !g ||
        (["selected", "notSelected"].includes(c.operator)
          ? !g.options.some((o) => o.id === c.optionId)
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
  "selections" | "numericValues" | "changes" | "errors"
> & { diagnostics: RuleDiagnostic[] };
interface Vote {
  value: boolean;
  priority: number;
  ruleIds: string[];
  manual: boolean;
}
/** Stable-model evaluation: every pass rebuilds consequences, so withdrawn conditions retract outputs. */
export function resolveRuleIR(
  catalog: ProductCatalog,
  input: Record<string, string[]>,
  numericInput: Record<string, number>,
  context: RuleContext = {},
): Resolution {
  const ir = context.compiled ?? compileRuleGraph(catalog);
  if (ir.catalog !== catalog) throw Error("规则索引与目录修订不匹配");
  const diagnostics = ir.diagnostics
      .filter((d) => d.code !== "unreachable-option")
      .slice(),
    errors = diagnostics.map((d) => d.message),
    changes: ConfigurationResult["changes"] = [],
    base: Record<string, string[]> = {},
    baseNumeric: Record<string, number> = {};
  for (const group of catalog.groups) {
    base[group.id] = [...new Set(input[group.id] ?? group.defaultIds)];
    if (base[group.id].some((id) => !group.options.some((o) => o.id === id)))
      errors.push("未知选项：" + group.name);
    if (group.control === "number") {
      baseNumeric[group.id] =
        numericInput[group.id] ??
        group.numericDefault ??
        group.numericMinimum ??
        0;
      if (!Number.isFinite(baseNumeric[group.id]))
        errors.push("数值必须有限：" + group.name);
      else if (
        baseNumeric[group.id] < (group.numericMinimum ?? 0) ||
        baseNumeric[group.id] > (group.numericMaximum ?? 1)
      )
        errors.push("数值越界：" + group.name);
    }
  }
  for (const group of Object.keys(input))
    if (!catalog.groups.some((g) => g.id === group))
      errors.push("未知配置属性：" + group);
  let selections = structuredClone(base),
    numericValues = { ...baseNumeric };
  const seen = new Set<string>();
  let converged = false;
  const addIssue = (
    code: string,
    message: string,
    ruleIds: string[] = [],
    optionKeys: string[] = [],
  ) => {
    errors.push(message);
    diagnostics.push(diagnostic(code, message, ruleIds, optionKeys));
  };
  for (
    let pass = 0;
    pass <
    Math.min(
      1024,
      Math.max(32, ir.rules.length * 4 + catalog.groups.length * 2),
    );
    pass++
  ) {
    const signature = JSON.stringify([selections, numericValues]);
    if (seen.has(signature)) {
      addIssue(
        "negative-cycle",
        "规则条件形成无法收敛的冲突路径",
        ir.rules
          .filter((r) => ruleConditionMatches(r, selections, numericValues))
          .map((r) => r.id),
      );
      break;
    }
    seen.add(signature);
    const active = ir.rules.filter((r) =>
        ruleConditionMatches(r, selections, numericValues),
      ),
      votes = new Map<string, Vote>(),
      next: Record<string, string[]> = {},
      numbers = { ...baseNumeric },
      shadowed = new Set<string>();
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
        shadowed.add(rule.id);
        diagnostics.push({
          code: "shadowed-rule",
          severity: "warning",
          message:
            "规则 " +
            rule.id +
            " 被更高优先级规则覆盖：" +
            old.ruleIds.join(" → "),
          ruleIds: [...old.ruleIds, rule.id],
          optionKeys: [id],
        });
        return;
      }
      if (old.priority === rule.priority && old.value !== value) {
        addIssue(
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
        ruleIds: [rule.id],
        manual: old.manual,
      });
      const group = catalog.groups.find((g) => g.id === groupId)!;
      if (value && group.max === 1)
        for (const option of group.options)
          if (option.id !== optionId) {
            const other = votes.get(key(groupId, option.id))!;
            if (other.value && other.priority === rule.priority) {
              addIssue(
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
      const group = catalog.groups.find((g) => g.id === rule.then.groupId);
      if (!group) continue;
      if (["require", "implies", "bundle"].includes(rule.type))
        vote(group.id, rule.then.optionId, true, rule);
      else if (rule.type === "exclude")
        vote(group.id, rule.then.optionId, false, rule);
      else if (rule.type === "range" && group.control !== "number")
        for (const option of group.options) {
          const number = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(
            option.name.trim(),
          )
            ? Number(option.name)
            : NaN;
          if (
            !Number.isFinite(number) ||
            number < rule.minimum ||
            number > rule.maximum
          )
            vote(group.id, option.id, false, rule);
        }
    }
    for (const rule of active.filter((r) => r.type === "default")) {
      const group = catalog.groups.find((g) => g.id === rule.then.groupId);
      if (
        group &&
        !base[group.id]?.length &&
        !group.options.some(
          (option) => votes.get(key(group.id, option.id))?.value,
        ) &&
        votes.get(key(group.id, rule.then.optionId))?.priority === -Infinity
      )
        vote(group.id, rule.then.optionId, true, rule);
    }
    for (const group of catalog.groups) {
      if (group.control === "number") {
        let low = group.numericMinimum ?? 0,
          high = group.numericMaximum ?? 1;
        for (const rule of active.filter(
          (r) => r.then.groupId === group.id && r.type === "range",
        )) {
          const min = Math.max(low, rule.minimum),
            max = Math.min(high, rule.maximum);
          if (min > max) {
            addIssue("numeric-conflict", rule.reason || "数值约束没有交集", [
              rule.id,
            ]);
            continue;
          }
          low = min;
          high = max;
        }
        const step = group.numericStep ?? 0.01,
          origin = group.numericMinimum ?? 0,
          minIndex = Math.ceil((low - origin) / step - 1e-9),
          maxIndex = Math.floor((high - origin) / step + 1e-9);
        if (minIndex > maxIndex) {
          addIssue(
            "empty-step-domain",
            "范围内没有符合步长的数值：" + group.name,
          );
          continue;
        }
        if (
          context.intent?.groupId === group.id &&
          (baseNumeric[group.id] < low || baseNumeric[group.id] > high)
        )
          addIssue(
            "manual-numeric-conflict",
            "手工数值不满足约束：" + group.name,
            active.filter((r) => r.then.groupId === group.id).map((r) => r.id),
          );
        numbers[group.id] = Number(
          (
            origin +
            Math.max(
              minIndex,
              Math.min(
                maxIndex,
                Math.round((baseNumeric[group.id] - origin) / step),
              ),
            ) *
              step
          ).toPrecision(14),
        );
        next[group.id] = [];
      } else {
        const selected = group.options
          .filter((o) => votes.get(key(group.id, o.id))?.value)
          .sort(
            (a, b) =>
              votes.get(key(group.id, b.id))!.priority -
                votes.get(key(group.id, a.id))!.priority ||
              group.options.indexOf(a) - group.options.indexOf(b),
          );
        let ids = selected.map((o) => o.id);
        if (ids.length > group.max) ids = ids.slice(0, group.max);
        for (const rule of active.filter(
          (r) => r.then.groupId === group.id && r.type === "count",
        )) {
          if (ids.length > rule.maximum) ids = ids.slice(0, rule.maximum);
          for (const option of group.options)
            if (
              ids.length < rule.minimum &&
              !ids.includes(option.id) &&
              !(
                votes.get(key(group.id, option.id))!.value === false &&
                votes.get(key(group.id, option.id))!.priority >= rule.priority
              )
            )
              ids.push(option.id);
        }
        next[group.id] = ids;
        const intent = context.intent;
        if (
          intent?.groupId === group.id &&
          intent.optionId &&
          !ids.includes(intent.optionId)
        ) {
          const cause = votes.get(key(group.id, intent.optionId));
          addIssue(
            "manual-choice-conflict",
            "该选择被规则排除：" +
              (cause?.ruleIds
                .map((id) => ir.rules.find((r) => r.id === id)?.reason || id)
                .join(" → ") || group.name),
            cause?.ruleIds,
            [key(group.id, intent.optionId)],
          );
        }
      }
    }
    if (JSON.stringify([next, numbers]) === signature) {
      selections = next;
      numericValues = numbers;
      converged = true;
      break;
    }
    for (const rule of active)
      if (!shadowed.has(rule.id)) {
        const group = rule.then.groupId;
        if (
          JSON.stringify(next[group]) !== JSON.stringify(selections[group]) ||
          numbers[group] !== numericValues[group]
        )
          changes.push({
            groupId: group,
            optionId: rule.then.optionId || String(numbers[group]),
            ruleId: rule.id,
            reason: rule.reason,
            operation: rule.type,
          });
      }
    selections = next;
    numericValues = numbers;
  }
  if (!converged && !errors.length)
    addIssue("iteration-budget", "配置求解超过确定性迭代预算");
  for (const group of catalog.groups)
    if (
      group.control !== "number" &&
      (selections[group.id].length < group.min ||
        selections[group.id].length > group.max)
    )
      addIssue("cardinality", group.name + " 选项数量不满足要求");
  return {
    selections,
    numericValues,
    changes,
    errors: [...new Set(errors)],
    diagnostics: diagnostics.filter(
      (d, index, all) =>
        all.findIndex(
          (other) => other.code === d.code && other.message === d.message,
        ) === index,
    ),
  };
}
