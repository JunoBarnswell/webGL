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

  async loadTexture(relativePath, isLinear = false) {
    if (!relativePath) return null;
    const fullPath = this.baseUrl ? `${this.baseUrl}/${relativePath}`.replace(/([^:]\/)\/+/g, '$1') : relativePath;

    if (this.textureCache.has(fullPath)) {
      return this.textureCache.get(fullPath);
    }

    return new Promise((resolve) => {
      this.textureLoader.load(
        fullPath,
        (tex) => {
          tex.colorSpace = isLinear ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
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
   * Create automotive clearcoat PBR material
   * @param {number|string} color
   * @param {number} metalness
   * @param {number} roughness
   * @returns {THREE.MeshPhysicalMaterial}
   */
  static createCarPaintMaterial(color = 0x223344, metalness = 0.85, roughness = 0.12) {
    return new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(color),
      metalness,
      roughness,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      reflectivity: 0.9,
      envMapIntensity: 1.5
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

    const isPhysical = def.type === 'MeshPhysicalMaterial' || def.clearcoat !== undefined;
    const isStandard = isPhysical || def.type === 'MeshStandardMaterial';
    const params = {
      color: def.color !== undefined ? def.color : 0xffffff,
      transparent: def.transparent || false,
      opacity: def.opacity !== undefined ? def.opacity : 1.0,
      side: def.side !== undefined ? def.side : THREE.FrontSide,
      depthTest: def.depthTest !== undefined ? def.depthTest : true,
      depthWrite: def.depthWrite !== undefined ? def.depthWrite : true
    };

    let material;
    if (isPhysical) {
      params.roughness = def.roughness !== undefined ? def.roughness : 0.15;
      params.metalness = def.metalness !== undefined ? def.metalness : 0.8;
      params.clearcoat = def.clearcoat !== undefined ? def.clearcoat : 1.0;
      params.clearcoatRoughness = def.clearcoatRoughness !== undefined ? def.clearcoatRoughness : 0.05;
      params.envMapIntensity = def.envMapIntensity !== undefined ? def.envMapIntensity : 1.2;
      material = new THREE.MeshPhysicalMaterial(params);
    } else if (isStandard) {
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
      const tex = await this.loadTexture(def.map.name, false);
      if (tex) {
        if (def.map.offset) tex.offset.set(def.map.offset.x, def.map.offset.y);
        if (def.map.repeat) tex.repeat.set(def.map.repeat.x, def.map.repeat.y);
        material.map = tex;
      }
    }

    // 2. ORM composite map (Red: AO, Green: Roughness, Blue: Metalness) - Blender glTF Standard
    if (isStandard && def.ormMap && def.ormMap.name) {
      const ormTex = await this.loadTexture(def.ormMap.name, true);
      if (ormTex) {
        material.aoMap = ormTex;
        material.roughnessMap = ormTex;
        material.metalnessMap = ormTex;
        material.aoMapIntensity = def.ormMap.aoIntensity !== undefined ? def.ormMap.aoIntensity : 1.0;
      }
    }

    // 3. Normal Map
    if (isStandard && def.normalMap && def.normalMap.name) {
      const normalTex = await this.loadTexture(def.normalMap.name, true);
      if (normalTex) {
        material.normalMap = normalTex;
        if (def.normalScale) {
          material.normalScale.set(def.normalScale.x || 1, def.normalScale.y || 1);
        }
      }
    }

    // 4. Baked Lightmap
    if (def.lightMap && def.lightMap.name) {
      await this.lightmapManager.applyLightmap(material, def.lightMap);
    }

    // 5. Environment Reflection CubeMap
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

