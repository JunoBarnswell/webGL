import { useExtensionProps } from "./ExtensionHost";
import {
  extensionTools,
  extensionPanels,
} from "../../../../packages/extensions/editor";
import { useConsoleLayout } from "../shell/layout";
import { execute } from "../shell/commands";
export function ExtensionTools() {
  const props = useExtensionProps();
  if (!props) return null;
  const { mode, selectedIds } = props;
  return (
    <details className="extension-tools">
      <summary>扩展工具与任务模板</summary>
      <div className="button-group">
        {extensionTools.map((tool) => (
          <button
            disabled={mode === "play" || !selectedIds.length}
            key={tool.id}
            title={tool.description}
            onClick={() => execute("extension." + tool.id)}
          >
            {tool.title}
          </button>
        ))}
      </div>
      {extensionPanels
        .filter((p) => !p.workspace)
        .map(({ id, title }) => (
          <button key={id} onClick={() => useConsoleLayout.getState().open("extension." + id)}>{title} ↗</button>
        ))}
    </details>
  );
}
