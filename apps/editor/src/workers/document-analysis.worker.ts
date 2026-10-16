import {
  planPrefabUpdate,
  exportPrefabPlan,
} from "../../../../packages/editor-core/src/prefab";
import { analyzeCatalog } from "../../../../packages/extensions/configurator/coverage";
import type { EditorAnalysisRequest } from "../../../../packages/extensions/editor-analysis";
self.onmessage = (event: MessageEvent<EditorAnalysisRequest>) => {
  try {
    const request = event.data;
    switch (request.operation) {
      case "prefabPlan": {
        const { document, ids, revision, choices, migrations } =
          request.payload;
        self.postMessage({
          result: exportPrefabPlan(
            planPrefabUpdate(document, ids, revision, choices, migrations),
          ),
        });
        break;
      }
      case "configurationCoverage":
        self.postMessage({
          result: analyzeCatalog(
            request.payload.catalog,
            request.payload.options,
            (completed, total) =>
              self.postMessage({
                progress: true,
                message: "分析配置组合",
                completed,
                total,
              }),
          ),
        });
        break;
    }
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
