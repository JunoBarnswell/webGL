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
    this.isVisible = true;

    // Movement state
    this.currentSpeed = 0; // 0 = idle, > 0 = walk, > threshold = run
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
          // Scale to human proportions in showroom units (~1750mm tall)
          this.model.scale.set(2500, 2500, 2500);

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
          resolve(this.model);
        },
        undefined,
        (err) => {
          console.warn('[AvatarManager] Failed to load avatar:', err);
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
}
