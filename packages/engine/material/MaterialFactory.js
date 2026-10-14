import * as THREE from 'three';

/**
 * MaterialFactory: Creates and configures Three.js materials matching O2VR specifications
 */
export class MaterialFactory {
  constructor(lightmapManager, envMapManager, baseUrl = '') {
    this.lightmapManager = lightmapManager;
    this.envMapManager = envMapManager;
    this.baseUrl = baseUrl;
    this.textureLoader = new THREE.TextureLoader();
    this.textureCache = new Map();
  }

  setBaseUrl(url) {
    this.baseUrl = url;
  }

  async loadTexture(relativePath) {
    if (!relativePath) return null;
    const fullPath = this.baseUrl ? `${this.baseUrl}/${relativePath}`.replace(/([^:]\/)\/+/g, '$1') : relativePath;

    if (this.textureCache.has(fullPath)) {
      return this.textureCache.get(fullPath);
    }

    return new Promise((resolve) => {
      this.textureLoader.load(
        fullPath,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
          this.textureCache.set(fullPath, tex);
          resolve(tex);
        },
        undefined,
        () => resolve(null)
      );
    });
  }

  /**
   * Create material from scene.json material specification
   * @param {object} def
   * @returns {Promise<THREE.Material>}
   */
  async createMaterial(def) {
    if (!def) {
      return new THREE.MeshPhongMaterial({ color: 0xcccccc });
    }

    const isStandard = def.type === 'MeshStandardMaterial';
    const params = {
      color: def.color !== undefined ? def.color : 0xffffff,
      transparent: def.transparent || false,
      opacity: def.opacity !== undefined ? def.opacity : 1.0,
      side: def.side !== undefined ? def.side : THREE.FrontSide,
      depthTest: def.depthTest !== undefined ? def.depthTest : true,
      depthWrite: def.depthWrite !== undefined ? def.depthWrite : true
    };

    let material;
    if (isStandard) {
      params.roughness = def.roughness !== undefined ? def.roughness : 0.5;
      params.metalness = def.metalness !== undefined ? def.metalness : 0.1;
      material = new THREE.MeshStandardMaterial(params);
    } else {
      params.shininess = def.shininess !== undefined ? def.shininess : 1.0;
      params.specular = def.specular !== undefined ? def.specular : 0x111111;
      params.reflectivity = def.reflectivity !== undefined ? def.reflectivity : 0.0;
      material = new THREE.MeshPhongMaterial(params);
    }

    // 1. Diffuse map
    if (def.map && def.map.name && !def.map.o2_default) {
      const tex = await this.loadTexture(def.map.name);
      if (tex) {
        if (def.map.offset) tex.offset.set(def.map.offset.x, def.map.offset.y);
        if (def.map.repeat) tex.repeat.set(def.map.repeat.x, def.map.repeat.y);
        material.map = tex;
      }
    }

    // 2. Baked Lightmap
    if (def.lightMap && def.lightMap.name) {
      await this.lightmapManager.applyLightmap(material, def.lightMap);
    }

    // 3. Environment Reflection CubeMap
    if (def.cube_info && def.cube_info.url) {
      const cubeTex = await this.envMapManager.loadCubeMap(def.cube_info.url);
      if (cubeTex) {
        material.envMap = cubeTex;
        material.combine = THREE.MultiplyOperation;
      }
    }

    material.needsUpdate = true;
    return material;
  }
}
