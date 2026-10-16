import { fieldOptions } from "@studio/scene-schema";
import { useStudio } from "../state/studio";
import type { DocumentPath } from "@studio/editor-core";
import type { Vec3 } from "@studio/scene-schema";
type SpatialEdit = (
  path: DocumentPath,
  value: Vec3,
  space: "world" | "local" | "parent-offset",
  targetField?: string,
) => void;
import { useEffect, useId, useState, useRef } from "react";
import {
  fieldActive,
  fieldDefaults,
  type FieldSchema,
  type JsonValue,
} from "@studio/scene-schema";
import { ReferencePicker } from "./ReferencePicker";
export function TextField({
  value,
  onChange,
  label,
  type = "text",
  step,
  minimum,
  maximum,
}: {
  value: string | number;
  onChange: (value: string) => void;
  label: string;
  type?: string;
  step?: number;
  minimum?: number;
  maximum?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  const cancelBlur = useRef(false);
  const id = useId();
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    if (cancelBlur.current) {
      cancelBlur.current = false;
      return;
    }
    if (
      type === "number" &&
      (!Number.isFinite(Number(draft)) ||
        (minimum !== undefined && Number(draft) < minimum) ||
        (maximum !== undefined && Number(draft) > maximum))
    ) {
      setDraft(String(value));
      return;
    }
    if (draft !== String(value)) onChange(draft);
  };
  return (
    <input
      id={id}
      aria-label={label}
      type={type}
      value={draft}
      step={step ?? "any"}
      min={minimum}
      max={maximum}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancelBlur.current = true;
          setDraft(String(value));
          event.currentTarget.blur();
        }
      }}
    />
  );
}
export function TextAreaField({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <textarea
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) onChange(draft);
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey))
          event.currentTarget.blur();
      }}
    />
  );
}
function JsonField({
  value,
  title,
  onChange,
}: {
  value: JsonValue;
  title: string;
  onChange: (value: JsonValue) => void;
}) {
  const [draft, setDraft] = useState(JSON.stringify(value ?? {}, null, 2)),
    [error, setError] = useState("");
  useEffect(() => setDraft(JSON.stringify(value ?? {}, null, 2)), [value]);
  return (
    <label className="field stacked">
      <span>{title}</span>
      <textarea
        aria-label={title}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          try {
            const parsed = JSON.parse(draft) as JsonValue;
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
              throw Error("需要 JSON 对象");
            onChange(parsed);
            setError("");
          } catch (error) {
            setError(String(error));
          }
        }}
      />
      {error && <span role="alert">{error}</span>}
    </label>
  );
}
export function Field({
  field,
  value,
  onChange,
  path,
  onSpatialEdit,
  options,
}: {
  field: FieldSchema;
  options?: { value: string; label: string }[];
  value: JsonValue;
  onChange: (value: JsonValue) => void;
  path: string;
  onSpatialEdit?: SpatialEdit;
}) {
  const title = field.title ?? path;
  if (options)
    return (
      <label className="field">
        <span>{title}</span>
        <select
          aria-label={title}
          value={String(value ?? "")}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">请选择…</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
          {value && !options.some((option) => option.value === value) && (
            <option value={String(value)}>缺失的选择</option>
          )}
        </select>
      </label>
    );
  if (field["x-editor"] === "json")
    return <JsonField value={value} title={title} onChange={onChange} />;
  if (field["x-reference"])
    return (
      <ReferencePicker
        kind={field["x-reference"]}
        value={String(value ?? "")}
        onChange={onChange}
        label={title}
        assetKind={field["x-asset-kind"] ?? ""}
      />
    );
  if (field.enum)
    return (
      <label className="field">
        <span>{title}</span>
        <select
          aria-label={title}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
        >
          {field.enum.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  if (field.type === "boolean")
    return (
      <label className="field check">
        <span>{title}</span>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
      </label>
    );
  if (field["x-editor"] === "color")
    return (
      <label className="field">
        <span>{title}</span>
        <div className="color-input">
          <input
            type="color"
            aria-label={title}
            value={String(value)}
            onChange={(event) => onChange(event.target.value)}
          />
          <TextField
            label={title + " 色值"}
            value={String(value)}
            onChange={onChange}
          />
        </div>
      </label>
    );
  if (field.type === "number" || field.type === "integer")
    return (
      <label className="field">
        <span>{title}</span>
        <TextField
          label={title}
          type="number"
          minimum={field.minimum}
          maximum={field.maximum}
          step={field.type === "integer" ? 1 : undefined}
          value={Number(value)}
          onChange={(text) => onChange(Number(text))}
        />
      </label>
    );
  if (field.type === "array") {
    const items = Array.isArray(value) ? value : [];
    const vector = field["x-editor"] === "vector";
    return (
      <div className={"array-field " + (vector ? "vector-field" : "")}>
        <div className="field-title">
          {title}
          {vector &&
            items.length === 3 &&
            field["x-coordinate"] &&
            onSpatialEdit && (
              <button
                type="button"
                onClick={() =>
                  onSpatialEdit(
                    [],
                    items as Vec3,
                    field["x-coordinate"]!,
                    field["x-coordinate-target"],
                  )
                }
              >
                视口编辑
              </button>
            )}
          {!vector && (
            <button
              type="button"
              onClick={() =>
                onChange([
                  ...items,
                  field.items?.properties
                    ? fieldDefaults(field.items.properties)
                    : (field.items?.default ?? ""),
                ])
              }
            >
              添加
            </button>
          )}
        </div>
        <div className={vector ? "vector-inputs" : ""}>
          {items.map((item, index) => (
            <div key={index} className={vector ? "axis" : "array-item"}>
              {vector ? (
                <>
                  <span>{["X", "Y", "Z", "W"][index] ?? index}</span>
                  <TextField
                    label={title + " " + index}
                    type="number"
                    value={Number(item)}
                    onChange={(text) =>
                      onChange(
                        items.map((current, i) =>
                          i === index ? Number(text) : current,
                        ),
                      )
                    }
                  />
                </>
              ) : (
                <>
                  <div className="array-item-actions">
                    <span>{index + 1}</span>
                    <button
                      aria-label={"上移 " + title + " " + index}
                      disabled={index === 0}
                      onClick={() => {
                        const next = [...items];
                        [next[index - 1], next[index]] = [
                          next[index],
                          next[index - 1],
                        ];
                        onChange(next);
                      }}
                    >
                      上移
                    </button>
                    <button
                      aria-label={"删除 " + title + " " + index}
                      onClick={() =>
                        onChange(items.filter((_v, i) => i !== index))
                      }
                    >
                      删除
                    </button>
                  </div>
                  <Field
                    field={field.items ?? { type: "string" }}
                    value={item}
                    path={path + "." + index}
                    onSpatialEdit={
                      onSpatialEdit
                        ? (nested, value, space, target) =>
                            onSpatialEdit(
                              [
                                item &&
                                typeof item === "object" &&
                                !Array.isArray(item) &&
                                typeof item.id === "string"
                                  ? { id: item.id }
                                  : index,
                                ...nested,
                              ],
                              value,
                              space,
                              target,
                            )
                        : undefined
                    }
                    onChange={(next) =>
                      onChange(
                        items.map((current, i) =>
                          i === index ? next : current,
                        ),
                      )
                    }
                  />
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (field.type === "object" || field.properties) {
    const object =
      value && !Array.isArray(value) && typeof value === "object" ? value : {};
    return (
      <div className="object-fields">
        {Object.entries(field.properties ?? {}).map(([key, child]) => (
          <Field
            key={key}
            field={child}
            value={object[key] ?? null}
            path={path + "." + key}
            onSpatialEdit={
              onSpatialEdit
                ? (nested, value, space, target) =>
                    onSpatialEdit([key, ...nested], value, space, target)
                : undefined
            }
            onChange={(next) => onChange({ ...object, [key]: next })}
          />
        ))}
      </div>
    );
  }
  if (field["x-editor"] === "textarea")
    return (
      <label className="field stacked">
        <span>{title}</span>
        <TextAreaField
          label={title}
          value={String(value ?? "")}
          onChange={onChange}
        />
      </label>
    );
  return (
    <label className="field">
      <span>{title}</span>
      <TextField
        label={title}
        value={String(value ?? "")}
        onChange={onChange}
      />
    </label>
  );
}
export function Fields({
  fields,
  value,
  onChange,
  path,
  onSpatialEdit,
  targetId = "",
}: {
  targetId?: string;
  fields: Record<string, FieldSchema>;
  value: Record<string, JsonValue>;
  onChange: (key: string, value: JsonValue) => void;
  path: string;
  onSpatialEdit?: SpatialEdit;
}) {
  const document = useStudio((s) => s.document);
  return (
    <>
      {Object.entries(fields)
        .filter(([, field]) => fieldActive(field, value))
        .map(([key, field]) => (
          <Field
            key={key}
            field={field}
            options={
              document ? fieldOptions(document, field, targetId) : undefined
            }
            value={value[key] ?? null}
            path={path + "." + key}
            onSpatialEdit={
              onSpatialEdit
                ? (nested, value, space, target) =>
                    onSpatialEdit([key, ...nested], value, space, target)
                : undefined
            }
            onChange={(next) => onChange(key, next)}
          />
        ))}
    </>
  );
}
