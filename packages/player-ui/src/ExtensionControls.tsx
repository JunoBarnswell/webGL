import { useState } from "react";
import {
  actionDefinitions,
  createAction,
  fieldDefaults,
  type JsonValue,
  type SceneDocument,
} from "@studio/scene-schema";
import type { SceneRuntime } from "@studio/scene-runtime";
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
    [error, setError] = useState("");
  const controls = document.entities.flatMap((entity) =>
    actionDefinitions
      .filter(
        (def) =>
          def.type.includes(".") &&
          def.target === "entity" &&
          entity.components.some(
            (c) => c.enabled && def.components.includes(c.type),
          ),
      )
      .map((def) => ({ entity, def, key: entity.id + ":" + def.type })),
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
      {controls.map(({ entity, def, key }) => {
        const data = values[key] ?? fieldDefaults(def.fields);
        return (
          <fieldset key={key}>
            <legend>
              {entity.name} · {def.title}
            </legend>
            {Object.entries(def.fields).map(([name, field]) => (
              <label key={name}>
                {field.title ?? name}
                {field.type === "boolean" ? (
                  <input
                    type="checkbox"
                    checked={Boolean(data[name])}
                    onChange={(e) =>
                      setValues({
                        ...values,
                        [key]: { ...data, [name]: e.target.checked },
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
                    value={String(data[name])}
                    onChange={(e) => {
                      const next = {
                        ...data,
                        [name]:
                          field.type === "number"
                            ? Number(e.target.value)
                            : e.target.value,
                      };
                      setValues({ ...values, [key]: next });
                      if (field.type === "number")
                        run(def.type, entity.id, next);
                    }}
                  />
                )}
              </label>
            ))}
            <button onClick={() => run(def.type, entity.id, data)}>
              {def.title}
            </button>
          </fieldset>
        );
      })}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
