import {
  planPrefabUpdate,
  exportPrefabPlan,
} from "../../editor-core/src/prefab";
self.onmessage = (event) => {
  try {
    const { document, ids, revision, choices, migrations } = event.data;
    self.postMessage({
      prepared: exportPrefabPlan(
        planPrefabUpdate(document, ids, revision, choices, migrations),
      ),
    });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
