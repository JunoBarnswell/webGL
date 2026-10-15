/**
 * ResourceRegistry.js
 * 统一 GPU 资源生命周期管理与引用计数系统
 * 
 * 职责：
 * 1. 跟踪 Geometry, Material, Texture 的引用计数 (Reference Counting)
 * 2. 避免共享资源在某个实例卸载时被过早 dispose()
 * 3. 当引用计数归零时安全销毁 GPU 显存资源
 * 4. 场景切换或引擎销毁时提供集中式的安全清理 (Safe Eviction)
 */
export class ResourceRegistry {
  constructor() {
    // 资源对象 -> 引用计数
    this._refCounts = new Map();
    // 命名标识 -> 资源对象映射
    this._namedResources = new Map();
  }

  /**
   * 注册并增加资源的引用计数
   * @param {string|THREE.BufferGeometry|THREE.Material|THREE.Texture} resourceOrKey 
   * @param {Object} [resource] 
   * @returns {Object} 注册的资源
   */
  retain(resourceOrKey, resource = null) {
    let target = resource;
    let key = null;

    if (typeof resourceOrKey === 'string') {
      key = resourceOrKey;
      if (!target && this._namedResources.has(key)) {
        target = this._namedResources.get(key);
      } else if (target) {
        this._namedResources.set(key, target);
      }
    } else {
      target = resourceOrKey;
    }

    if (!target) return null;

    const count = this._refCounts.get(target) || 0;
    this._refCounts.set(target, count + 1);

    return target;
  }

  /**
   * 释放资源引用。当引用计数降至 0 时，执行真正的 dispose()
   * @param {string|THREE.BufferGeometry|THREE.Material|THREE.Texture} resourceOrKey 
   * @returns {boolean} 是否真正触发了底层 dispose
   */
  release(resourceOrKey) {
    let target = resourceOrKey;
    let key = null;

    if (typeof resourceOrKey === 'string') {
      key = resourceOrKey;
      target = this._namedResources.get(key);
    }

    if (!target || !this._refCounts.has(target)) {
      return false;
    }

    const currentCount = this._refCounts.get(target);
    const newCount = currentCount - 1;

    if (newCount > 0) {
      this._refCounts.set(target, newCount);
      return false;
    }

    // 引用计数归零，彻底释放 GPU 资源
    this._refCounts.delete(target);
    if (key) {
      this._namedResources.delete(key);
    }

    this._safeDispose(target);
    return true;
  }

  /**
   * 安全释放单个 Three.js 资源（包括递归释放 Material 内部的贴图）
   * @private
   */
  _safeDispose(obj) {
    if (!obj) return;

    if (typeof obj.dispose === 'function') {
      try {
        // 如果是 Material，释放其绑定的纹理引用
        if (obj.isMaterial) {
          for (const propName of Object.keys(obj)) {
            const val = obj[propName];
            if (val && val.isTexture) {
              this.release(val);
            }
          }
        }
        obj.dispose();
      } catch (e) {
        console.warn('ResourceRegistry: Error during dispose:', e);
      }
    }
  }

  /**
   * 递归注册一个 Object3D 及其子节点下的全部 Geometry、Material 与 Texture
   * @param {THREE.Object3D} root 
   */
  retainHierarchy(root) {
    if (!root) return;
    root.traverse((node) => {
      if (node.isMesh) {
        if (node.geometry) this.retain(node.geometry);
        if (node.material) {
          if (Array.isArray(node.material)) {
            node.material.forEach((mat) => {
              this.retain(mat);
              this._retainMaterialTextures(mat);
            });
          } else {
            this.retain(node.material);
            this._retainMaterialTextures(node.material);
          }
        }
      }
    });
  }

  /**
   * 递归释放一个 Object3D 及其子节点的资源引用
   * @param {THREE.Object3D} root 
   */
  releaseHierarchy(root) {
    if (!root) return;
    root.traverse((node) => {
      if (node.isMesh) {
        if (node.geometry) this.release(node.geometry);
        if (node.material) {
          if (Array.isArray(node.material)) {
            node.material.forEach((mat) => {
              this._releaseMaterialTextures(mat);
              this.release(mat);
            });
          } else {
            this._releaseMaterialTextures(node.material);
            this.release(node.material);
          }
        }
      }
    });
  }

  _retainMaterialTextures(mat) {
    if (!mat) return;
    for (const key of Object.keys(mat)) {
      const val = mat[key];
      if (val && val.isTexture) {
        this.retain(val);
      }
    }
  }

  _releaseMaterialTextures(mat) {
    if (!mat) return;
    for (const key of Object.keys(mat)) {
      const val = mat[key];
      if (val && val.isTexture) {
        this.release(val);
      }
    }
  }

  /**
   * 获取当前资源的引用计数值
   */
  getRefCount(resource) {
    return this._refCounts.get(resource) || 0;
  }

  /**
   * 打印当前资源托管摘要
   */
  getStats() {
    let geometries = 0;
    let materials = 0;
    let textures = 0;
    let others = 0;

    for (const [res] of this._refCounts) {
      if (res.isBufferGeometry) geometries++;
      else if (res.isMaterial) materials++;
      else if (res.isTexture) textures++;
      else others++;
    }

    return {
      totalTracked: this._refCounts.size,
      geometries,
      materials,
      textures,
      others
    };
  }

  /**
   * 清理全部资源
   */
  clear() {
    for (const [res] of this._refCounts) {
      try {
        if (typeof res.dispose === 'function') {
          res.dispose();
        }
      } catch (err) {
        // ignore
      }
    }
    this._refCounts.clear();
    this._namedResources.clear();
  }
}
