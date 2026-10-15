/** Explicit resource owners; material disposal never implicitly decrements textures. */
export class ResourceRegistry {
  constructor() { this.counts = new Map(); }
  retain(resource) {
    if (!resource) return null;
    if (typeof resource !== 'object') throw new TypeError('ResourceRegistry requires a resource object');
    this.counts.set(resource, (this.counts.get(resource) || 0) + 1);
    return resource;
  }
  release(resource) {
    const count = this.counts.get(resource);
    if (!count) return false;
    if (count > 1) { this.counts.set(resource, count - 1); return false; }
    this.counts.delete(resource);
    resource.dispose?.();
    return true;
  }
  collectObject(node) {
    const resources=new Set();
    if(node.geometry)resources.add(node.geometry);
    for(const material of Array.isArray(node.material)?node.material:node.material?[node.material]:[]) {
      resources.add(material);
      for(const value of Object.values(material))if(value?.isTexture)resources.add(value);
    }
    if(node.skeleton?.boneTexture)resources.add(node.skeleton.boneTexture);
    return resources;
  }
  collect(root, include = _node => true) {
    const resources=new Set();
    root.traverse(node=>{if(include(node))for(const resource of this.collectObject(node))resources.add(resource);});
    return resources;
  }
  retainHierarchy(root) { for (const resource of this.collect(root)) this.retain(resource); }
  releaseHierarchy(root) { for (const resource of this.collect(root)) this.release(resource); }
  getRefCount(resource) { return this.counts.get(resource) || 0; }
  getStats() {
    const all = [...this.counts.keys()];
    return { totalTracked: all.length, geometries: all.filter(r => r.isBufferGeometry).length, materials: all.filter(r => r.isMaterial).length, textures: all.filter(r => r.isTexture).length };
  }
  clear() { for (const resource of this.counts.keys()) resource.dispose?.(); this.counts.clear(); }
}
