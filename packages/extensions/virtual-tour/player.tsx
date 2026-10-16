import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import * as THREE from "three";
import { RuntimeAssetImage } from "../../player-ui/src/RuntimeAssetImage";
import type { PlayerWidget, PlayerWidgetProps } from "../player-contract";
import type { ProjectNavigation, ProjectNavigationState } from "./navigation";
import { directionAngles } from "./core";
import { worldToFloor } from "./spatial";
const empty: ProjectNavigationState = {
    nodeId: "",
    status: "idle",
    error: "",
    transitionImage: "",
    history: [],
    routeId: "",
    routeStatus: "stopped",
    routeIndex: 0,
  },
  subscribe = () => () => {},
  getEmpty = () => empty;
function ProjectWidget({ runtime, design }: PlayerWidgetProps) {
  const navigation = runtime?.capabilities.get(
      "studio.virtualTour.navigation",
    ) as ProjectNavigation | undefined,
    state = useSyncExternalStore(
      navigation?.subscribe ?? subscribe,
      navigation?.getSnapshot ?? getEmpty,
    ),
    [routeId, setRouteId] = useState(""),
    [floorId, setFloorId] = useState(""),
    [error, setError] = useState(""),
    radar = useRef<SVGPathElement>(null),
    radarPosition = useRef<SVGGElement>(null);
  const graph = navigation?.graph,
    node = graph?.nodes.find((n) => n.id === state.nodeId),
    floor = graph?.floors.find((f) => f.id === (floorId || node?.floorId));
  useEffect(() => {
    if (!runtime) return;
    const cleanup = runtime.engine.onRender(() => {
      const direction = runtime.engine.camera.getWorldDirection(
          new THREE.Vector3(),
        ),
        angle =
          directionAngles(direction.toArray()).yaw -
          (floor?.north ?? 0) -
          (floor?.rotation ?? 0);
      if (radar.current) radar.current.style.transform = `rotate(${angle}deg)`;
      if (
        floor?.calibrated &&
        floor.imageWidth &&
        floor.imageHeight &&
        radarPosition.current
      ) {
        const point = worldToFloor(
          floor,
          runtime.engine.camera.position.x,
          runtime.engine.camera.position.z,
        );
        radarPosition.current.setAttribute(
          "transform",
          `translate(${point[0] * 100} ${point[1] * 100})`,
        );
      }
    });
    return () => {
      cleanup();
    };
  }, [runtime, floor]);
  if (!navigation || !graph) return null;
  const run = (action: () => void | Promise<void>) =>
    void Promise.resolve()
      .then(action)
      .catch((error) => setError(String(error)));
  const index = graph.nodes.findIndex((n) => n.id === state.nodeId);
  return (
    <section className="project-navigation" aria-label="项目漫游导航">
      {state.transitionImage && (
        <div className="scene-transition">
          <img src={state.transitionImage} alt="正在进入下一场景" />
          <span role="status">正在进入目标节点…</span>
        </div>
      )}
      <header>
        <strong>{node?.name ?? "项目入口"}</strong>
        <button
          disabled={design || state.status !== "ready"}
          onClick={() =>
            run(async () => {
              const url = navigation.shareUrl();
              await navigator.clipboard.writeText(url);
              setError("已复制当前视点与固定项目修订地址");
            })
          }
        >
          分享当前视点
        </button>
        <button
          disabled={!state.history.length || design}
          onClick={() => run(() => navigation.back())}
        >
          返回
        </button>
      </header>
      <nav className="tour-node-strip" aria-label="场景缩略导航">
        {graph.nodes.map((n) => (
          <button
            key={n.id}
            aria-current={n.id === state.nodeId ? "location" : undefined}
            disabled={design || state.status === "loading"}
            onClick={() => run(() => navigation.navigate(n.id))}
          >
            <RuntimeAssetImage
              runtime={runtime}
              id={n.thumbnailAssetId || n.assetId}
              alt={n.name}
            />
            <span>{n.name}</span>
          </button>
        ))}
      </nav>
      <nav aria-label="当前场景链接">
        {graph.links
          .filter((l) => l.fromNodeId === node?.id)
          .map((link) => (
            <button
              key={link.id}
              disabled={design || state.status === "loading"}
              onClick={() => run(() => navigation.followLink(link.id))}
            >
              前往 {graph.nodes.find((n) => n.id === link.toNodeId)?.name}
            </button>
          ))}
      </nav>
      <div className="player-action-row">
        <button
          disabled={design || index <= 0}
          onClick={() =>
            run(() => navigation.navigate(graph.nodes[index - 1].id))
          }
        >
          上一站
        </button>
        <button
          disabled={design || index >= graph.nodes.length - 1}
          onClick={() =>
            run(() => navigation.navigate(graph.nodes[index + 1].id))
          }
        >
          下一站
        </button>
      </div>
      {graph.floors.length > 0 && (
        <details>
          <summary>楼层地图 {floor?.calibrated ? "" : "· 未标定"}</summary>
          <select
            aria-label="楼层"
            value={floor?.id ?? ""}
            onChange={(e) => setFloorId(e.target.value)}
          >
            {graph.floors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          {floor && (
            <div className="floorplan">
              <RuntimeAssetImage
                runtime={runtime}
                id={floor.assetId}
                alt={floor.name}
              />
              <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                {graph.nodes
                  .filter((n) => n.floorId === floor.id)
                  .map((n) => (
                    <g
                      key={n.id}
                      ref={n.id === node?.id ? radarPosition : undefined}
                      transform={`translate(${n.floorX * 100} ${n.floorY * 100})`}
                    >
                      <circle
                        role="button"
                        tabIndex={0}
                        aria-label={n.name}
                        r={2}
                        fill={n.id === node?.id ? "#fff" : "#32cfa8"}
                        onClick={() => run(() => navigation.navigate(n.id))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter")
                            run(() => navigation.navigate(n.id));
                        }}
                      />
                      {n.id === node?.id && (
                        <path
                          ref={radar}
                          d="M0 0 L-7 -10 A12 12 0 0 1 7 -10 Z"
                          fill="#51d9b999"
                        />
                      )}
                    </g>
                  ))}
              </svg>
            </div>
          )}
        </details>
      )}
      {graph.routes.length > 0 && (
        <div>
          <select
            aria-label="自动导览路线"
            value={routeId || graph.routes[0].id}
            onChange={(e) => setRouteId(e.target.value)}
          >
            {graph.routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <div className="player-action-row">
            <button
              disabled={design}
              onClick={() =>
                run(() => navigation.startRoute(routeId || graph.routes[0].id))
              }
            >
              自动导览
            </button>
            <button onClick={() => navigation.pauseRoute()}>暂停</button>
            <button onClick={() => run(() => navigation.resumeRoute())}>
              继续
            </button>
            <button onClick={() => navigation.stopRoute()}>结束</button>
          </div>
          <small>
            {state.routeStatus} · 站点 {state.routeIndex + 1}
          </small>
        </div>
      )}
      {(state.error || error) && <p role="alert">{state.error || error}</p>}
    </section>
  );
}
export const widgets: PlayerWidget[] = [
  {
    kind: "projectNavigation",
    title: "项目漫游导航",
    always: true,
    available: (runtime) =>
      runtime.capabilities.has("studio.virtualTour.navigation"),
    Component: ProjectWidget,
  },
];
