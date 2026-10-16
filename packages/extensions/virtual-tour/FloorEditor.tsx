import { useState } from "react";
import type { ExtensionPanelProps } from "../editor-contract";
import type { ProjectGraph } from "./core";
import { AssetPlane } from "./AssetPlane";
import { calibrateFloor, floorToWorld } from "./spatial";
export function FloorEditor({
  floor,
  graph,
  activeNode,
  services,
  edit,
}: {
  floor: ProjectGraph["floors"][number];
  graph: ProjectGraph;
  activeNode: string;
  services: ExtensionPanelProps["services"];
  edit: (label: string, change: (graph: ProjectGraph) => void) => void;
}) {
  const [tool, setTool] = useState("node"),
    [points, setPoints] = useState<[number, number][]>([]),
    [distance, setDistance] = useState(1000),
    [size, setSize] = useState([0, 0]),
    [error, setError] = useState("");
  return (
    <section>
      <h3>
        {floor.name} ·{" "}
        {floor.calibrated ? `${floor.mmPerPixel.toFixed(3)} mm/px` : "未标定"}
      </h3>
      <div className="button-group">
        <label>
          地图工具
          <select
            value={tool}
            onChange={(e) => {
              setTool(e.target.value);
              setPoints([]);
            }}
          >
            <option value="node">放置当前节点</option>
            <option value="calibrate">两点距离标定</option>
            <option value="origin">设置世界原点</option>
          </select>
        </label>
        {tool === "calibrate" && (
          <>
            <label>
              实际距离（毫米）
              <input
                type="number"
                min={0.001}
                value={distance}
                onChange={(e) => setDistance(e.currentTarget.valueAsNumber)}
              />
            </label>
            <button
              disabled={points.length !== 2}
              onClick={() => {
                try {
                  const calibrated = calibrateFloor(
                    floor,
                    points[0],
                    points[1],
                    distance,
                    size[0],
                    size[1],
                  );
                  edit("标定楼层比例", (g) =>
                    Object.assign(
                      g.floors.find((f) => f.id === floor.id)!,
                      calibrated,
                    ),
                  );
                  setPoints([]);
                  setError("");
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              确认标定（{points.length}/2）
            </button>
          </>
        )}
      </div>
      <AssetPlane
        assetId={floor.assetId}
        graph={graph}
        services={services}
        onSize={(width, height) => setSize([width, height])}
        onPoint={(x, y) => {
          if (tool === "calibrate")
            setPoints((p) => (p.length >= 2 ? [[x, y]] : [...p, [x, y]]));
          else if (tool === "origin")
            edit("设置地图原点", (g) =>
              Object.assign(g.floors.find((f) => f.id === floor.id)!, {
                originX: x,
                originY: y,
              }),
            );
          else if (activeNode)
            edit("定位楼层节点", (g) =>
              Object.assign(g.nodes.find((n) => n.id === activeNode)!, {
                floorId: floor.id,
                floorX: x,
                floorY: y,
              }),
            );
        }}
      >
        <svg
          className="project-image-overlay"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <path
            d={`M${(floor.originX ?? 0.5) * 100 - 2} ${(floor.originY ?? 0.5) * 100}h4m-2 -2v4`}
            stroke="#fff"
            strokeWidth={0.5}
          />
          {points.map((p, i) => (
            <circle
              key={i}
              cx={p[0] * 100}
              cy={p[1] * 100}
              r={1}
              fill="#ffb577"
            />
          ))}
          {graph.nodes
            .filter((n) => n.floorId === floor.id)
            .map((n) => (
              <g
                key={n.id}
                transform={`translate(${n.floorX * 100} ${n.floorY * 100})`}
              >
                <circle
                  r={1.5}
                  fill={n.id === activeNode ? "#fff" : "#64d6b7"}
                />
                <text x={2} fontSize={3} fill="#fff">
                  {n.name}
                </text>
              </g>
            ))}
        </svg>
      </AssetPlane>
      <div className="button-group">
        {(["north", "rotation"] as const).map((key) => (
          <label key={key}>
            {key === "north" ? "北向（度）" : "世界坐标旋转（度）"}
            <input
              type="number"
              value={floor[key] ?? 0}
              onChange={(e) => {
                const value = e.currentTarget.valueAsNumber;
                if (Number.isFinite(value))
                  edit("调整地图方向", (g) => {
                    g.floors.find((f) => f.id === floor.id)![key] = value;
                  });
              }}
            />
          </label>
        ))}
        <span>
          原点 {floor.originX ?? 0.5}, {floor.originY ?? 0.5}
        </span>
      </div>
      {error && <p role="alert">{error}</p>}
      <button
        disabled={!floor.calibrated || !activeNode}
        onClick={() =>
          edit("按标定地图更新入口相机", (g) => {
            const n = g.nodes.find((n) => n.id === activeNode)!;
            if (n.floorId !== floor.id) throw Error("当前节点属于其他楼层");
            const [x, z] = floorToWorld(floor, n.floorX, n.floorY),
              dx = x - n.camera.position[0],
              dz = z - n.camera.position[2];
            n.camera.position[0] = x;
            n.camera.position[2] = z;
            n.camera.target[0] += dx;
            n.camera.target[2] += dz;
          })
        }
      >
        按标定位置同步当前节点入口相机
      </button>
    </section>
  );
}
