import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * ComponentMountSystem: 产品与零部件动态按需挂载系统（借鉴 ITW Automotive 的 addMeshTask 架构）
 * 
 * 功能：
 *  - 按需异步加载零件 glTF/GLB
 *  - 场景节点层级挂载与局部变换对齐
 *  - 动画混合器 (AnimationMixer) 驱动，支持独立零部件装配/拆解动画播放
 *  - 资源缓存与动态卸载管理
 */
export class ComponentMountSystem {
  constructor(scene, camera, events) {
    this.scene = scene;
    this.camera = camera;
    this.events = events;

    this.loader = new GLTFLoader();
    this._cache = new Map();   // url -> gltfData (原模型克隆源)
    this._mounted = new Map(); // id -> { group, mixer, actions }
    this.mixers = [];
  }

  /**
   * 挂载一个产品组件
   * @param {object} def 
   * @param {string} def.id - 零件唯一标识
   * @param {string} def.url - 模型相对路径或 URL
   * @param {string} [def.baseUrl] - 资源根路径
   * @param {{x: number, y: number, z: number}} [def.position] - 挂载位置
   * @param {{x: number, y: number, z: number}} [def.rotation] - 挂载旋转 (弧度)
   * @param {{x: number, y: number, z: number}} [def.scale] - 挂载缩放
   * @param {boolean} [def.autoPlayAnimation] - 是否自动播放首个动画
   * @param {THREE.Object3D} [parentObject] - 指定挂载的父节点（默认根场景）
   * @returns {Promise<THREE.Group>}
   */
  async mount(def, parentObject = null) {
    if (!def || !def.id) throw new Error('[ComponentMountSystem] Missing component definition or id');

    if (this._mounted.has(def.id)) {
      return this._mounted.get(def.id).group;
    }

    const fullUrl = def.baseUrl ? `${def.baseUrl}/${def.url}`.replace(/([^:]\/)\/+/g, '$1') : def.url;
    this.events?.emit('componentLoadStart', { id: def.id, url: fullUrl });

    try {
      let gltfData;
      if (this._cache.has(fullUrl)) {
        gltfData = this._cache.get(fullUrl);
      } else {
        gltfData = await this._loadGLTF(fullUrl);
        this._cache.set(fullUrl, gltfData);
      }

      // 克隆模型节点，避免多处使用状态冲突
      const group = gltfData.scene.clone(true);
      group.name = `component_${def.id}`;

      if (def.position) {
        group.position.set(def.position.x || 0, def.position.y || 0, def.position.z || 0);
      }
      if (def.rotation) {
        group.rotation.set(def.rotation.x || 0, def.rotation.y || 0, def.rotation.z || 0);
      }
      if (def.scale) {
        group.scale.set(def.scale.x || 1, def.scale.y || 1, def.scale.z || 1);
      }

      const targetParent = parentObject || this.scene;
      targetParent.add(group);

      // 处理动画
      let mixer = null;
      const actions = [];
      if (gltfData.animations && gltfData.animations.length > 0) {
        mixer = new THREE.AnimationMixer(group);
        this.mixers.push(mixer);

        for (const clip of gltfData.animations) {
          const action = mixer.clipAction(clip);
          actions.push(action);
        }

        if (def.autoPlayAnimation !== false && actions.length > 0) {
          actions[0].play();
        }
      }

      this._mounted.set(def.id, {
        def,
        group,
        mixer,
        actions
      });

      this.events?.emit('componentMounted', { id: def.id, group, def });
      return group;
    } catch (err) {
      console.error(`[ComponentMountSystem] Failed to mount component ${def.id}:`, err);
      this.events?.emit('componentLoadError', { id: def.id, error: err });
      throw err;
    }
  }

  /**
   * 卸载零件并释放网格几何体与材质资源
   * @param {string} id 
   */
  unmount(id) {
    const entry = this._mounted.get(id);
    if (!entry) return;

    const { group, mixer } = entry;

    if (mixer) {
      mixer.stopAllAction();
      const mixerIndex = this.mixers.indexOf(mixer);
      if (mixerIndex !== -1) {
        this.mixers.splice(mixerIndex, 1);
      }
    }

    if (group.parent) {
      group.parent.remove(group);
    }

    // 释放几何体与材质
    group.traverse((obj) => {
      if (obj.isMesh) {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      }
    });

    this._mounted.delete(id);
    this.events?.emit('componentUnmounted', { id });
  }

  /**
   * 触发播放指定零件的动画
   * @param {string} id 
   * @param {number} [animationIndex=0] 
   */
  playAnimation(id, animationIndex = 0) {
    const entry = this._mounted.get(id);
    if (!entry || !entry.actions || !entry.actions[animationIndex]) return;
    const action = entry.actions[animationIndex];
    action.reset();
    action.play();
  }

  /**
   * 每帧更新动画混合器（在 RenderLoop 中调用）
   * @param {number} delta 
   */
  update(delta) {
    for (const mixer of this.mixers) {
      mixer.update(delta);
    }
  }

  _loadGLTF(url) {
    return new Promise((resolve, reject) => {
      this.loader.load(url, resolve, undefined, reject);
    });
  }

  dispose() {
    for (const [id] of this._mounted) {
      this.unmount(id);
    }
    this._cache.clear();
  }
}
