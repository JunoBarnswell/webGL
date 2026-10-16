import { useEffect, useMemo, useRef, useState } from "react";
import type { ExtensionPanelProps } from "../editor-contract";
import {
  compileRuleGraph,
  type ConfigRule,
  type ProductCatalog,
  type ConfigurationResult,
} from "./core";
import type { CoverageReport } from "./coverage";
type Mutate = (
  label: string,
  change: (catalog: ProductCatalog) => void,
) => void;
export function RuleDesigner({
  catalog,
  mutate,
}: {
  catalog: ProductCatalog;
  mutate: Mutate;
}) {
  const ir = useMemo(() => compileRuleGraph(catalog), [catalog]),
    [chosen, setChosen] = useState("");
  const rule = catalog.rules.find((r) => r.id === chosen) ?? catalog.rules[0];
  const update = (change: (rule: ConfigRule) => void) =>
    rule &&
    mutate("编辑配置规则", (draft) =>
      change(draft.rules.find((r) => r.id === rule.id)!),
    );
  const selector = (
    value: { groupId: string; optionId: string },
    change: (value: { groupId: string; optionId: string }) => void,
    unconditional = false,
  ) => (
    <>
      <select
        aria-label="规则属性"
        value={value.groupId}
        onChange={(event) => {
          const group = catalog.groups.find((g) => g.id === event.target.value);
          change({
            groupId: group?.id ?? "",
            optionId: group?.options[0]?.id ?? "",
          });
        }}
      >
        {unconditional && <option value="">始终</option>}
        {catalog.groups
          .filter((g) => !unconditional || g.control !== "number")
          .map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
      </select>
      {value.groupId && (
        <select
          aria-label="规则选项"
          value={value.optionId}
          onChange={(event) =>
            change({ ...value, optionId: event.target.value })
          }
        >
          <option value="">无指定选项</option>
          {catalog.groups
            .find((g) => g.id === value.groupId)
            ?.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
        </select>
      )}
    </>
  );
  const nodes = ir.nodes.filter((n) => n.selected),
    positions = new Map(
      nodes.map((n, index) => [
        n.key,
        { x: 35 + (index % 3) * 220, y: 32 + Math.floor(index / 3) * 64 },
      ]),
    );
  return (
    <section aria-label="规则设计器">
      <div className="designer-toolbar">
        <button
          onClick={() =>
            mutate("新增兼容规则", (draft) => {
              const group = draft.groups[0];
              const id = crypto.randomUUID();
              draft.rules.push({
                id,
                type: "require",
                when: { groupId: "", optionId: "" },
                then: {
                  groupId: group?.id ?? "",
                  optionId: group?.options[0]?.id ?? "",
                },
                minimum: 0,
                maximum: 1,
                priority: 0,
                reason: "",
                conditions: [],
                conditionJoin: "all",
              });
              setChosen(id);
            })
          }
        >
          新增规则
        </button>
        <select
          aria-label="当前规则"
          value={rule?.id ?? ""}
          onChange={(event) => setChosen(event.target.value)}
        >
          {catalog.rules.map((r) => (
            <option key={r.id} value={r.id}>
              {r.reason || r.type + " · " + r.id.slice(0, 8)}
            </option>
          ))}
        </select>
        {rule && (
          <button
            onClick={() =>
              mutate("删除规则", (draft) => {
                draft.rules = draft.rules.filter((r) => r.id !== rule.id);
              })
            }
          >
            删除规则
          </button>
        )}
      </div>
      {rule && (
        <fieldset>
          <legend>规则条件与结果</legend>
          <label>
            主条件{" "}
            {selector(
              rule.when,
              (when) =>
                update((r) => {
                  r.when = when;
                }),
              true,
            )}
          </label>
          <label>
            附加条件
            <select
              value={rule.conditionJoin ?? "all"}
              onChange={(event) =>
                update((r) => {
                  r.conditionJoin = event.target.value as "all" | "any";
                })
              }
            >
              <option value="all">全部满足</option>
              <option value="any">任意满足</option>
            </select>
          </label>
          {rule.conditions?.map((condition, index) => (
            <div key={index}>
              {selector(condition, (value) =>
                update((r) => {
                  Object.assign(r.conditions![index], value);
                }),
              )}
              <select
                aria-label="条件运算"
                value={condition.operator}
                onChange={(event) =>
                  update((r) => {
                    r.conditions![index].operator = event.target
                      .value as typeof condition.operator;
                  })
                }
              >
                {(catalog.groups.find((g) => g.id === condition.groupId)
                  ?.control === "number"
                  ? ["gte", "lte", "eq"]
                  : ["selected", "notSelected"]
                ).map((operator) => (
                  <option key={operator}>{operator}</option>
                ))}
              </select>
              {["gte", "lte", "eq"].includes(condition.operator) && (
                <input
                  aria-label="条件数值"
                  type="number"
                  value={condition.value}
                  onChange={(event) => {
                    const value = event.target.valueAsNumber;
                    if (Number.isFinite(value))
                      update((r) => {
                        r.conditions![index].value = value;
                      });
                  }}
                />
              )}
              <button
                onClick={() =>
                  update((r) => {
                    r.conditions!.splice(index, 1);
                  })
                }
              >
                移除条件
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              update((r) => {
                const group = catalog.groups[0];
                (r.conditions ??= []).push({
                  groupId: group?.id ?? "",
                  optionId: group?.options[0]?.id ?? "",
                  operator: group?.control === "number" ? "gte" : "selected",
                  value: 0,
                });
              })
            }
          >
            添加条件
          </button>
          <label>
            结果
            <select
              value={rule.type}
              onChange={(event) =>
                update((r) => {
                  r.type = event.target.value;
                })
              }
            >
              {["require", "exclude", "count", "range"].map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
            {selector(rule.then, (then) =>
              update((r) => {
                r.then = then;
              }),
            )}
          </label>
          {["count", "range"].includes(rule.type) && (
            <label>
              区间
              <input
                aria-label="规则下界"
                type="number"
                value={rule.minimum}
                onChange={(event) => {
                  const value = event.target.valueAsNumber;
                  if (Number.isFinite(value))
                    update((r) => {
                      r.minimum = value;
                    });
                }}
              />
              <input
                aria-label="规则上界"
                type="number"
                value={rule.maximum}
                onChange={(event) => {
                  const value = event.target.valueAsNumber;
                  if (Number.isFinite(value))
                    update((r) => {
                      r.maximum = value;
                    });
                }}
              />
            </label>
          )}
          <label>
            优先级
            <input
              type="number"
              value={rule.priority}
              onChange={(event) => {
                const value = event.target.valueAsNumber;
                if (Number.isFinite(value))
                  update((r) => {
                    r.priority = value;
                  });
              }}
            />
          </label>
          <label>
            调整原因
            <input
              value={rule.reason}
              onChange={(event) =>
                update((r) => {
                  r.reason = event.target.value;
                })
              }
            />
          </label>
        </fieldset>
      )}
      <details open>
        <summary>
          依赖关系 · {ir.nodes.length} 状态 / {ir.edges.length} 边
        </summary>
        <div style={{ overflow: "auto", maxHeight: 400 }}>
          <svg
            role="img"
            aria-label="规则依赖图"
            viewBox={`0 0 690 ${Math.max(96, Math.ceil(nodes.length / 3) * 64)}`}
            style={{ minWidth: 660 }}
          >
            {ir.edges.map((edge, index) => {
              const a = positions.get(edge.from),
                signed = JSON.parse(edge.to) as [string, string, boolean],
                b = positions.get(JSON.stringify([signed[0], signed[1], true]));
              return a && b ? (
                <path
                  key={index}
                  d={`M ${a.x + 90} ${a.y} Q ${(a.x + b.x) / 2 + 90} ${Math.min(a.y, b.y) - 24} ${b.x + 90} ${b.y}`}
                  fill="none"
                  stroke={
                    edge.ruleId === rule?.id
                      ? "#f4c36d"
                      : signed[2]
                        ? "#80b4ed"
                        : "#d87272"
                  }
                  strokeWidth={edge.ruleId === rule?.id ? 3 : 1}
                >
                  <title>
                    {edge.ruleId} · 优先级 {edge.priority}
                  </title>
                </path>
              ) : null;
            })}
            {nodes.map((node) => {
              const point = positions.get(node.key)!,
                group = catalog.groups.find((g) => g.id === node.groupId);
              return (
                <g
                  key={node.key}
                  transform={`translate(${point.x},${point.y})`}
                >
                  <rect width="180" height="28" y="-14" rx="5" fill="#253449" />
                  <text x="8" y="4" fill="#e0e8f4" fontSize="11">
                    {group?.name} /{" "}
                    {group?.options.find((o) => o.id === node.optionId)?.name}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <p>
          图中的边来自同一规则
          IR。数值及附加条件在规则中单独显示；含条件的可达性结论受该上下文约束。
        </p>
      </details>
      {ir.diagnostics.map((diagnostic, index) => (
        <p
          key={index}
          role={diagnostic.severity === "error" ? "alert" : undefined}
        >
          {diagnostic.message}{" "}
          {diagnostic.ruleIds.map((id) => (
            <button key={id} onClick={() => setChosen(id)}>
              定位 {id.slice(0, 8)}
            </button>
          ))}
        </p>
      ))}
    </section>
  );
}
export function ConfigurationAnalysis({
  catalog,
  entityId,
  props,
}: {
  catalog: ProductCatalog;
  entityId: string;
  props: ExtensionPanelProps;
}) {
  const [report, setReport] = useState<CoverageReport | null>(null),
    [status, setStatus] = useState(""),
    [pending, setPending] = useState(false),
    active = useRef<AbortController | null>(null);
  useEffect(() => {
    setReport(null);
    setPending(false);
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [catalog]);
  const run = async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setStatus("正在分析");
    try {
      const result = await props.services.analyze(
        "configurationCoverage",
        {
          catalog,
          options: { randomCases: 1000, maxCases: 20000, seed: 20260323 },
        },
        {
          signal: controller.signal,
          onProgress: (_, completed, total) =>
            setStatus(`${completed} / ${total}`),
        },
      );
      if (active.current === controller) {
        setReport(result);
        setStatus("分析完成");
      }
    } catch (error) {
      if (active.current === controller)
        setStatus(controller.signal.aborted ? "已取消" : String(error));
    } finally {
      if (active.current === controller) setPending(false);
    }
  };
  const state = props.state.extensions["studio.configurator:" + entityId],
    result = state?.result as unknown as ConfigurationResult | undefined;
  return (
    <section aria-label="配置覆盖与结果">
      <button onClick={() => void run()} disabled={pending}>
        运行 1000 随机及组合覆盖
      </button>
      {pending && (
        <button onClick={() => active.current?.abort()}>取消分析</button>
      )}
      <span role="status">{status}</span>
      {report && (
        <>
          <p>
            样例 {report.attempted} · 合法 {report.valid} · 反例{" "}
            {report.invalid}。两两 {report.pairwise.covered}/
            {report.pairwise.target}；三元 {report.ternary.covered}/
            {report.ternary.target}。
          </p>
          <p>
            未覆盖两两 {report.pairwise.unresolved}，三元{" "}
            {report.ternary.unresolved}；
            {report.truncated ? "已达到分析预算" : "分析未截断"}。样例明细
            {report.detailsTruncated ? "已截断" : "完整"}。
          </p>
          <button
            onClick={() =>
              props.services.downloadJson("configuration-coverage.json", report)
            }
          >
            导出带目录快照的报告
          </button>
          <details>
            <summary>反例与调整原因</summary>
            {report.cases
              .filter((c) => !c.valid)
              .map((c) => (
                <details key={c.id}>
                  <summary>
                    {c.kind} #{c.id} · {c.errors.join("；")}
                  </summary>
                  <pre>{JSON.stringify(c, null, 2)}</pre>
                </details>
              ))}
          </details>
          <small>{report.limitations.join("\n")}</small>
        </>
      )}
      {result && (
        <>
          <h4>当前已应用配置</h4>
          <p>
            目录 {catalog.catalogId} / {result.schemaRevision}（
            {catalog.libraryVersionId ? "固定库修订" : "场景内嵌修订"}
            ），价格：需询价
          </p>
          <button
            onClick={() =>
              props.services.downloadJson("configuration-bom.json", {
                catalogId: catalog.catalogId,
                revision: result.schemaRevision,
                revisionKind: catalog.libraryVersionId ? "library" : "embedded",
                bom: result.bom,
                skuSources: result.skuSources,
                materialAssignments: state?.materialAssignments,
                priceStatus: "inquiry",
              })
            }
          >
            导出 BOM / SKU 与材质来源
          </button>
          <details>
            <summary>最终 primitive / material 表</summary>
            <pre>
              {JSON.stringify(state?.materialAssignments ?? [], null, 2)}
            </pre>
          </details>
        </>
      )}
    </section>
  );
}
