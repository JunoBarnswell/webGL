import {
  createComponent,
  createEntity,
  declareExtension,
  getComponent,
  type SceneDocument,
} from "../../scene-schema/src/index";
import type { EditorCommand } from "../../editor-core/src/EditorSession";
export interface CsvReport {
  matched: number;
  errors: string[];
  rows: Record<string, string>[];
}
export function parseCsv(source: string): string[][] {
  const rows: string[][] = [],
    row: string[] = [];
  let cell = "",
    quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      if (quoted && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === "," || c === "\n")) {
      row.push(cell.replace(/\r$/, ""));
      cell = "";
      if (c === "\n") {
        rows.push([...row]);
        row.length = 0;
      }
    } else cell += c;
  }
  if (quoted) throw Error("CSV 引号未闭合");
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((row) => row.some(Boolean));
}
export interface CsvMapping {
  column: string;
  type?: "string" | "number" | "boolean";
  unit?: string;
}
export function pipingCsv(
  document: SceneDocument,
  source: string,
  mapping?: Record<string, CsvMapping>,
): { report: CsvReport; command: EditorCommand } {
  const [headers, ...records] = parseCsv(source);
  if (!headers?.length || new Set(headers).size !== headers.length)
    throw Error("CSV 表头为空或重复");
  const columns: Record<string, CsvMapping> =
    mapping ??
    Object.fromEntries(headers.map((column) => [column, { column }]));
  if (!columns.sourceElementId || !columns.lineNo)
    throw Error("需要映射 sourceElementId 与 lineNo 列");
  const missing = Object.values(columns).filter(
    (spec) => !headers.includes(spec.column),
  );
  if (missing.length)
    throw Error(
      "映射列不存在：" + missing.map((spec) => spec.column).join(", "),
    );
  const errors: string[] = [],
    typedRows: Record<
      string,
      import("../../scene-schema/src/types").JsonValue
    >[] = [],
    rows = records.map((values, index) => {
      if (values.length !== headers.length)
        errors.push("第 " + (index + 2) + " 行列数与表头不同");
      const row: Record<string, string> = {},
        typed: Record<
          string,
          import("../../scene-schema/src/types").JsonValue
        > = {};
      for (const [field, spec] of Object.entries(columns)) {
        const cell = values[headers.indexOf(spec.column)] ?? "";
        row[field] = cell;
        let value: import("../../scene-schema/src/types").JsonValue = cell;
        if (spec.type === "number" && cell !== "") {
          if (!Number.isFinite(Number(cell)))
            errors.push(
              "第 " + (index + 2) + " 行 " + spec.column + " 不是有效数值",
            );
          else value = Number(cell);
        }
        if (spec.type === "boolean" && cell !== "") {
          if (!["true", "false", "1", "0"].includes(cell.toLowerCase()))
            errors.push(
              "第 " + (index + 2) + " 行 " + spec.column + " 不是布尔值",
            );
          else value = ["true", "1"].includes(cell.toLowerCase());
        }
        typed[field] = spec.unit ? { value, unit: spec.unit } : value;
      }
      typedRows.push(typed);
      return row;
    });
  const seen = new Set<string>();
  let matched = 0;
  for (const [index, row] of rows.entries()) {
    if (!row.lineNo || !row.sourceElementId || seen.has(row.sourceElementId))
      errors.push("第 " + (index + 2) + " 行：缺少字段或重复来源元素");
    seen.add(row.sourceElementId);
    const matches = document.entities.filter((e) =>
      e.components.some(
        (c) => String(c.data.sourceElementId ?? "") === row.sourceElementId,
      ),
    );
    if (matches.length !== 1)
      errors.push(
        "第 " + (index + 2) + " 行：来源元素匹配数量 " + matches.length,
      );
    else matched++;
  }
  return {
    report: { matched, errors, rows },
    command: {
      label: "导入管线属性 CSV",
      mutate: (doc) => {
        if (errors.length) throw Error(errors.join("\n"));
        declareExtension(doc, "studio.piping.Line");
        for (const [index, row] of rows.entries()) {
          let line = doc.entities.find(
            (e) =>
              getComponent(e, "studio.piping.Line")?.data.lineNo === row.lineNo,
          );
          if (!line) {
            line = createEntity(row.lineNo);
            line.components.push(createComponent("studio.piping.Line"));
            doc.entities.push(line);
          }
          const data = getComponent(line, "studio.piping.Line")!.data;
          data.lineNo = row.lineNo;
          if (row.systemId) data.systemId = row.systemId;
          const properties = {
            ...(data.properties as Record<
              string,
              import("../../scene-schema/src/types").JsonValue
            >),
          };
          for (const [key, value] of Object.entries(typedRows[index])) {
            if (["sourceElementId", "lineNo", "systemId"].includes(key))
              continue;
            if (
              key in data &&
              typeof data[key] === "string" &&
              typeof value === "string"
            )
              data[key] = value;
            else properties[key.replace(/^attr\./, "")] = value;
          }
          data.properties = properties;
          const entity = doc.entities.find((e) =>
            e.components.some(
              (c) =>
                String(c.data.sourceElementId ?? "") === row.sourceElementId,
            ),
          );
          if (!entity) throw Error("映射目标在应用前已改变");
          if (entity.locked) throw Error("来源模型元素已锁定");
          let segment = getComponent(entity, "studio.piping.Segment");
          if (!segment) {
            segment = createComponent("studio.piping.Segment");
            entity.components.push(segment);
          }
          segment.data.lineId = line.id;
          segment.data.sourceElementId = row.sourceElementId;
        }
      },
    },
  };
}
