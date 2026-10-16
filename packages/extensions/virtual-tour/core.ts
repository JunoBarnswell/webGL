import type {
  SceneAsset,
  Vec3,
  BehaviorAction,
} from "../../scene-schema/src/types";
import type { CameraPose } from "../../scene-runtime/src/RuntimeState";
export interface TourHotspot {
  id: string;
  name: string;
  kind: "point" | "text" | "image" | "polygon" | "video";
  yaw: number;
  pitch: number;
  points: { yaw: number; pitch: number }[];
  toNodeId: string;
  contentId: string;
  assetId: string;
  text: string;
  alt: string;
  color: string;
}
export interface TourNode {
  id: string;
  name: string;
  kind: "scene3d" | "panorama" | "pano-video";
  sceneId: string;
  sceneVersionId: string;
  assetId: string;
  floorId: string;
  floorX: number;
  floorY: number;
  heading: number;
  pitch: number;
  fov: number;
  camera: CameraPose;
  hotspots: TourHotspot[];
  thumbnailAssetId: string;
}
export interface ProjectGraph {
  name: string;
  entryNodeId: string;
  nodes: TourNode[];
  floors: {
    id: string;
    name: string;
    assetId: string;
    calibrated: boolean;
    north: number;
    mmPerPixel: number;
  }[];
  links: {
    id: string;
    fromNodeId: string;
    toNodeId: string;
    transition: string;
    reverseLinkId: string;
  }[];
  routes: {
    id: string;
    name: string;
    loop: boolean;
    stops: {
      id: string;
      nodeId: string;
      hold: number;
      heading: number;
      pitch: number;
      actions?: BehaviorAction[];
      audioAssetId?: string;
      waitForMedia?: boolean;
    }[];
  }[];
  skinLayoutId: string;
  skinSceneId: string;
  skinSceneVersionId: string;
  assets: SceneAsset[];
}
export interface ProjectManifest {
  versionId: string;
  projectId: string;
  graphVersionId: string;
  document: ProjectGraph;
  sceneVersions: Record<string, string>;
  assets: SceneAsset[];
  publishedAt: string;
  runtimeBuild: string;
  extensionCatalogHash?: string;
}
export const emptyProject = (): ProjectGraph => ({
  name: "新项目",
  entryNodeId: "",
  nodes: [],
  floors: [],
  links: [],
  routes: [],
  skinLayoutId: "hud-default",
  skinSceneId: "",
  skinSceneVersionId: "",
  assets: [],
});
export function newTourNode(
  name: string,
  kind: TourNode["kind"] = "scene3d",
): TourNode {
  return {
    id: crypto.randomUUID(),
    name,
    kind,
    sceneId: "",
    sceneVersionId: "",
    assetId: "",
    floorId: "",
    floorX: 0.5,
    floorY: 0.5,
    heading: 0,
    pitch: 0,
    fov: 60,
    camera: { position: [0, 1000, 3000], target: [0, 0, 0], fov: 60 },
    hotspots: [],
    thumbnailAssetId: "",
  };
}
export function sphericalDirection(yaw: number, pitch: number): Vec3 {
  const y = (yaw * Math.PI) / 180,
    p = (pitch * Math.PI) / 180;
  return [Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)];
}
export function directionAngles(direction: Vec3): {
  yaw: number;
  pitch: number;
} {
  const length = Math.hypot(...direction);
  return {
    yaw: (Math.atan2(direction[0], -direction[2]) * 180) / Math.PI,
    pitch:
      (Math.asin(Math.max(-1, Math.min(1, direction[1] / length))) * 180) /
      Math.PI,
  };
}
export function polygonContains(
  points: { yaw: number; pitch: number }[],
  yaw: number,
  pitch: number,
): boolean {
  const unwrap = (value: number) => ((value - yaw + 540) % 360) - 180;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = { x: unwrap(points[i].yaw), y: points[i].pitch },
      b = { x: unwrap(points[j].yaw), y: points[j].pitch };
    if (
      a.y > pitch !== b.y > pitch &&
      0 < ((b.x - a.x) * (pitch - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
export function validateProject(
  graph: ProjectGraph,
  complete = false,
): string[] {
  const errors: string[] = [],
    ids = new Set(graph.nodes.map((n) => n.id)),
    floors = new Set(graph.floors.map((f) => f.id));
  if (ids.size !== graph.nodes.length) errors.push("节点 ID 重复");
  if (complete && !ids.has(graph.entryNodeId)) errors.push("入口节点不存在");
  for (const node of graph.nodes) {
    if (node.floorId && !floors.has(node.floorId))
      errors.push(node.name + " 楼层不存在");
    if (
      complete &&
      (node.kind === "scene3d"
        ? !node.sceneId
        : !graph.assets.some((a) => a.id === node.assetId))
    )
      errors.push(node.name + " 缺少场景或媒体");
    for (const h of node.hotspots) {
      if (h.toNodeId && !ids.has(h.toNodeId)) errors.push(h.name + " 跳转断链");
      if (complete && h.kind === "polygon" && h.points.length < 3)
        errors.push(h.name + " 多边形顶点不足");
    }
  }
  for (const link of graph.links)
    if (
      (link.fromNodeId ? !ids.has(link.fromNodeId) : complete) ||
      (link.toNodeId ? !ids.has(link.toNodeId) : complete)
    )
      errors.push("连接断链");
  for (const route of graph.routes)
    for (const stop of route.stops)
      if (stop.nodeId ? !ids.has(stop.nodeId) : complete)
        errors.push("路线节点不存在");
  return errors;
}
