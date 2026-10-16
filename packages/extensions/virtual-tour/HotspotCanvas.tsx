import { useRef, useState, type ComponentProps } from "react";
import { AssetPlane } from "./AssetPlane";
import type { ProjectGraph, TourNode } from "./core";
export function HotspotCanvas({
  node,
  edit,
  ...props
}: ComponentProps<typeof AssetPlane> & {
  node: TourNode;
  edit: (label: string, change: (graph: ProjectGraph) => void) => void;
}) {
  const [selected, setSelected] = useState(""),
    [preview, setPreview] = useState<{
      id: string;
      vertex: number;
      yaw: number;
      pitch: number;
    } | null>(null),
    drag = useRef<{ id: string; vertex: number } | null>(null);
  const move = (id: string, yaw: number, pitch: number, vertex = -1) =>
    edit("移动球面热点", (g) => {
      const h = g.nodes
        .find((n) => n.id === node.id)!
        .hotspots.find((h) => h.id === id)!;
      if (vertex < 0) Object.assign(h, { yaw, pitch });
      else h.points[vertex] = { yaw, pitch };
    });
  const hotspot = node.hotspots.find((h) => h.id === selected);
  return (
    <>
      <AssetPlane {...props}>
        <svg
          className="project-image-overlay"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-label="全景热点直接编辑"
          onPointerMove={(event) => {
            const d = drag.current;
            if (!d) return;
            const r = event.currentTarget.getBoundingClientRect();
            setPreview({
              ...d,
              yaw: Math.max(
                -180,
                Math.min(180, ((event.clientX - r.left) / r.width - 0.5) * 360),
              ),
              pitch: Math.max(
                -90,
                Math.min(90, (0.5 - (event.clientY - r.top) / r.height) * 180),
              ),
            });
          }}
          onPointerUp={(event) => {
            const d = drag.current;
            drag.current = null;
            if (d && preview) move(d.id, preview.yaw, preview.pitch, d.vertex);
            setPreview(null);
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            drag.current = null;
            setPreview(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              drag.current = null;
              setPreview(null);
              event.preventDefault();
            }
          }}
        >
          {node.hotspots.map((h) => {
            const points = h.kind === "polygon" ? h.points : [h];
            const projected = points.map((p, index) => {
              const q =
                preview?.id === h.id &&
                (preview.vertex === index || preview.vertex === -1)
                  ? preview
                  : p;
              return {
                x: (q.yaw / 360 + 0.5) * 100,
                y: (0.5 - q.pitch / 180) * 100,
              };
            });
            const anchor = projected[0]?.x ?? 0,
              unwrapped = projected.map((p) => ({
                ...p,
                x: anchor + (((p.x - anchor + 150) % 100) - 50),
              }));
            return (
              <g key={h.id}>
                {h.kind === "polygon" &&
                  [-100, 0, 100].map((shift) => (
                    <polygon
                      key={shift}
                      points={unwrapped
                        .map((p) => `${p.x + shift},${p.y}`)
                        .join(" ")}
                      fill={h.color + "44"}
                      stroke={h.color}
                      strokeWidth={0.3}
                    />
                  ))}
                {projected.map((p, index) => (
                  <circle
                    key={index}
                    cx={p.x}
                    cy={p.y}
                    r={selected === h.id ? 1.1 : 0.8}
                    fill={h.color}
                    stroke="white"
                    strokeWidth={0.25}
                    role="button"
                    aria-label={
                      h.name +
                      (h.kind === "polygon" ? " 顶点 " + (index + 1) : "")
                    }
                    tabIndex={0}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      setSelected(h.id);
                      drag.current = {
                        id: h.id,
                        vertex: h.kind === "polygon" ? index : -1,
                      };
                      event.currentTarget.ownerSVGElement?.setPointerCapture(
                        event.pointerId,
                      );
                    }}
                    onKeyDown={(event) => {
                      if (
                        [
                          "ArrowLeft",
                          "ArrowRight",
                          "ArrowUp",
                          "ArrowDown",
                        ].includes(event.key)
                      ) {
                        event.preventDefault();
                        setSelected(h.id);
                        const old = points[index],
                          step = event.shiftKey ? 5 : 0.1;
                        move(
                          h.id,
                          ((old.yaw +
                            (event.key === "ArrowLeft"
                              ? -step
                              : event.key === "ArrowRight"
                                ? step
                                : 0) +
                            540) %
                            360) -
                            180,
                          Math.max(
                            -90,
                            Math.min(
                              90,
                              old.pitch +
                                (event.key === "ArrowUp"
                                  ? step
                                  : event.key === "ArrowDown"
                                    ? -step
                                    : 0),
                            ),
                          ),
                          h.kind === "polygon" ? index : -1,
                        );
                      } else if (event.key === "Enter") {
                        setSelected(h.id);
                        event.preventDefault();
                      }
                    }}
                  />
                ))}
              </g>
            );
          })}
        </svg>
      </AssetPlane>
      {hotspot && (
        <fieldset>
          <legend>{hotspot.name} · 精确角度（度）</legend>
          {(["yaw", "pitch"] as const).map((key) => (
            <label key={key}>
              {key}
              <input
                type="number"
                step={0.1}
                min={key === "yaw" ? -180 : -90}
                max={key === "yaw" ? 180 : 90}
                value={hotspot[key]}
                onChange={(e) => {
                  const value = e.currentTarget.valueAsNumber;
                  if (Number.isFinite(value))
                    move(
                      hotspot.id,
                      key === "yaw" ? value : hotspot.yaw,
                      key === "pitch" ? value : hotspot.pitch,
                    );
                }}
              />
            </label>
          ))}
          <button
            onClick={() =>
              edit("删除球面热点", (g) => {
                g.nodes.find((n) => n.id === node.id)!.hotspots = g.nodes
                  .find((n) => n.id === node.id)!
                  .hotspots.filter((h) => h.id !== selected);
              })
            }
          >
            删除热点
          </button>
        </fieldset>
      )}
    </>
  );
}
