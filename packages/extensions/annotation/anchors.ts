import * as THREE from "three";
import {
  getComponent,
  type SceneDocument,
  type SceneComponent,
  type Vec3,
} from "../../scene-schema/src/index";
import type { SceneRuntime } from "../../scene-runtime/src/SceneRuntime";
export interface AnchorResolution {
  world?: THREE.Vector3;
  entityId: string;
  reason?: string;
}
export function anchorProblem(
  document: SceneDocument,
  component: SceneComponent,
  ownerId?: string,
  entities?: ReadonlyMap<string, import("../../scene-schema/src/types").Entity>,
): string | undefined {
  const d = component.data,
    kind = String(d.anchorKind ?? "entity-local");
  if (kind === "world") return;
  const targetId = String(
    kind === "path-station" ? d.routeId : d.entityId || ownerId,
  );
  const entity = entities
    ? entities.get(targetId)
    : document.entities.find((e) => e.id === targetId);
  if (!entity) return "附着对象不存在";
  if (getComponent(entity, "ModelNode")?.data.sourceStatus === "unresolved")
    return "来源模型元素未匹配";
  if (kind === "surface") {
    const binding = getComponent(entity, "ModelNode");
    const mesh = getComponent(entity, "Mesh");
    const revision = String(
      binding?.data.meshRevision ||
        document.assets.find((a) => a.id === mesh?.data.assetId)?.sha256 ||
        "",
    );
    const identity = String(binding?.data.sourceElementId || entity.id);
    if (binding?.data.sourceStatus === "unresolved")
      return "来源模型元素未匹配";
    if (identity !== String(d.sourceElementId)) return "来源元素身份已改变";
    if (revision !== String(d.meshRevision))
      return "模型版本已改变，请重新选面";
  }
  if (kind === "path-station" && !getComponent(entity, "studio.piping.Segment"))
    return "路径管段不存在";
}
export function resolveAnchor(
  runtime: SceneRuntime,
  id: string,
  component: SceneComponent,
): AnchorResolution {
  const d = component.data;
  if (component.type === "Hotspot") {
    const object = runtime.getObject(id);
    if (!object) return { entityId: id, reason: "热点对象未加载" };
    return {
      entityId: id,
      world: new THREE.Vector3()
        .fromArray(d.offset as number[])
        .applyMatrix4(runtime.getEntityFrame(id)),
    };
  }
  const kind = String(d.anchorKind),
    entityId = String(d.entityId || id);
  if (kind === "world")
    return {
      entityId: id,
      world: new THREE.Vector3().fromArray(d.position as number[]),
    };
  const issue =
    runtime.document &&
    anchorProblem(runtime.document, component, id, runtime.index.entities);
  if (issue) return { entityId, reason: issue };
  const object = runtime.getObject(entityId);
  if (!object) return { entityId, reason: "附着对象未加载" };
  if (kind === "entity-local")
    return {
      entityId,
      world: new THREE.Vector3()
        .fromArray(d.position as number[])
        .applyMatrix4(runtime.getEntityFrame(entityId)),
    };
  if (kind === "path-station") {
    const route = runtime.index.entities.get(String(d.routeId)),
      segment = route && getComponent(route, "studio.piping.Segment");
    if (!segment) return { entityId, reason: "路径不存在" };
    return {
      entityId: String(d.routeId),
      world: new THREE.Vector3()
        .fromArray(segment.data.start as number[])
        .lerp(
          new THREE.Vector3().fromArray(segment.data.end as number[]),
          Number(d.station),
        )
        .applyMatrix4(runtime.getEntityFrame(route!.id)),
    };
  }
  const meshes: THREE.Mesh[] = [];
  object.traverse((node) => {
    if (node instanceof THREE.Mesh && !node.userData.collider)
      meshes.push(node);
  });
  const mesh = meshes[Number(d.primitiveIndex) || 0],
    positions = mesh?.geometry.getAttribute("position"),
    indices = mesh?.geometry.index;
  const triangle = Number(d.triangleIndex) * 3;
  if (
    !mesh ||
    !positions ||
    triangle + 2 >= (indices?.count ?? positions.count)
  )
    return { entityId, reason: "三角形已不存在" };
  const bary = d.barycentric as number[];
  if (!bary || Math.abs(bary.reduce((a, b) => a + b, 0) - 1) > 0.001)
    return { entityId, reason: "重心坐标无效" };
  const world = new THREE.Vector3();
  for (let i = 0; i < 3; i++)
    world.addScaledVector(
      new THREE.Vector3().fromBufferAttribute(
        positions,
        indices ? indices.getX(triangle + i) : triangle + i,
      ),
      bary[i],
    );
  mesh.updateWorldMatrix(true, false);
  world.applyMatrix4(mesh.matrixWorld);
  return { entityId, world };
}
export function surfaceAnchor(
  runtime: SceneRuntime,
  hit: THREE.Intersection,
):
  | {
      entityId: string;
      sourceElementId: string;
      meshRevision: string;
      triangleIndex: number;
      barycentric: Vec3;
      primitiveIndex: number;
    }
  | undefined {
  if (!(hit.object instanceof THREE.Mesh) || hit.faceIndex == null) return;
  let node: THREE.Object3D | null = hit.object;
  while (node && !node.userData.entityId) node = node.parent;
  const entityId = String(node?.userData.entityId ?? ""),
    entity = runtime.index.entities.get(entityId);
  if (!entity) return;
  const binding = getComponent(entity, "ModelNode"),
    component = getComponent(entity, "Mesh");
  const meshRevision = String(
    binding?.data.meshRevision ||
      runtime.document?.assets.find((a) => a.id === component?.data.assetId)
        ?.sha256 ||
      "",
  );
  if (!meshRevision) return;
  const geometry = hit.object.geometry,
    positions = geometry.getAttribute("position"),
    indices = geometry.index;
  const point = hit.object.worldToLocal(hit.point.clone()),
    vertices = [0, 1, 2].map((i) =>
      new THREE.Vector3().fromBufferAttribute(
        positions,
        indices ? indices.getX(hit.faceIndex! * 3 + i) : hit.faceIndex! * 3 + i,
      ),
    );
  const bary = THREE.Triangle.getBarycoord(
    point,
    vertices[0],
    vertices[1],
    vertices[2],
    new THREE.Vector3(),
  );
  if (!bary) return;
  const meshes: THREE.Mesh[] = [];
  node?.traverse((object) => {
    if (object instanceof THREE.Mesh && !object.userData.collider)
      meshes.push(object);
  });
  return {
    entityId,
    sourceElementId: String(binding?.data.sourceElementId || entityId),
    meshRevision,
    triangleIndex: hit.faceIndex,
    barycentric: bary.toArray(),
    primitiveIndex: meshes.indexOf(hit.object),
  };
}
