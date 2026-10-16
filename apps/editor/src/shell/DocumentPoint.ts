import * as THREE from "three";
import { documentValue, type DocumentPath } from "@studio/editor-core";
import type { SceneRuntime } from "@studio/scene-runtime";
import type { Vec3, Viewpoint } from "@studio/scene-schema";
export interface DocumentPoint {
  path: DocumentPath;
  label: string;
  basis?: { entityId: string; space: "local" | "parent-offset" };
}
export function pointFrame(
  runtime: SceneRuntime,
  point: DocumentPoint,
): THREE.Matrix4 {
  if (!point.basis) return new THREE.Matrix4();
  if (point.basis.space === "local")
    return runtime.getEntityFrame(point.basis.entityId);
  const object = runtime.getObject(point.basis.entityId);
  if (!object) return new THREE.Matrix4();
  object.parent?.updateWorldMatrix(true, false);
  const entity = runtime.index.entities.get(point.basis.entityId);
  const units = entity ? runtime.sourceUnits(entity) : 1;
  return (object.parent?.matrixWorld.clone() ?? new THREE.Matrix4())
    .multiply(
      new THREE.Matrix4().makeTranslation(
        object.position.x,
        object.position.y,
        object.position.z,
      ),
    )
    .multiply(new THREE.Matrix4().makeScale(1 / units, 1 / units, 1 / units));
}
export function pointWorld(
  runtime: SceneRuntime,
  point: DocumentPoint,
): THREE.Vector3 | undefined {
  if (!runtime.document) return;
  const value = documentValue(runtime.document, point.path);
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some((v) => typeof v !== "number" || !Number.isFinite(v))
  )
    return;
  return new THREE.Vector3()
    .fromArray(value as Vec3)
    .applyMatrix4(pointFrame(runtime, point));
}
export function pointValue(
  runtime: SceneRuntime,
  point: DocumentPoint,
  world: THREE.Vector3,
): Vec3 {
  return world
    .clone()
    .applyMatrix4(pointFrame(runtime, point).invert())
    .toArray();
}
export function viewpointPoint(
  view: Viewpoint,
  property: "position" | "target",
): DocumentPoint {
  return {
    path: ["viewpoints", { id: view.id }, property],
    label: view.name + " · " + (property === "position" ? "位置" : "朝向"),
    ...(view.anchorId
      ? { basis: { entityId: view.anchorId, space: "local" as const } }
      : {}),
  };
}
