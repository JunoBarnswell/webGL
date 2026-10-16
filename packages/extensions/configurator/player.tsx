import { useMemo, useState } from "react";
import { createAction, getComponent } from "../../scene-schema/src/index";
import { RuntimeAssetImage } from "../../player-ui/src/RuntimeAssetImage";
import type { PlayerWidget, PlayerWidgetProps } from "../player-contract";
import {
  resolveConfiguration,
  defaultConfiguration,
  optionAvailability,
  configurationOptionKey,
  formatNumericValue,
  type ProductCatalog,
  type ConfigurationResult,
} from "./core";
function ConfiguratorWidget({
  document,
  runtime,
  state,
  node,
  design,
}: PlayerWidgetProps) {
  const entity =
    document.entities.find(
      (e) =>
        e.id === node?.targetId &&
        getComponent(e, "studio.configurator.Catalog"),
    ) ??
    document.entities.find((e) =>
      getComponent(e, "studio.configurator.Catalog"),
    );
  const catalog = entity
      ? (getComponent(entity, "studio.configurator.Catalog")!
          .data as unknown as ProductCatalog)
      : null,
    [error, setError] = useState("");
  const current = entity
      ? state.extensions["studio.configurator:" + entity.id]
      : undefined,
    committed =
      (current?.result as unknown as ConfigurationResult) ??
      (catalog
        ? resolveConfiguration(catalog, defaultConfiguration(catalog))
        : null),
    result =
      (current?.pending
        ? (current.requestedResult as unknown as ConfigurationResult)
        : committed) ?? committed,
    reasons = useMemo(
      () =>
        catalog && result
          ? optionAvailability(catalog, result.selections, result.numericValues)
          : {},
      [catalog, result],
    );
  if (!catalog || !entity || !result) return null;
  const run = (type: string, groupId = "", optionId = "", value = 0) => {
    if (!runtime) return;
    const a = createAction("studio.configurator." + type);
    a.targetId = entity.id;
    if (type === "SetNumber") Object.assign(a.data, { groupId, value });
    else Object.assign(a.data, { groupId, optionId });
    if (type === "Reset") a.data = {};
    void runtime
      .dispatch(a)
      .then(() => setError(""))
      .catch((error) => setError(String(error)));
  };
  return (
    <section className="customer-configurator" aria-label={catalog.name}>
      <h3>{catalog.name}</h3>
      {catalog.groups.map((group) => (
        <fieldset key={group.id}>
          <legend>{group.name}</legend>
          {group.control === "number" ? (
            <label>
              {group.name}
              <input
                type="number"
                min={group.numericMinimum ?? 0}
                max={group.numericMaximum ?? 1}
                step={group.numericStep ?? 0.01}
                key={group.id + ":" + result.numericValues[group.id]}
                defaultValue={formatNumericValue(
                  group,
                  result.numericValues[group.id] ?? 0,
                )}
                disabled={design}
                onBlur={(event) => {
                  const value = event.currentTarget.valueAsNumber;
                  if (Number.isFinite(value))
                    run("SetNumber", group.id, "", value);
                  else {
                    event.currentTarget.value = formatNumericValue(
                      group,
                      result.numericValues[group.id] ?? 0,
                    );
                    setError("请输入有限数值");
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing)
                    event.currentTarget.blur();
                }}
              />
            </label>
          ) : group.control === "toggle" ? (
            <label>
              <input
                type="checkbox"
                checked={Boolean(result.selections[group.id]?.length)}
                disabled={
                  design ||
                  Boolean(
                    reasons[
                      configurationOptionKey(group.id, group.options[0]?.id)
                    ],
                  )
                }
                onChange={() =>
                  run("Select", group.id, group.options[0]?.id ?? "")
                }
              />
              {group.options[0]?.name ?? group.name}
            </label>
          ) : (
            <div className={"product-options " + group.control}>
              {group.options.map((option) => {
                const selected = result.selections[group.id]?.includes(
                    option.id,
                  ),
                  reason = reasons[configurationOptionKey(group.id, option.id)];
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={selected}
                    aria-label={
                      option.name + (reason ? "，不可选：" + reason : "")
                    }
                    disabled={design || Boolean(reason)}
                    title={reason || option.description}
                    onClick={() => run("Select", group.id, option.id)}
                    className={selected ? "selected" : ""}
                  >
                    {group.control === "swatch" && (
                      <span
                        className="product-swatch"
                        style={{ background: option.color }}
                      />
                    )}
                    {option.imageAssetId && (
                      <RuntimeAssetImage
                        runtime={runtime}
                        id={option.imageAssetId}
                        alt={option.name}
                      />
                    )}
                    <strong>{option.name}</strong>
                    {reason && (
                      <small>
                        {reason}。兼容替代：
                        {group.options
                          .filter(
                            (o) =>
                              !reasons[configurationOptionKey(group.id, o.id)],
                          )
                          .slice(0, 3)
                          .map((o) => o.name)
                          .join("、") || "请先调整关联选项"}
                      </small>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </fieldset>
      ))}
      {result.changes.length > 0 && (
        <details open>
          <summary>自动调整 {result.changes.length} 项</summary>
          {result.changes.map((change, index) => (
            <p key={index}>
              {change.optionId} · {change.reason}
            </p>
          ))}
        </details>
      )}
      <details>
        <summary>BOM / SKU 配置清单</summary>
        {committed!.bom.map((part) => (
          <p key={part.partId}>
            {part.partId} × {part.quantity}
            <small>
              {" "}
              ·{" "}
              {part.sources
                .map(
                  (source) =>
                    catalog.groups
                      .find((g) => g.id === source.groupId)
                      ?.options.find((o) => o.id === source.optionId)?.name ??
                    source.optionId,
                )
                .join(" / ")}
            </small>
          </p>
        ))}
        <p>SKU {committed!.skus.join(" / ") || "未指定"}</p>
        <p>价格：需询价</p>
        <small>目录版本 {result.schemaRevision}</small>
      </details>
      <button disabled={design} onClick={() => run("Reset")}>
        恢复默认配置
      </button>
      {Boolean(current?.pending) && (
        <p role="status">
          正在准备视觉资产；清单显示上一有效配置。
          <button disabled={design} onClick={() => run("Cancel")}>
            取消准备
          </button>
        </p>
      )}
      {(error || current?.error) && (
        <p role="alert">{error || String(current?.error)}</p>
      )}
    </section>
  );
}
export const widgets: PlayerWidget[] = [
  {
    kind: "configurator",
    title: "产品配置器",
    componentType: "studio.configurator.Catalog",
    Component: ConfiguratorWidget,
  },
];
