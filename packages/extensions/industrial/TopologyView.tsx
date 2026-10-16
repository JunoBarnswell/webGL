import { systemTopology, type SemanticSystem } from "./core";
export function TopologyView({
  system,
  select,
}: {
  system: SemanticSystem;
  select: (sourceId: string) => void;
}) {
  const graph = systemTopology(system),
    positions = new Map(
      graph.nodes.map((port, index) => [
        port.id,
        { x: 35 + (index % 4) * 245, y: 40 + Math.floor(index / 4) * 110 },
      ]),
    );
  return (
    <section>
      <h3>
        {system.name} · {system.type}
      </h3>
      <p>
        {system.elementIds.length} 个成员 · {graph.nodes.length} 个端口 ·{" "}
        {graph.edges.length}{" "}
        条连接。箭头表示已知流向，双向箭头表示双向或未确定流向。
      </p>
      <svg
        className="industrial-topology"
        viewBox={`0 0 1000 ${Math.max(250, Math.ceil(graph.nodes.length / 4) * 110 + 70)}`}
        aria-label="系统端口拓扑"
        role="group"
      >
        <defs>
          <marker
            id="industrial-port-arrow"
            markerWidth={8}
            markerHeight={8}
            refX={7}
            refY={4}
            orient="auto-start-reverse"
          >
            <path d="M0 0L8 4L0 8Z" fill="#79cdb7" />
          </marker>
        </defs>
        {graph.edges.map((edge) => {
          const a = positions.get(edge.fromPortId),
            b = positions.get(edge.toPortId);
          return a && b ? (
            <g key={edge.id}>
              <path
                d={`M${a.x + 190} ${a.y + 35} C${a.x + 235} ${a.y + 35},${b.x - 45} ${b.y + 35},${b.x} ${b.y + 35}`}
                stroke="#79cdb7"
                fill="none"
                markerEnd="url(#industrial-port-arrow)"
                markerStart={
                  edge.direction === "both"
                    ? "url(#industrial-port-arrow)"
                    : undefined
                }
              />
              <text
                x={(a.x + b.x + 190) / 2}
                y={(a.y + b.y) / 2 + 20}
                fill="#acd4cf"
                fontSize={11}
              >
                {edge.kind}
              </text>
            </g>
          ) : null;
        })}
        {graph.nodes.map((port) => {
          const p = positions.get(port.id)!;
          return (
            <g
              role="button"
              tabIndex={0}
              aria-label={port.name + " " + port.direction}
              key={port.id}
              transform={`translate(${p.x} ${p.y})`}
              onClick={() => select(port.elementId)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  select(port.elementId);
                }
              }}
            >
              <rect
                width={190}
                height={70}
                rx={6}
                fill="#223d45"
                stroke="#64d6b7"
              />
              <text x={9} y={23} fill="#fff">
                {port.name.slice(0, 23)}
              </text>
              <text x={9} y={44} fill="#bdd5df" fontSize={11}>
                {port.direction} · {port.type}
              </text>
              <text x={9} y={61} fill="#bdd5df" fontSize={10}>
                {port.elementId.slice(-23)}
              </text>
            </g>
          );
        })}
      </svg>
      {graph.errors.map((error, i) => (
        <p role="alert" className="danger" key={i}>
          {error}
        </p>
      ))}
    </section>
  );
}
