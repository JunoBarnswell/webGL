import {
  directionAngles,
  sphericalDirection,
  type ProjectManifest,
} from "./core";
import type { CameraPose } from "../../scene-runtime/src/RuntimeState";
export interface ProjectLocation {
  projectId: string;
  versionId: string;
  nodeId: string;
  locale: string;
  hotspotId: string;
  yaw: number;
  pitch: number;
  fov: number;
  position?: [number, number, number];
  target?: [number, number, number];
}
const numeric = (
  params: URLSearchParams,
  key: string,
  fallback: number,
  min: number,
  max: number,
) => {
  const text = params.get(key);
  if (text === null) return fallback;
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text))
    throw Error("深链接参数必须为有限数值：" + key);
  const value = Number(text);
  if (!Number.isFinite(value) || value < min || value > max)
    throw Error("深链接参数越界：" + key);
  return value;
};
export function readProjectLocation(
  url: URL,
  manifest: ProjectManifest,
): ProjectLocation {
  const params = url.searchParams,
    allowed = new Set([
      "project",
      "version",
      "node",
      "locale",
      "hotspot",
      "yaw",
      "pitch",
      "fov",
      "position",
      "target",
    ]);
  for (const key of params.keys())
    if (!allowed.has(key) || params.getAll(key).length !== 1)
      throw Error("深链接参数重复或不支持：" + key);
  if (
    params.get("project") !== manifest.projectId ||
    (params.has("version") && params.get("version") !== manifest.versionId)
  )
    throw Error("深链接项目修订不匹配");
  const nodeId = params.get("node") ?? manifest.document.entryNodeId,
    node = manifest.document.nodes.find((n) => n.id === nodeId);
  if (!node) throw Error("深链接节点不属于固定项目修订");
  const locale =
    params.get("locale") ?? manifest.document.locales?.[0] ?? "zh-CN";
  if (
    !(
      manifest.document.locales?.length ? manifest.document.locales : ["zh-CN"]
    ).includes(locale)
  )
    throw Error("深链接语言不属于项目");
  const hotspotId = params.get("hotspot") ?? "";
  if (hotspotId && !node.hotspots.some((h) => h.id === hotspotId))
    throw Error("深链接热点不属于节点");
  const direction = node.camera.target.map(
      (value, i) => value - node.camera.position[i],
    ) as [number, number, number],
    angles =
      node.kind === "scene3d"
        ? directionAngles(direction)
        : { yaw: node.heading, pitch: node.pitch };
  const vector = (key: string): [number, number, number] | undefined => {
    const text = params.get(key);
    if (text === null) return;
    const parts = text.split(",");
    if (parts.length !== 3) throw Error("深链接相机向量必须为三维：" + key);
    return parts.map((value, i) =>
      numeric(
        new URLSearchParams([[String(i), value]]),
        String(i),
        0,
        -1e12,
        1e12,
      ),
    ) as [number, number, number];
  };
  const position = vector("position"),
    target = vector("target");
  if (Boolean(position) !== Boolean(target))
    throw Error("深链接相机位置和目标必须同时提供");
  if (position && target)
    directionAngles(
      target.map((v, i) => v - position[i]) as [number, number, number],
    );
  return {
    projectId: manifest.projectId,
    versionId: manifest.versionId,
    nodeId,
    locale,
    hotspotId,
    yaw: numeric(params, "yaw", angles.yaw, -180, 180),
    pitch: numeric(params, "pitch", angles.pitch, -90, 90),
    fov: numeric(params, "fov", node.fov, 1, 179),
    position,
    target,
  };
}
export function locationPose(
  location: ProjectLocation,
  current: CameraPose,
): CameraPose {
  const position = location.position ?? current.position,
    distance = location.target
      ? Math.hypot(...location.target.map((v, i) => v - position[i]))
      : 1000;
  return {
    position: [...position],
    target: sphericalDirection(location.yaw, location.pitch).map(
      (v, i) => position[i] + v * distance,
    ) as [number, number, number],
    fov: location.fov,
  };
}
export function projectLocationUrl(base: URL, location: ProjectLocation): URL {
  const url = new URL(base);
  url.search = "";
  url.hash = "";
  for (const [key, value] of Object.entries({
    project: location.projectId,
    version: location.versionId,
    node: location.nodeId,
    locale: location.locale,
    hotspot: location.hotspotId,
    yaw: location.yaw,
    pitch: location.pitch,
    fov: location.fov,
    position: location.position?.join(","),
    target: location.target?.join(","),
  }))
    if (value !== undefined && value !== "")
      url.searchParams.set(key, String(value));
  return url;
}
