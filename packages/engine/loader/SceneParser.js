import * as THREE from 'three';

/**
 * SceneParser: Parses scene.json, loads .mesh geometries and materials, and builds the 3D scene hierarchy
 */
export class SceneParser {
  constructor(meshLoader, materialFactory, baseUrl = '') {
    this.meshLoader = meshLoader;
    this.materialFactory = materialFactory;
    this.baseUrl = baseUrl;
  }

  setBaseUrl(url) {
    this.baseUrl = url;
    this.meshLoader.baseUrl = url;
    this.materialFactory.setBaseUrl(url);
  }

  /**
   * Parse scene.json and build full THREE hierarchy
   * @param {string|object} sceneSource URL or parsed JSON object
   * @param {Function} onProgress (percent, loadedCount, totalCount)
   * @returns {Promise<{ root: THREE.Group, colliObjects: THREE.Object3D[], groundObjects: THREE.Object3D[], meshMap: Map<string, THREE.Mesh> }>}
   */
  async parse(sceneSource, onProgress = null) {
    let data;
    if (typeof sceneSource === 'string') {
      const res = await fetch(sceneSource);
      if (!res.ok) throw new Error(`Failed to fetch scene.json: ${res.statusText}`);
      data = await res.json();
    } else {
      data = sceneSource;
    }

    const meshMap = new Map();
    const colliObjects = [];
    const groundObjects = [];

    // 1. Collect all nodes that need mesh loading
    const meshNodes = [];
    function collectMeshNodes(node) {
      if (node.meshid) meshNodes.push(node);
      if (node.children) {
        for (const child of node.children) collectMeshNodes(child);
      }
    }
    collectMeshNodes(data);

    const totalMeshes = meshNodes.length;
    let loadedMeshes = 0;

    // Helper to report progress
    const reportProgress = () => {
      loadedMeshes++;
      if (onProgress) {
        const percent = Math.min(Math.round((loadedMeshes / totalMeshes) * 100), 100);
        onProgress(percent, loadedMeshes, totalMeshes);
      }
    };

    // 2. Recursive node builder
    const buildNode = async (nodeDef) => {
      let object3D;

      if (nodeDef.meshid) {
        const meshUrl = this.baseUrl
          ? `${this.baseUrl}/${nodeDef.meshid}`.replace(/([^:]\/)\/+/g, '$1')
          : nodeDef.meshid;

        try {
          const geometry = await this.meshLoader.load(meshUrl);
          const material = await this.materialFactory.createMaterial(nodeDef.material);
          object3D = new THREE.Mesh(geometry, material);

          // Track in meshMap by UUID
          if (nodeDef.uuid) {
            meshMap.set(nodeDef.uuid, object3D);
          }
        } catch (err) {
          console.error(`Failed to load mesh ${nodeDef.meshid}:`, err);
          object3D = new THREE.Object3D();
        }
        reportProgress();
      } else {
        object3D = new THREE.Group();
      }

      object3D.name = nodeDef.name || '';
      object3D.uuid = nodeDef.uuid || object3D.uuid;

      // Apply transform matrix from wts or position/quaternion/scale
      if (nodeDef.wts && nodeDef.wts.elements) {
        const mat = new THREE.Matrix4();
        mat.fromArray(nodeDef.wts.elements);
        mat.decompose(object3D.position, object3D.quaternion, object3D.scale);
      } else {
        if (nodeDef.position) object3D.position.set(nodeDef.position.x, nodeDef.position.y, nodeDef.position.z);
        if (nodeDef.quaternion) object3D.quaternion.set(nodeDef.quaternion._x, nodeDef.quaternion._y, nodeDef.quaternion._z, nodeDef.quaternion._w);
        if (nodeDef.scale) object3D.scale.set(nodeDef.scale.x, nodeDef.scale.y, nodeDef.scale.z);
      }

      // Check collision/ground tags
      if (/colli/i.test(object3D.name)) {
        colliObjects.push(object3D);
        object3D.visible = false; // Invisible collision boundary
      }
      if (/ground|floor/i.test(object3D.name)) {
        groundObjects.push(object3D);
      }

      // Process children
      if (nodeDef.children && Array.isArray(nodeDef.children)) {
        for (const childDef of nodeDef.children) {
          const childObj = await buildNode(childDef);
          object3D.add(childObj);
        }
      }

      return object3D;
    };

    const root = await buildNode(data);
    root.updateMatrixWorld(true);

    return {
      root,
      colliObjects,
      groundObjects,
      meshMap
    };
  }
}
