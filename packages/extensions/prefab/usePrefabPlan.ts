import { useEffect, useRef, useState } from "react";
import {
  acceptPrefabPlan,
  type PrefabUpdatePlan,
  type PrefabReferenceMigration,
} from "../../editor-core/src/prefab";
import type { PrefabRevision } from "../../scene-schema/src/prefab";
import type { SceneDocument } from "../../scene-schema/src/types";
import type { EditorAnalysis } from "../editor-analysis";
export function usePrefabPlan(
  document: SceneDocument,
  ids: string[],
  revision: PrefabRevision | null,
  choices: Record<string, "instance" | "source">,
  migrations: PrefabReferenceMigration[],
  analyze: EditorAnalysis,
) {
  const [state, setState] = useState<{
      plan: PrefabUpdatePlan | null;
      status: string;
      error: string;
    }>({ plan: null, status: "idle", error: "" }),
    [attempt, setAttempt] = useState(0),
    current = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!revision || !ids.length) {
      setState({ plan: null, status: "idle", error: "" });
      return;
    }
    const controller = new AbortController();
    current.current = controller;
    let active = true;
    setState({ plan: null, status: "planning", error: "" });
    void analyze(
      "prefabPlan",
      { document, ids, revision, choices, migrations },
      { signal: controller.signal },
    )
      .then((prepared) => {
        if (active && !controller.signal.aborted)
          setState({
            plan: acceptPrefabPlan(document, prepared),
            status: "ready",
            error: "",
          });
      })
      .catch((error) => {
        if (active && !controller.signal.aborted)
          setState({ plan: null, status: "error", error: String(error) });
      })
      .finally(() => {
        if (current.current === controller) current.current = null;
      });
    return () => {
      active = false;
      controller.abort();
      if (current.current === controller) current.current = null;
    };
  }, [document, ids, revision, choices, migrations, analyze, attempt]);
  return {
    ...state,
    cancel: () => {
      current.current?.abort();
      current.current = null;
      setState({ plan: null, status: "cancelled", error: "" });
    },
    retry: () => setAttempt((value) => value + 1),
  };
}
