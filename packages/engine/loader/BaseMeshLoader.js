/**
 * BaseMeshLoader: Abstract interface for geometry loaders
 */
export class BaseMeshLoader {
  constructor() {
    if (new.target === BaseMeshLoader) {
      throw new TypeError('Cannot construct BaseMeshLoader instances directly.');
    }
  }

  /**
   * Load and decode a mesh from ArrayBuffer or URL
   * @param {ArrayBuffer} buffer
   * @returns {THREE.BufferGeometry}
   */
  decode(buffer) {
    throw new Error('decode() must be implemented by subclass');
  }

  /**
   * Fetch and decode from URL
   * @param {string} url
   * @returns {Promise<THREE.BufferGeometry>}
   */
  async load(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load mesh from ${url}: ${res.statusText}`);
    const buffer = await res.arrayBuffer();
    return this.decode(buffer);
  }
}
