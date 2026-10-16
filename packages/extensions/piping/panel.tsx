import { useMemo, useState } from "react";
import {
  createAction,
  createComponent,
  createEntity,
  getComponent,
} from "../../scene-schema/src/index";
import type { ExtensionPanelProps } from "../editor-contract";
import { parseCsv, pipingCsv, type CsvMapping } from "./csv";
export function PipingPanel({
  document,
  selectedIds,
  mode,
  command,
  select,
  focus,
  dispatch,
  inspect,
}: ExtensionPanelProps) {
  const [filter, setFilter] = useState(""),
    [source, setSource] = useState(""),
    [mapping, setMapping] = useState<Record<string, CsvMapping>>({}),
    [message, setMessage] = useState("");
  const lines = document.entities.filter((e) =>
    getComponent(e, "studio.piping.Line"),
  );
  const systems = document.entities.filter((e) =>
    getComponent(e, "studio.piping.System"),
  );
  const members = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const e of document.entities) {
      const id = String(
        getComponent(e, "studio.piping.Segment")?.data.lineId ?? "",
      );
      if (id) map.set(id, [...(map.get(id) ?? []), e.id]);
    }
    return map;
  }, [document]);
  const headers = source ? (parseCsv(source)[0] ?? []) : [];
  let preview: ReturnType<typeof pipingCsv> | undefined;
  let errorMessage = message;
  try {
    if (source) preview = pipingCsv(document, source, mapping);
  } catch (error) {
    errorMessage = String(error);
  }
  const fields = [
    "sourceElementId",
    "lineNo",
    "service",
    "spec",
    "nominalDiameter",
    "material",
    "pressureClass",
    "insulation",
    "fromEquipment",
    "toEquipment",
    "sourceSystem",
  ];
  const run = (type: string, id: string) => {
    const a = createAction(type);
    a.targetId = id;
    void dispatch(a);
  };
  return (
    <section className="kit-panel">
      <input
        aria-label="筛选管线"
        placeholder="管线号 / 系统 / 设备 / 属性"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="kit-list">
        {lines
          .filter((line) =>
            (
              line.name +
              " " +
              JSON.stringify(getComponent(line, "studio.piping.Line")?.data)
            )
              .toLowerCase()
              .includes(filter.toLowerCase()),
          )
          .map((line) => (
            <div key={line.id}>
              <button
                onClick={() => {
                  const ids = members.get(line.id) ?? [];
                  select([line.id, ...ids]);
                  focus(ids);
                }}
              >
                {String(
                  getComponent(line, "studio.piping.Line")!.data.lineNo,
                ) || line.name}{" "}
                · {members.get(line.id)?.length ?? 0} 段
              </button>
              <button onClick={() => inspect(line.id)}>属性</button>
              {mode === "play" && (
                <>
                  <button
                    onClick={() => run("studio.piping.Highlight", line.id)}
                  >
                    高亮
                  </button>
                  <button onClick={() => run("studio.piping.Isolate", line.id)}>
                    隔离
                  </button>
                  <button onClick={() => run("studio.piping.Focus", line.id)}>
                    飞入
                  </button>
                </>
              )}
            </div>
          ))}
      </div>
      {mode === "edit" && (
        <>
          <label>
            所选模型管段归属
            <select
              aria-label="批量分配管线"
              value=""
              onChange={(event) => {
                const lineId = event.target.value;
                if (lineId)
                  command({
                    label: "绑定所选模型管段",
                    mutate: (doc) => {
                      for (const entity of doc.entities.filter((e) =>
                        selectedIds.includes(e.id),
                      )) {
                        if (entity.locked) throw Error("所选对象已锁定");
                        if (
                          !getComponent(entity, "Mesh") &&
                          !getComponent(entity, "ModelNode") &&
                          !getComponent(entity, "studio.piping.Segment")
                        )
                          continue;
                        let segment = getComponent(
                          entity,
                          "studio.piping.Segment",
                        );
                        if (!segment) {
                          segment = createComponent("studio.piping.Segment");
                          entity.components.push(segment);
                        }
                        segment.data.lineId = lineId;
                        segment.data.sourceElementId = String(
                          getComponent(entity, "ModelNode")?.data
                            .sourceElementId || entity.id,
                        );
                      }
                    },
                  });
              }}
            >
              <option value="">选择逻辑管线…</option>
              {lines.map((line) => (
                <option key={line.id} value={line.id}>
                  {line.name}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() =>
              command({
                label: "创建管网系统",
                mutate: (doc) => {
                  const e = createEntity("管网系统");
                  const c = createComponent("studio.piping.System");
                  c.data.systemNo = "SYSTEM-" + e.id.slice(0, 6);
                  e.components.push(c);
                  doc.entities.push(e);
                },
              })
            }
          >
            新建管网系统
          </button>
          {systems.length > 0 && (
            <label>
              所选管线所属系统
              <select
                aria-label="批量分配管网系统"
                value=""
                onChange={(e) => {
                  const systemId = e.target.value;
                  if (systemId)
                    command({
                      label: "分配管线系统",
                      mutate: (doc) => {
                        for (const line of doc.entities.filter((e) =>
                          selectedIds.includes(e.id),
                        )) {
                          const c = getComponent(line, "studio.piping.Line");
                          if (c) c.data.systemId = systemId;
                        }
                      },
                    });
                }}
              >
                <option value="">选择系统…</option>
                {systems.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            管线属性表 CSV
            <input
              type="file"
              accept=".csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  void file
                    .text()
                    .then((text) => {
                      const headers = parseCsv(text)[0];
                      setSource(text);
                      setMapping(
                        Object.fromEntries(
                          (headers ?? []).map((column) => [
                            column,
                            { column, type: "string" },
                          ]),
                        ),
                      );
                      setMessage("");
                    })
                    .catch((error) => setMessage(String(error)));
              }}
            />
          </label>
          {source && (
            <>
              <h4>字段映射</h4>
              {[
                ...new Set([
                  ...fields,
                  ...Object.keys(mapping).filter((k) => !fields.includes(k)),
                ]),
              ].map((field) => (
                <div className="csv-mapping" key={field}>
                  <span>{field}</span>
                  <select
                    aria-label={field + " CSV 列"}
                    value={mapping[field]?.column ?? ""}
                    onChange={(e) => {
                      const next = { ...mapping };
                      if (e.target.value)
                        next[field] = {
                          column: e.target.value,
                          type: mapping[field]?.type ?? "string",
                          unit: mapping[field]?.unit,
                        };
                      else delete next[field];
                      setMapping(next);
                      setMessage("");
                    }}
                  >
                    <option value="">不导入</option>
                    {headers.map((column) => (
                      <option key={column}>{column}</option>
                    ))}
                  </select>
                  <select
                    aria-label={field + " 类型"}
                    value={mapping[field]?.type ?? "string"}
                    onChange={(e) =>
                      setMapping({
                        ...mapping,
                        [field]: {
                          ...mapping[field],
                          column: mapping[field]?.column ?? field,
                          type: e.target.value as
                            | "string"
                            | "number"
                            | "boolean",
                        },
                      })
                    }
                  >
                    <option value="string">文本</option>
                    <option value="number">数值</option>
                    <option value="boolean">布尔</option>
                  </select>
                  <input
                    aria-label={field + " 单位"}
                    placeholder="单位"
                    value={mapping[field]?.unit ?? ""}
                    onChange={(e) =>
                      setMapping({
                        ...mapping,
                        [field]: {
                          ...mapping[field],
                          column: mapping[field]?.column ?? field,
                          unit: e.target.value,
                        },
                      })
                    }
                  />
                </div>
              ))}
              <p role="status">
                匹配 {preview?.report.matched ?? 0} 行；错误{" "}
                {preview?.report.errors.length ?? 0}
              </p>
              {preview?.report.errors.map((error) => (
                <p key={error} role="alert">
                  {error}
                </p>
              ))}
              <button
                disabled={!preview || Boolean(preview.report.errors.length)}
                onClick={() => {
                  if (preview) {
                    if (command(preview.command)) {
                      setMessage("CSV 已作为一条可撤销事务应用");
                      setSource("");
                    }
                  }
                }}
              >
                应用 CSV 事务
              </button>
              <button onClick={() => setSource("")}>取消导入</button>
            </>
          )}
          {errorMessage && <p role="status">{errorMessage}</p>}
        </>
      )}
      {mode === "play" && lines[0] && (
        <button onClick={() => run("studio.piping.Restore", lines[0].id)}>
          恢复全部管网
        </button>
      )}
      <p className="hint">
        逻辑管线与物理管段分别保存。自定义数值/布尔属性和单位保留在 properties
        中。
      </p>
    </section>
  );
}
