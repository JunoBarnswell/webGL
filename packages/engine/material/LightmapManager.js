import * as THREE from 'three';

/**
 * LightmapManager: Manages loading, caching and binding of baked lightmap textures
 */
export class LightmapManager {
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
    this.textureLoader = new THREE.TextureLoader();
    this.cache = new Map();
  }

  setBaseUrl(url) {
    this.baseUrl = url;
  }

  /**
   * Load lightmap texture
   * @param {string} relativePath e.g. "image/87b93cac.jpg"
   * @returns {Promise<THREE.Texture>}
   */
  async loadLightmap(relativePath) {
    const fullPath = this.baseUrl ? `${this.baseUrl}/${relativePath}`.replace(/([^:]\/)\/+/g, '$1') : relativePath;

    if (this.cache.has(fullPath)) {
      return this.cache.get(fullPath);
    }

    return new Promise((resolve, reject) => {
      this.textureLoader.load(
        fullPath,
        (texture) => {
          // Three.js r150+: lightmaps use channel 1 (maps to uv2)
          texture.channel = 1;
          texture.wrapS = THREE.ClampToEdgeWrapping;
          texture.wrapT = THREE.ClampToEdgeWrapping;
          texture.flipY = false;
          texture.generateMipmaps = true;
          texture.minFilter = THREE.LinearMipmapLinearFilter;
          texture.magFilter = THREE.LinearFilter;
          this.cache.set(fullPath, texture);
          resolve(texture);
        },
        undefined,
        (err) => {
          console.warn(`[LightmapManager] Failed to load lightmap: ${fullPath}`, err);
          resolve(null);
        }
      );
    });
  }

  /**
   * Apply lightmap to a material
   * @param {THREE.Material} material
   * @param {object} lightMapDef
   */
  async applyLightmap(material, lightMapDef) {
    if (!lightMapDef || !lightMapDef.name) return;
    const texture = await this.loadLightmap(lightMapDef.name);
    if (texture) {
      material.lightMap = texture;
      material.lightMapIntensity = 1.0;
      material.needsUpdate = true;
    }
  }

  dispose() {
    for (const [, texture] of this.cache) {
      if (texture && typeof texture.dispose === 'function') {
        texture.dispose();
      }
    }
    this.cache.clear();
  }
}
