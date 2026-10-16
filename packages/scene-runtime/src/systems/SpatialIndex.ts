import * as THREE from "three";
interface Entry {
  object: THREE.Mesh;
  bounds: THREE.Box3;
  center: THREE.Vector3;
}
interface Node {
  bounds: THREE.Box3;
  left?: Node;
  right?: Node;
  entries?: Entry[];
}
/** Broad phase BVH; narrow phase remains Three's authoritative geometry raycaster. */
export class SpatialIndex {
  private tree?: Node;
  private dirty = true;
  invalidate(): void {
    this.dirty = true;
    this.tree = undefined;
  }
  clear(): void {
    this.tree = undefined;
    this.dirty = true;
  }
  raycast(
    root: THREE.Object3D,
    ray: THREE.Raycaster,
    visible: (object: THREE.Object3D) => boolean,
  ): THREE.Intersection[] {
    if (this.dirty) {
      root.updateWorldMatrix(true, true);
      const entries: Entry[] = [];
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh) || object.userData.collider) return;
        let local: THREE.Box3 | null;
        if (object instanceof THREE.SkinnedMesh) {
          object.skeleton.update();
          object.computeBoundingBox();
          local = object.boundingBox;
        } else {
          if (!object.geometry.boundingBox)
            object.geometry.computeBoundingBox();
          local = object.geometry.boundingBox;
        }
        if (local) {
          const bounds = local.clone().applyMatrix4(object.matrixWorld);
          entries.push({
            object,
            bounds,
            center: bounds.getCenter(new THREE.Vector3()),
          });
        }
      });
      this.tree = this.build(entries);
      this.dirty = false;
    }
    const candidates: THREE.Object3D[] = [];
    const visit = (node: Node) => {
      if (!ray.ray.intersectsBox(node.bounds)) return;
      if (node.entries) {
        for (const entry of node.entries)
          if (visible(entry.object) && ray.ray.intersectsBox(entry.bounds))
            candidates.push(entry.object);
      } else {
        if (node.left) visit(node.left);
        if (node.right) visit(node.right);
      }
    };
    if (this.tree) visit(this.tree);
    return ray
      .intersectObjects(candidates, false)
      .filter((hit) => hit.distance >= ray.near && hit.distance <= ray.far);
  }
  private build(entries: Entry[]): Node | undefined {
    if (!entries.length) return undefined;
    const bounds = new THREE.Box3();
    for (const entry of entries) bounds.union(entry.bounds);
    if (entries.length <= 8) return { bounds, entries };
    const size = bounds.getSize(new THREE.Vector3());
    const axis =
      size.x >= size.y && size.x >= size.z ? "x" : size.y >= size.z ? "y" : "z";
    entries.sort((a, b) => a.center[axis] - b.center[axis]);
    const mid = Math.floor(entries.length / 2);
    return {
      bounds,
      left: this.build(entries.slice(0, mid)),
      right: this.build(entries.slice(mid)),
    };
  }
}
