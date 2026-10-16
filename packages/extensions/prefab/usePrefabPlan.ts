import { useEffect, useRef, useState } from "react";
import {
  acceptPrefabPlan,
  type PrefabUpdatePlan,
  type PrefabReferenceMigration,
  type PreparedPrefabUpdate,
} from "../../editor-core/src/prefab";
import type { PrefabRevision } from "../../scene-schema/src/prefab";
import type { SceneDocument } from "../../scene-schema/src/types";
export function usePrefabPlan(
  document: SceneDocument,
  ids: string[],
  revision: PrefabRevision | null,
  choices: Record<string, "instance" | "source">,
  migrations: PrefabReferenceMigration[],
) {
  const [state, setState] = useState<{
      plan: PrefabUpdatePlan | null;
      status: string;
      error: string;
    }>({ plan: null, status: "idle", error: "" }),
    [attempt, setAttempt] = useState(0),
    worker = useRef<Worker | null>(null);
  useEffect(() => {
    if (!revision || !ids.length) {
      setState({ plan: null, status: "idle", error: "" });
      return;
    }
    const task = new Worker(new URL("./plan.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = task;
    let active = true;
    setState({ plan: null, status: "planning", error: "" });
    task.onmessage = (
      event: MessageEvent<{ prepared?: PreparedPrefabUpdate; error?: string }>,
    ) => {
      if (!active || worker.current !== task) return;
      try {
        if (!event.data.prepared)
          throw Error(event.data.error ?? "计划生成失败");
        setState({
          plan: acceptPrefabPlan(document, event.data.prepared),
          status: "ready",
          error: "",
        });
      } catch (error) {
        setState({ plan: null, status: "error", error: String(error) });
      } finally {
        task.terminate();
        if (worker.current === task) worker.current = null;
      }
    };
    task.onerror = (event) => {
      if (active)
        setState({ plan: null, status: "error", error: event.message });
      task.terminate();
    };
    task.postMessage({ document, ids, revision, choices, migrations });
    return () => {
      active = false;
      task.terminate();
      if (worker.current === task) worker.current = null;
    };
  }, [document, ids, revision, choices, migrations, attempt]);
  return {
    ...state,
    cancel: () => {
      worker.current?.terminate();
      worker.current = null;
      setState({ plan: null, status: "cancelled", error: "" });
    },
    retry: () => setAttempt((v) => v + 1),
  };
}
