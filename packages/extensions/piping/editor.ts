import {
  createComponent,
  createEntity,
  declareExtension,
  getComponent,
} from "../../scene-schema/src/index";
import type { ExtensionTool } from "../../editor-core/src/ExtensionTool";
import type { SceneDocument } from "../../scene-schema/src/index";
import type { EditorCommand } from "../../editor-core/src/EditorSession";
export const tools: ExtensionTool[] = [
  {
    id: "piping.template",
    title: "绑定逻辑管线",
    description: "创建一条逻辑管线，将选中的物理管段与标签关联",
    create: (_doc, selected) => ({
      label: "绑定逻辑管线",
      mutate: (doc) => {
        if (!selected.length) throw Error("先选择管段");
        const line = createEntity("新管线");
        const c = createComponent("studio.piping.Line");
        c.data.lineNo = "LINE-" + line.id.slice(0, 8);
        line.components.push(c);
        declareExtension(doc, "studio.piping.Line");
        doc.entities.push(line);
        for (const id of selected) {
          const segment = doc.entities.find((e) => e.id === id);
          if (!segment || segment.locked) throw Error("管段被锁定");
          const c =
            getComponent(segment, "studio.piping.Segment") ??
            createComponent("studio.piping.Segment");
          c.data.lineId = line.id;
          if (!segment.components.includes(c)) segment.components.push(c);
        }
      },
    }),
  },
];
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
export function pipingCsv(
  document: SceneDocument,
  source: string,
): { report: CsvReport; command: EditorCommand } {
  const [headers, ...records] = parseCsv(source);
  if (!headers?.includes("sourceElementId") || !headers.includes("lineNo"))
    throw Error("CSV 需要 sourceElementId 与 lineNo 列");
  const rows = records.map((values) =>
    Object.fromEntries(headers.map((key, index) => [key, values[index] ?? ""])),
  );
  const errors: string[] = [],
    seen = new Set<string>();
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
  const report = { matched, errors, rows };
  return {
    report,
    command: {
      label: "导入管线属性 CSV",
      mutate: (doc) => {
        if (errors.length) throw Error(errors.join("\n"));
        declareExtension(doc, "studio.piping.Line");
        for (const row of rows) {
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
          for (const key of Object.keys(data))
            if (row[key] !== undefined) data[key] = row[key];
          const entity = doc.entities.find((e) =>
            e.components.some(
              (c) =>
                String(c.data.sourceElementId ?? "") === row.sourceElementId,
            ),
          )!;
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
