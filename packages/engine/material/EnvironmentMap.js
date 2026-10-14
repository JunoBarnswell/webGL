import * as THREE from 'three';

/**
 * EnvironmentMap: Manages loading and caching of 6-sided CubeTexture skyboxes
 */
export class EnvironmentMap {
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
    this.loader = new THREE.CubeTextureLoader();
    this.cache = new Map();
  }

  setBaseUrl(url) {
    this.baseUrl = url;
  }

  /**
   * Load a CubeMap from folder
   * @param {string} cubeFolder relative folder name, e.g. "87b4687c"
   * @returns {Promise<THREE.CubeTexture>}
   */
  async loadCubeMap(cubeFolder) {
    if (this.cache.has(cubeFolder)) {
      return this.cache.get(cubeFolder);
    }

    const basePath = this.baseUrl ? `${this.baseUrl}/image/${cubeFolder}`.replace(/([^:]\/)\/+/g, '$1') : `image/${cubeFolder}`;
    const urls = [
      `${basePath}/posx.jpg`,
      `${basePath}/negx.jpg`,
      `${basePath}/posy.jpg`,
      `${basePath}/negy.jpg`,
      `${basePath}/posz.jpg`,
      `${basePath}/negz.jpg`
    ];

    return new Promise((resolve) => {
      this.loader.load(
        urls,
        (cubeTexture) => {
          cubeTexture.colorSpace = THREE.SRGBColorSpace;
          this.cache.set(cubeFolder, cubeTexture);
          resolve(cubeTexture);
        },
        undefined,
        (err) => {
          console.warn(`[EnvironmentMap] Failed to load cube map ${cubeFolder}:`, err);
          resolve(null);
        }
      );
    });
  }
}
