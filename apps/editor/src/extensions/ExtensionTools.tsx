import { useRuntime } from "@studio/player-ui";
import {
  extensionTools,
  extensionPanels,
} from "../../../../packages/extensions/editor";
import { useStudio } from "../state/studio";
import { execute } from "../shell/commands";
export function ExtensionTools() {
  const runtime = useStudio((s) => s.runtime),
    snapshot = useRuntime(runtime);
  const document = useStudio((s) => s.document),
    selectedIds = useStudio((s) => s.selected),
    mode = useStudio((s) => s.mode);
  if (!document) return null;
  const state = useStudio.getState();
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
      {extensionPanels.map(({ id, title, Component }) => (
        <details key={id}>
          <summary>{title}</summary>
          <Component
            runtime={runtime}
            state={snapshot}
            document={document}
            selectedIds={selectedIds}
            mode={mode}
            command={state.command}
            select={(ids) => state.select(ids)}
            focus={(ids) => state.view?.focus(ids)}
            dispatch={async (action) => {
              try {
                await state.runtime?.dispatch(action);
              } catch (error) {
                state.set({ message: String(error) });
              }
            }}
            placeAnchor={(annotationId) =>
              state.set({ placingAnnotation: annotationId })
            }
            inspect={(id) => {
              state.select([id]);
              state.set({ inspectorOpen: true });
            }}
          />
        </details>
      ))}
    </details>
  );
}
