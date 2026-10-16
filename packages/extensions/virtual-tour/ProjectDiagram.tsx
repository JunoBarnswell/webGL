import { useEffect, useRef, useState } from "react";
import type { ProjectGraph } from "./core";
import { ensureDiagram, nodePosition, removeProjectNodes } from "./spatial";
type View = { x: number; y: number; zoom: number };
export function ProjectDiagram({
  graph,
  active,
  onSelect,
  edit,
}: {
  graph: ProjectGraph;
  active: string;
  onSelect: (id: string) => void;
  edit: (label: string, change: (graph: ProjectGraph) => void) => void;
}) {
  const [selection, setSelection] = useState<string[]>([]),
    [temporary, setTemporary] = useState<
      Record<string, { x: number; y: number }>
    >({}),
    [view, setView] = useState<View | null>(null),
    [error, setError] = useState("");
  const host = useRef<SVGSVGElement>(null),
    gesture = useRef<{
      pointer: number;
      x: number;
      y: number;
      view: View;
      nodes: Record<string, { x: number; y: number }>;
      pan: boolean;
    } | null>(null),
    wheel = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const viewport = view ?? graph.diagram?.viewport ?? { x: 0, y: 0, zoom: 1 };
  const position = (id: string) => temporary[id] ?? nodePosition(graph, id);
  useEffect(
    () => () => {
      clearTimeout(wheel.current);
    },
    [],
  );
  const commitView = (next: View) => {
    edit("调整连接图视图", (g) => {
      ensureDiagram(g).viewport = next;
    });
    setView(null);
  };
  const commitNodes = (positions: Record<string, { x: number; y: number }>) =>
    edit("移动连接图节点", (g) => {
      const diagram = ensureDiagram(g);
      for (const [nodeId, point] of Object.entries(positions)) {
        const old = diagram.positions.find((p) => p.nodeId === nodeId);
        if (old) Object.assign(old, point);
        else diagram.positions.push({ nodeId, ...point });
      }
    });
  const allPositions = graph.nodes.map((n) => position(n.id)),
    minX = Math.min(0, ...allPositions.map((p) => p.x)) - 30,
    minY = Math.min(0, ...allPositions.map((p) => p.y)) - 30,
    maxX = Math.max(1000, ...allPositions.map((p) => p.x + 180)) + 30,
    maxY = Math.max(620, ...allPositions.map((p) => p.y + 90)) + 30,
    miniScale = Math.min(180 / (maxX - minX), 120 / (maxY - minY));
  const run = (action: () => void) => {
    try {
      action();
      setError("");
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <div className="project-diagram-editor">
      <div className="button-group">
        <button
          onClick={() => {
            clearTimeout(wheel.current);
            commitView({ x: 0, y: 0, zoom: 1 });
          }}
        >
          重置视图
        </button>
        <button
          disabled={selection.length < 2}
          onClick={() =>
            edit("节点分组", (g) => {
              ensureDiagram(g).groups.push({
                id: crypto.randomUUID(),
                name: "节点组 " + ((g.diagram?.groups.length ?? 0) + 1),
                nodeIds: [...selection],
              });
            })
          }
        >
          组合选中节点
        </button>
        <button
          onClick={() =>
            edit("自动布局连接图", (g) => {
              ensureDiagram(g).positions = g.nodes.map((n, i) => ({
                nodeId: n.id,
                x: 40 + (i % 5) * 210,
                y: 40 + Math.floor(i / 5) * 130,
              }));
            })
          }
        >
          自动布局
        </button>
        <span>
          拖动节点 · 空白拖动平移 · 滚轮缩放 · Shift 多选 · 方向键移动 · Esc
          取消
        </span>
      </div>
      <svg
        ref={host}
        className="tour-graph"
        role="application"
        aria-label="项目节点连接图"
        tabIndex={0}
        viewBox="0 0 1000 620"
        onWheel={(event) => {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect(),
            px = ((event.clientX - rect.left) * 1000) / rect.width,
            py = ((event.clientY - rect.top) * 620) / rect.height,
            zoom = Math.min(
              4,
              Math.max(0.1, viewport.zoom * Math.exp(-event.deltaY * 0.001)),
            );
          const next = {
            zoom,
            x: px - ((px - viewport.x) * zoom) / viewport.zoom,
            y: py - ((py - viewport.y) * zoom) / viewport.zoom,
          };
          setView(next);
          clearTimeout(wheel.current);
          wheel.current = setTimeout(() => commitView(next), 220);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || gesture.current) return;
          const element = (event.target as Element).closest<SVGGElement>(
              "[data-node]",
            ),
            id = element?.dataset.node;
          const nodes: Record<string, { x: number; y: number }> = {};
          if (id) {
            const selected = event.shiftKey
              ? [...new Set([...selection, id])]
              : selection.includes(id)
                ? selection
                : [id];
            setSelection(selected);
            onSelect(id);
            for (const key of selected) nodes[key] = position(key);
          } else if (!event.shiftKey) setSelection([]);
          gesture.current = {
            pointer: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            view: viewport,
            nodes,
            pan: !id,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.focus();
        }}
        onPointerMove={(event) => {
          const drag = gesture.current;
          if (!drag || drag.pointer !== event.pointerId) return;
          const rect = event.currentTarget.getBoundingClientRect(),
            dx = ((event.clientX - drag.x) * 1000) / rect.width,
            dy = ((event.clientY - drag.y) * 620) / rect.height;
          if (drag.pan)
            setView({ ...drag.view, x: drag.view.x + dx, y: drag.view.y + dy });
          else
            setTemporary(
              Object.fromEntries(
                Object.entries(drag.nodes).map(([id, p]) => [
                  id,
                  {
                    x: p.x + dx / drag.view.zoom,
                    y: p.y + dy / drag.view.zoom,
                  },
                ]),
              ),
            );
        }}
        onPointerUp={(event) => {
          const drag = gesture.current;
          if (!drag || drag.pointer !== event.pointerId) return;
          gesture.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          if (drag.pan) commitView(viewport);
          else if (Object.keys(temporary).length) commitNodes(temporary);
          setTemporary({});
        }}
        onPointerCancel={() => {
          gesture.current = null;
          setTemporary({});
          setView(null);
        }}
        onKeyDown={(event) => {
          if ((event.target as Element).closest("button,input,select,textarea"))
            return;
          if (event.key === "Escape") {
            gesture.current = null;
            setTemporary({});
            setView(null);
            event.preventDefault();
          } else if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            run(() =>
              edit("删除连接图节点", (g) =>
                removeProjectNodes(g, new Set(selection)),
              ),
            );
          } else if (
            ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
              event.key,
            )
          ) {
            event.preventDefault();
            const step = event.shiftKey ? 50 : 10;
            commitNodes(
              Object.fromEntries(
                selection.map((id) => {
                  const p = position(id);
                  return [
                    id,
                    {
                      x:
                        p.x +
                        (event.key === "ArrowLeft"
                          ? -step
                          : event.key === "ArrowRight"
                            ? step
                            : 0),
                      y:
                        p.y +
                        (event.key === "ArrowUp"
                          ? -step
                          : event.key === "ArrowDown"
                            ? step
                            : 0),
                    },
                  ];
                }),
              ),
            );
          }
        }}
      >
        <defs>
          <marker
            id="tour-edge-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <path d="M0 0 L8 4 L0 8Z" fill="#79a2b5" />
          </marker>
        </defs>
        <g
          transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}
        >
          {graph.diagram?.groups.map((group) => {
            const points = group.nodeIds
              .filter((id) => graph.nodes.some((n) => n.id === id))
              .map(position);
            if (!points.length) return null;
            const x = Math.min(...points.map((p) => p.x)) - 14,
              y = Math.min(...points.map((p) => p.y)) - 28;
            return (
              <g key={group.id}>
                <rect
                  x={x}
                  y={y}
                  width={Math.max(...points.map((p) => p.x)) + 174 - x}
                  height={Math.max(...points.map((p) => p.y)) + 84 - y}
                  rx={12}
                  fill="#253f4933"
                  stroke="#608390"
                  strokeDasharray="5 4"
                />
                <text x={x + 8} y={y + 18} fill="#9db8c9">
                  {group.name}
                </text>
              </g>
            );
          })}
          {graph.links.map((link) => {
            const a = position(link.fromNodeId),
              b = position(link.toNodeId);
            return (
              <path
                key={link.id}
                d={`M${a.x + 160} ${a.y + 34} C${a.x + 220} ${a.y + 34},${b.x - 60} ${b.y + 34},${b.x} ${b.y + 34}`}
                fill="none"
                stroke="#79a2b5"
                strokeWidth={2}
                markerEnd="url(#tour-edge-arrow)"
              />
            );
          })}
          {graph.nodes.map((node) => {
            const p = position(node.id),
              selected = selection.includes(node.id) || node.id === active;
            return (
              <g
                key={node.id}
                data-node={node.id}
                role="button"
                aria-label={node.name}
                aria-pressed={selected}
                tabIndex={0}
                transform={`translate(${p.x} ${p.y})`}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelection([node.id]);
                    onSelect(node.id);
                  }
                }}
              >
                <rect
                  width={160}
                  height={68}
                  rx={8}
                  fill={selected ? "#236253" : "#253644"}
                  stroke={selected ? "#64d6b7" : "#516276"}
                />
                <text x={10} y={28} fill="white">
                  {node.name.slice(0, 18)}
                </text>
                <text x={10} y={51} fill="#b3c2d0" fontSize={11}>
                  {node.kind}
                  {graph.entryNodeId === node.id ? " · 入口" : ""}
                </text>
              </g>
            );
          })}
        </g>
        <g
          aria-label="连接图小地图"
          transform="translate(810 490)"
          onPointerDown={(event) => {
            event.stopPropagation();
            const r = event.currentTarget.getBoundingClientRect(),
              x = minX + ((event.clientX - r.left) * 180) / r.width / miniScale,
              y = minY + ((event.clientY - r.top) * 120) / r.height / miniScale;
            commitView({
              ...viewport,
              x: 500 - x * viewport.zoom,
              y: 310 - y * viewport.zoom,
            });
          }}
        >
          <rect width={180} height={120} fill="#141d28" stroke="#687e90" />
          {graph.nodes.map((node) => {
            const p = position(node.id);
            return (
              <rect
                key={node.id}
                x={(p.x - minX) * miniScale}
                y={(p.y - minY) * miniScale}
                width={160 * miniScale}
                height={68 * miniScale}
                fill={node.id === active ? "#fff" : "#64d6b7"}
              />
            );
          })}
          <rect
            x={(-viewport.x / viewport.zoom - minX) * miniScale}
            y={(-viewport.y / viewport.zoom - minY) * miniScale}
            width={(1000 / viewport.zoom) * miniScale}
            height={(620 / viewport.zoom) * miniScale}
            fill="none"
            stroke="#ffca88"
            strokeWidth={1}
          />
        </g>
      </svg>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
