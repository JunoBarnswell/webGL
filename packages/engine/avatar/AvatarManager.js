import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * AvatarManager: Loads 3D humanoid character, handles AnimationMixer state transitions (Idle, Walk, Run)
 * and spatial orientation
 */
export class AvatarManager {
  constructor(scene) {
    this.scene = scene;
    this.model = null;
    this.mixer = null;
    this.actions = new Map();
    this.activeAction = null;
    this.loader = new GLTFLoader();

    this.position = new THREE.Vector3(-1846, 0, 726); // Default position
    this.rotation = 0; // Yaw angle in radians
    this.targetRotation = 0;
    this.isVisible = false; // Hidden by default in 1st person mode

    // Movement state
    this.currentSpeed = 0; // 0 = idle, > 0 = walk, > threshold = run

    // 懒加载状态
    this.avatarUrl = null;
    this.isLoaded = false;
    this.isLoading = false;
    this._loadPromise = null;
  }

  /**
   * 配置 Avatar 模型 URL 供按需懒加载
   * @param {string} url 
   */
  setAvatarUrl(url) {
    this.avatarUrl = url;
  }

  /**
   * 确保 Avatar 模型已加载（按需触发）
   */
  async ensureLoaded() {
    if (this.isLoaded) return this.model;
    if (this._loadPromise) return this._loadPromise;
    if (!this.avatarUrl) return null;

    this.isLoading = true;
    this._loadPromise = this.load(this.avatarUrl)
      .then((model) => {
        this.isLoaded = true;
        this.isLoading = false;
        return model;
      })
      .catch((err) => {
        this.isLoading = false;
        this._loadPromise = null;
        throw err;
      });

    return this._loadPromise;
  }

  /**
   * Load avatar model from URL
   * @param {string} url e.g. '/model/avatar/character.glb'
   * @returns {Promise<THREE.Group>}
   */
  async load(url) {
    return new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (gltf) => {
          this.model = gltf.scene;
          // Scale to standard human proportions in showroom units (1.806m -> ~1800mm tall)
          this.model.scale.set(1000, 1000, 1000);

          // Enable shadows and proper materials
          this.model.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
              if (child.material) {
                child.material.roughness = 0.6;
                child.material.metalness = 0.1;
              }
            }
          });

          this.model.position.copy(this.position);
          this.model.visible = this.isVisible;
          this.scene.add(this.model);

          // Setup Animation Mixer
          if (gltf.animations && gltf.animations.length > 0) {
            this.mixer = new THREE.AnimationMixer(this.model);

            for (const clip of gltf.animations) {
              const name = clip.name.toLowerCase();
              const action = this.mixer.clipAction(clip);
              this.actions.set(name, action);

              // Map common synonyms
              if (name.includes('idle')) this.actions.set('idle', action);
              if (name.includes('walk')) this.actions.set('walk', action);
              if (name.includes('run')) this.actions.set('run', action);
            }

            // Start in idle
            const idleAction = this.actions.get('idle') || Array.from(this.actions.values())[0];
            if (idleAction) {
              idleAction.play();
              this.activeAction = idleAction;
            }
          }

          console.log('[AvatarManager] 3D Human Avatar Loaded Successfully.');
          this.isLoaded = true;
          this.isLoading = false;
          resolve(this.model);
        },
        undefined,
        (err) => {
          console.warn('[AvatarManager] Failed to load avatar:', err);
          this.isLoading = false;
          reject(err);
        }
      );
    });
  }

  /**
   * Transition smoothly to designated animation state
   * @param {'idle'|'walk'|'run'} name
   * @param {number} duration
   */
  fadeToAction(name, duration = 0.25) {
    const nextAction = this.actions.get(name);
    if (!nextAction || nextAction === this.activeAction) return;

    if (this.activeAction) {
      this.activeAction.fadeOut(duration);
    }
    nextAction.reset().fadeIn(duration).play();
    this.activeAction = nextAction;
  }

  /**
   * Update character position and target rotation
   */
  setPose(pos, yaw) {
    this.position.copy(pos);
    this.targetRotation = yaw;
    if (this.model) {
      this.model.position.copy(pos);
    }
  }

  /**
   * Show or hide avatar body (hidden in 1st person, shown in 3rd person)
   */
  setVisible(visible) {
    this.isVisible = visible;
    if (this.model) {
      this.model.visible = visible;
      this.model.traverse((child) => {
        if (child.isMesh) {
          child.visible = visible;
        }
      });
    }
  }

  /**
   * Update animation mixer and smooth rotation per frame
   */
  update(delta, speed = 0, isSprinting = false) {
    if (this.mixer) {
      this.mixer.update(delta);
    }

    // Handle animation state transition based on movement speed
    if (speed > 100) {
      if (isSprinting && this.actions.has('run')) {
        this.fadeToAction('run', 0.2);
      } else {
        this.fadeToAction('walk', 0.2);
      }
    } else {
      this.fadeToAction('idle', 0.25);
    }

    // Smoothly slerp avatar heading towards moving direction
    if (this.model) {
      // Rotation lerp
      let diff = this.targetRotation - this.rotation;
      // Normalize angle difference to [-PI, PI]
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      this.rotation += diff * Math.min(1.0, delta * 12.0);
      this.model.rotation.y = this.rotation;
    }
  }

  dispose() {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }
    this.actions.clear();
    this.animations = [];

    if (this.model) {
      this.model.traverse((child) => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach((m) => {
                this._disposeMaterialTextures(m);
                m.dispose();
              });
            } else {
              this._disposeMaterialTextures(child.material);
              child.material.dispose();
            }
          }
        }
      });
      if (this.model.parent) {
        this.model.parent.remove(this.model);
      }
      this.model = null;
    }
  }

  _disposeMaterialTextures(mat) {
    if (!mat) return;
    for (const key of Object.keys(mat)) {
      const val = mat[key];
      if (val && val.isTexture && typeof val.dispose === 'function') {
        val.dispose();
      }
    }
  }
}
