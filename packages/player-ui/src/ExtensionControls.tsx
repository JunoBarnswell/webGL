import { memo, useCallback, useMemo, useState } from "react";
import {
  actionDefinitions,
  componentDefinitions,
  createAction,
  fieldDefaults,
  fieldOptions,
  requiredExtension,
  type Entity,
  type JsonValue,
  type SceneDocument,
} from "@studio/scene-schema";
import type { SceneRuntime } from "@studio/scene-runtime";
const TargetSelect = memo(function TargetSelect({
  type,
  title,
  value,
  entities,
  onChange,
}: {
  type: string;
  title: string;
  value: string;
  entities: readonly Entity[];
  onChange: (type: string, id: string) => void;
}) {
  return (
    <select
      aria-label={title + " 目标"}
      value={value}
      onChange={(event) => onChange(type, event.target.value)}
    >
      {entities.map((entity) => (
        <option key={entity.id} value={entity.id}>
          {entity.name}
        </option>
      ))}
    </select>
  );
});
function display(value: JsonValue): string {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "value" in value
  )
    return String(value.value) + (value.unit ? " " + String(value.unit) : "");
  return value && typeof value === "object"
    ? JSON.stringify(value)
    : String(value);
}
export function ExtensionControls({
  runtime,
  document,
}: {
  runtime: SceneRuntime;
  document: SceneDocument;
}) {
  const [values, setValues] = useState<
      Record<string, Record<string, JsonValue>>
    >({}),
    [targets, setTargets] = useState<Record<string, string>>({}),
    [search, setSearch] = useState(""),
    [error, setError] = useState("");
  const setTarget = useCallback(
    (type: string, id: string) =>
      setTargets((previous) => ({ ...previous, [type]: id })),
    [],
  );
  const controls = useMemo(
    () =>
      actionDefinitions
        .filter((def) => def.type.includes(".") && def.target === "entity")
        .map((def) => ({
          def,
          entities: document.entities.filter((entity) =>
            entity.components.some(
              (c) => c.enabled && def.components.includes(c.type),
            ),
          ),
        }))
        .filter((control) => control.entities.length),
    [document],
  );
  const filtered = useMemo(
    () =>
      search.trim()
        ? controls.map((control) => ({
            ...control,
            entities: control.entities.filter((entity) =>
              (entity.name + " " + JSON.stringify(entity.components))
                .toLowerCase()
                .includes(search.toLowerCase()),
            ),
          }))
        : controls,
    [controls, search],
  );
  const optionsByType = useMemo(
    () =>
      Object.fromEntries(
        filtered
          .filter((control) => control.entities.length)
          .map(({ def, entities }) => {
            const entity =
              entities.find((e) => e.id === targets[def.type]) ?? entities[0];
            return [
              def.type,
              Object.fromEntries(
                Object.entries(def.fields).map(([name, spec]) => [
                  name,
                  fieldOptions(document, spec, entity.id),
                ]),
              ),
            ];
          }),
      ),
    [filtered, targets, document],
  );
  if (!controls.length) return null;
  const run = (type: string, id: string, data: Record<string, JsonValue>) => {
    const action = createAction(type);
    action.targetId = id;
    Object.assign(action.data, data);
    void runtime.dispatch(action).catch((error) => setError(String(error)));
  };
  return (
    <details className="extension-controls">
      <summary>模型操作</summary>
      <input
        aria-label="查询模型或管线"
        placeholder="零件号 / 管线号 / 属性"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {filtered.map(({ def, entities }) => {
        if (!entities.length) return null;
        const entity =
            entities.find((e) => e.id === targets[def.type]) ?? entities[0],
          key = entity.id + ":" + def.type,
          data = values[key] ?? fieldDefaults(def.fields),
          plugin = requiredExtension(def.type);
        const state =
          runtime.getSnapshot().extensions[
            (plugin?.id ?? "") + ":" + entity.id
          ] ?? {};
        const boundData = Object.fromEntries(
          Object.entries(def.fields).map(([name, field]) => [
            name,
            field["x-runtime-binding"] &&
            state[field["x-runtime-binding"]] !== undefined
              ? state[field["x-runtime-binding"]]
              : data[name],
          ]),
        );
        return (
          <fieldset key={def.type}>
            <legend>{def.title}</legend>
            <TargetSelect
              type={def.type}
              title={def.title}
              entities={entities}
              value={entity.id}
              onChange={setTarget}
            />
            <details>
              <summary>属性 · {entity.name}</summary>
              {entity.components
                .filter((c) => c.enabled && def.components.includes(c.type))
                .map((c) => (
                  <dl key={c.type}>
                    {Object.entries(c.data)
                      .filter(
                        ([field]) =>
                          componentDefinitions.find((d) => d.type === c.type)
                            ?.fields[field]?.["x-public"] !== false,
                      )
                      .map(([field, value]) => {
                        const spec = componentDefinitions.find(
                          (d) => d.type === c.type,
                        )?.fields[field];
                        return value &&
                          typeof value === "object" &&
                          !Array.isArray(value) ? (
                          Object.entries(value).map(([name, entry]) => (
                            <div key={field + "." + name}>
                              <dt>{name}</dt>
                              <dd>{display(entry)}</dd>
                            </div>
                          ))
                        ) : (
                          <div key={field}>
                            <dt>{spec?.title ?? field}</dt>
                            <dd>{display(value)}</dd>
                          </div>
                        );
                      })}
                  </dl>
                ))}
            </details>
            {Object.entries(def.fields).map(([name, field]) => {
              const value = boundData[name],
                options = optionsByType[def.type]?.[name];
              return (
                <label key={name}>
                  {field.title ?? name}
                  {options ? (
                    <select
                      aria-label={entity.name + " " + (field.title ?? name)}
                      value={String(value)}
                      onChange={(event) =>
                        setValues({
                          ...values,
                          [key]: { ...data, [name]: event.target.value },
                        })
                      }
                    >
                      <option value="">选择步骤…</option>
                      {options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : field.type === "boolean" ? (
                    <input
                      type="checkbox"
                      checked={Boolean(value)}
                      onChange={(event) =>
                        setValues({
                          ...values,
                          [key]: { ...data, [name]: event.target.checked },
                        })
                      }
                    />
                  ) : (
                    <input
                      aria-label={entity.name + " " + (field.title ?? name)}
                      type={field.type === "number" ? "range" : "text"}
                      min={field.minimum}
                      max={field.maximum}
                      step=".001"
                      value={String(value)}
                      onChange={(event) => {
                        const next = {
                          ...data,
                          [name]:
                            field.type === "number"
                              ? Number(event.target.value)
                              : event.target.value,
                        };
                        setValues({ ...values, [key]: next });
                        if (field.type === "number")
                          run(def.type, entity.id, next);
                      }}
                    />
                  )}
                </label>
              );
            })}
            <button onClick={() => run(def.type, entity.id, boundData)}>
              {def.title}
            </button>
          </fieldset>
        );
      })}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
