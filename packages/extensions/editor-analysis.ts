import type { SceneDocument, PrefabRevision } from "../scene-schema/src/index";
import type {
  PrefabReferenceMigration,
  PreparedPrefabUpdate,
} from "../editor-core/src/prefab";
import type { ProductCatalog } from "./configurator/core";
import type { CoverageOptions, CoverageReport } from "./configurator/coverage";
export interface EditorAnalysisTasks {
  prefabPlan: {
    input: {
      document: SceneDocument;
      ids: string[];
      revision: PrefabRevision;
      choices: Record<string, "source" | "instance">;
      migrations: PrefabReferenceMigration[];
    };
    output: PreparedPrefabUpdate;
  };
  configurationCoverage: {
    input: { catalog: ProductCatalog; options: CoverageOptions };
    output: CoverageReport;
  };
}
export type EditorAnalysis = <K extends keyof EditorAnalysisTasks>(
  operation: K,
  input: EditorAnalysisTasks[K]["input"],
  options?: import("../asset-pipeline/src/AssetWorker").AssetTaskOptions,
) => Promise<EditorAnalysisTasks[K]["output"]>;
export type EditorAnalysisRequest = {
  [K in keyof EditorAnalysisTasks]: {
    operation: K;
    payload: EditorAnalysisTasks[K]["input"];
  };
}[keyof EditorAnalysisTasks];
