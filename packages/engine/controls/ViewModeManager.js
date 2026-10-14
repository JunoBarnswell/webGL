import * as THREE from 'three';

/**
 * ViewModeManager: Manages seamless transitions between First-Person and Third-Person view modes
 */
export const VIEW_MODES = {
  FIRST_PERSON: 'FIRST_PERSON',
  THIRD_PERSON: 'THIRD_PERSON'
};

export class ViewModeManager {
  constructor(camera, avatarManager, cameraController, collisionSystem, eventEmitter) {
    this.camera = camera;
    this.avatar = avatarManager;
    this.controller = cameraController;
    this.collisionSystem = collisionSystem;
    this.events = eventEmitter;

    this.mode = VIEW_MODES.FIRST_PERSON; // Default mode
    this.thirdPersonDistance = 2600; // Distance behind avatar in mm
    this.thirdPersonHeight = 1750; // Head height offset in mm
    this.minThirdPersonDistance = 600;

    // Raycaster for SpringArm wall occlusion
    this.raycaster = new THREE.Raycaster();

    this._bindKeyboard();
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      // Press 'V' to toggle view mode
      if (e.code === 'KeyV') {
        this.toggle();
      }
    });
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;

    if (this.mode === VIEW_MODES.FIRST_PERSON) {
      this.avatar.setVisible(false);
    } else {
      this.avatar.setVisible(true);
    }

    if (this.events) {
      this.events.emit('viewModeChange', this.mode);
    }
  }

  toggle() {
    const nextMode = this.mode === VIEW_MODES.FIRST_PERSON
      ? VIEW_MODES.THIRD_PERSON
      : VIEW_MODES.FIRST_PERSON;
    this.setMode(nextMode);
  }

  /**
   * Update camera position for third person with SpringArm collision
   * @param {THREE.Vector3} avatarPos
   * @param {number} yaw
   * @param {number} pitch
   */
  updateThirdPerson(avatarPos, yaw, pitch) {
    if (this.mode !== VIEW_MODES.THIRD_PERSON) return;

    // Head anchor point
    const headPos = avatarPos.clone();
    headPos.y += this.thirdPersonHeight;

    // Ideal camera direction
    const cosPitch = Math.cos(pitch);
    const sinPitch = Math.sin(pitch);
    const sinYaw = Math.sin(yaw);
    const cosYaw = Math.cos(yaw);

    // Camera offset behind character
    const offsetDir = new THREE.Vector3(
      sinYaw * cosPitch,
      -sinPitch,
      cosYaw * cosPitch
    ).normalize();

    let targetDist = this.thirdPersonDistance;

    // SpringArm Camera Collision Detection (Prevent camera clipping into walls)
    if (this.collisionSystem && this.collisionSystem.colliObjects.length > 0) {
      this.raycaster.set(headPos, offsetDir);
      this.raycaster.near = 100;
      this.raycaster.far = this.thirdPersonDistance;

      const hits = this.raycaster.intersectObjects(this.collisionSystem.colliObjects, true);
      if (hits.length > 0) {
        // Pull camera forward in front of the wall
        targetDist = Math.max(this.minThirdPersonDistance, hits[0].distance - 200);
      }
    }

    const targetCameraPos = headPos.clone().addScaledVector(offsetDir, targetDist);
    this.camera.position.lerp(targetCameraPos, 0.25);
  }
}
