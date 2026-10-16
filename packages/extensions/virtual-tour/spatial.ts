import type { ProjectGraph } from "./core";
type Floor = ProjectGraph["floors"][number];
export function calibrateFloor(
  floor: Floor,
  a: [number, number],
  b: [number, number],
  millimetres: number,
  width: number,
  height: number,
): Floor {
  const pixels = Math.hypot((a[0] - b[0]) * width, (a[1] - b[1]) * height);
  if (
    !Number.isFinite(millimetres) ||
    millimetres <= 0 ||
    !Number.isFinite(pixels) ||
    pixels < 1 ||
    width <= 0 ||
    height <= 0
  )
    throw Error("标定需要两个不同图像点、图像尺寸和正的毫米距离");
  return {
    ...floor,
    calibrated: true,
    imageWidth: width,
    imageHeight: height,
    mmPerPixel: millimetres / pixels,
  };
}
export function floorToWorld(
  floor: Floor,
  x: number,
  y: number,
): [number, number] {
  if (!floor.calibrated || !floor.imageWidth || !floor.imageHeight)
    throw Error("地图尚未完成尺寸标定");
  const dx = (x - (floor.originX ?? 0.5)) * floor.imageWidth * floor.mmPerPixel,
    dz = (y - (floor.originY ?? 0.5)) * floor.imageHeight * floor.mmPerPixel,
    r = ((floor.rotation ?? 0) * Math.PI) / 180;
  return [
    dx * Math.cos(r) - dz * Math.sin(r),
    dx * Math.sin(r) + dz * Math.cos(r),
  ];
}
export function worldToFloor(
  floor: Floor,
  x: number,
  z: number,
): [number, number] {
  floorToWorld(floor, 0, 0);
  const r = (-(floor.rotation ?? 0) * Math.PI) / 180;
  return [
    (x * Math.cos(r) - z * Math.sin(r)) /
      (floor.imageWidth! * floor.mmPerPixel) +
      (floor.originX ?? 0.5),
    (x * Math.sin(r) + z * Math.cos(r)) /
      (floor.imageHeight! * floor.mmPerPixel) +
      (floor.originY ?? 0.5),
  ];
}
export function nodePosition(
  graph: ProjectGraph,
  id: string,
): { x: number; y: number } {
  return (
    graph.diagram?.positions.find((p) => p.nodeId === id) ?? {
      x: 40 + (graph.nodes.findIndex((n) => n.id === id) % 5) * 210,
      y: 40 + Math.floor(graph.nodes.findIndex((n) => n.id === id) / 5) * 130,
    }
  );
}
export function ensureDiagram(
  graph: ProjectGraph,
): NonNullable<ProjectGraph["diagram"]> {
  return (graph.diagram ??= {
    positions: [],
    groups: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  });
}
export function nodeUses(graph: ProjectGraph, ids: Set<string>): string[] {
  return [
    ...(ids.has(graph.entryNodeId) ? ["项目入口"] : []),
    ...graph.links
      .filter((l) => ids.has(l.fromNodeId) || ids.has(l.toNodeId))
      .map((l) => "连接 " + l.id),
    ...graph.nodes
      .filter((n) => !ids.has(n.id))
      .flatMap((n) =>
        n.hotspots
          .filter((h) => ids.has(h.toNodeId))
          .map((h) => "热点 " + n.name + " / " + h.name),
      ),
    ...graph.routes.flatMap((r) =>
      r.stops.filter((s) => ids.has(s.nodeId)).map(() => "路线 " + r.name),
    ),
  ];
}
export function removeProjectNodes(
  graph: ProjectGraph,
  ids: Set<string>,
): void {
  const uses = nodeUses(graph, ids);
  if (uses.length) throw Error("节点仍被引用，请先修改：" + uses.join("；"));
  graph.nodes = graph.nodes.filter((n) => !ids.has(n.id));
  if (graph.diagram) {
    graph.diagram.positions = graph.diagram.positions.filter(
      (p) => !ids.has(p.nodeId),
    );
    for (const group of graph.diagram.groups)
      group.nodeIds = group.nodeIds.filter((id) => !ids.has(id));
  }
}
