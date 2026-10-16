import { useState } from "react";
import {
  extensionTools,
  pipingCsv,
} from "../../../../packages/extensions/editor";
import { useStudio } from "../state/studio";
import { execute } from "../shell/commands";
export function ExtensionTools() {
  const doc = useStudio((s) => s.document),
    mode = useStudio((s) => s.mode);
  const [filter, setFilter] = useState(""),
    [report, setReport] = useState("");
  if (!doc) return null;
  const lines = doc.entities.filter(
    (e) =>
      e.components.some((c) => c.type === "studio.piping.Line") &&
      (e.name + " " + JSON.stringify(e.components))
        .toLowerCase()
        .includes(filter.toLowerCase()),
  );
  const unresolved = doc.entities.filter((e) =>
    e.components.some(
      (c) =>
        c.type === "studio.annotation.Label" &&
        c.data.entityId &&
        !doc.entities.some((target) => target.id === c.data.entityId),
    ),
  );
  return (
    <details className="extension-tools">
      <summary>扩展工具与任务模板</summary>
      <div className="button-group">
        {extensionTools.map((tool) => (
          <button
            disabled={mode === "play"}
            key={tool.id}
            title={tool.description}
            onClick={() => execute("extension." + tool.id)}
          >
            {tool.title}
          </button>
        ))}
      </div>
      <label>
        管线属性表 CSV
        <input
          type="file"
          accept=".csv"
          disabled={mode === "play"}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
              void file
                .text()
                .then((text) => {
                  const result = pipingCsv(doc, text);
                  setReport(
                    "已匹配 " +
                      result.report.matched +
                      "；" +
                      result.report.errors.join("；"),
                  );
                  if (!result.report.errors.length)
                    useStudio.getState().command(result.command);
                })
                .catch((error) => setReport(String(error)));
          }}
        />
      </label>
      {report && <p role="status">{report}</p>}
      <input
        aria-label="筛选管线"
        placeholder="管线号 / 系统 / 设备"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {lines.map((line) => (
        <button
          key={line.id}
          onClick={() => {
            useStudio
              .getState()
              .select([
                line.id,
                ...doc.entities
                  .filter((e) =>
                    e.components.some(
                      (c) =>
                        c.type === "studio.piping.Segment" &&
                        c.data.lineId === line.id,
                    ),
                  )
                  .map((e) => e.id),
              ]);
            useStudio.getState().view?.focus(useStudio.getState().selected);
          }}
        >
          {line.name}
        </button>
      ))}
      {unresolved.length > 0 && (
        <p role="alert">
          待修复标注 {unresolved.length}：请选择标签，在属性中重新指定附着对象。
        </p>
      )}
    </details>
  );
}
