import {
  ProjectNavigation,
  publishedSceneLoader,
} from "../../../packages/extensions/virtual-tour/navigation";
import type { ProjectManifest } from "../../../packages/extensions/virtual-tour/core";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ShowroomEngine } from "@o2vr/engine";
import {
  assertDocument,
  migrateDocument,
  type PublishedManifest,
} from "@studio/scene-schema";
import { SceneRuntime } from "@studio/scene-runtime";
import { PlayerUI } from "@studio/player-ui";
import "./style.css";
function Player() {
  const host = useRef<HTMLDivElement>(null);
  const [runtime, setRuntime] = useState<SceneRuntime | null>(null),
    [manifest, setManifest] = useState<PublishedManifest | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    let engine: ShowroomEngine | undefined,
      instance: SceneRuntime | undefined,
      navigation: ProjectNavigation | undefined;
    void (async () => {
      const scene = new URLSearchParams(location.search).get("scene");
      const project = new URLSearchParams(location.search).get("project");
      if (project) {
        const version = new URLSearchParams(location.search).get("version");
        const response = await fetch(
          "/api/player/projects/" +
            encodeURIComponent(project) +
            (version ? "/versions/" + encodeURIComponent(version) : "") +
            "/manifest",
          { signal: abort.signal },
        );
        if (!response.ok) throw Error("项目无法读取 HTTP " + response.status);
        const projectManifest = (await response.json()) as ProjectManifest;
        if (abort.signal.aborted) return;
        engine = new ShowroomEngine({ container: host.current! });
        instance = new SceneRuntime(engine, {
          url: (id, path) =>
            "/api/player/projects/" +
            project +
            "/versions/" +
            projectManifest.versionId +
            "/assets/" +
            id +
            "/files/" +
            path.split("/").map(encodeURIComponent).join("/"),
          recordsUrl: (id, parameters) =>
            "/api/player/projects/" +
            project +
            "/versions/" +
            projectManifest.versionId +
            "/semantics/" +
            id +
            "?" +
            parameters,
        });
        const current = instance;
        navigation = new ProjectNavigation(
          current,
          projectManifest,
          (node, signal) => publishedSceneLoader(projectManifest, node, signal),
        );
        setRuntime(current);
        await navigation.bindBrowserHistory(window);
        setManifest({
          versionId: projectManifest.versionId,
          publishedAt: projectManifest.publishedAt,
          document: current.document!,
          runtimeBuild: projectManifest.runtimeBuild,
          extensionCatalogHash: projectManifest.extensionCatalogHash ?? "",
        });
        return;
      }
      if (!scene) throw new Error("缺少场景或项目地址");
      const response = await fetch(
        "/api/player/" + encodeURIComponent(scene) + "/manifest",
        { signal: abort.signal },
      );
      if (!response.ok)
        throw new Error("展厅无法读取：HTTP " + response.status);
      const manifest = (await response.json()) as PublishedManifest;
      manifest.document = migrateDocument(manifest.document).document;
      assertDocument(manifest.document, true);
      if (
        manifest.runtimeBuild &&
        !["1", "2"].includes(manifest.runtimeBuild.split(".")[0])
      )
        throw Error("Player 运行版本不兼容");
      if (abort.signal.aborted) return;
      engine = new ShowroomEngine({ container: host.current! });
      instance = new SceneRuntime(engine, {
        recordsUrl: (id, parameters) =>
          "/api/player/" +
          scene +
          "/versions/" +
          manifest.versionId +
          "/semantics/" +
          id +
          "?" +
          parameters,
        url: (id, path) =>
          "/api/player/" +
          scene +
          "/versions/" +
          manifest.versionId +
          "/assets/" +
          id +
          "/files/" +
          path.split("/").map(encodeURIComponent).join("/"),
      });
      setManifest(manifest);
      setRuntime(instance);
      await instance.loadDocument(manifest.document, { signal: abort.signal });
    })().catch((error) => {
      if (!abort.signal.aborted) setError(String(error));
    });
    return () => {
      abort.abort();
      navigation?.dispose();
      instance?.dispose();
      engine?.dispose();
    };
  }, []);
  return (
    <main className="standalone-player">
      <div ref={host} className="player-viewport" />
      {runtime && manifest && (
        <PlayerUI
          runtime={runtime}
          document={runtime.document ?? manifest.document}
        />
      )}
      <div className="player-system-status" role={error ? "alert" : "status"}>
        {error || (!manifest ? "正在连接展厅…" : "")}
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Player />);
