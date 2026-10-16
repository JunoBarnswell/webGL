import { createWorkerTaskPool } from "@studio/asset-pipeline";
import type { EditorAnalysis } from "../../../../packages/extensions/editor-analysis";
const run = createWorkerTaskPool(
  () =>
    new Worker(
      new URL("../workers/document-analysis.worker.ts", import.meta.url),
      { type: "module" },
    ),
  1,
);
export const analyze: EditorAnalysis = (operation, input, options) =>
  run(operation, input, options);
