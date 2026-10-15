import * as THREE from 'three';

/**
 * ViewModeManager: First-Person (eye-level) ↔ Third-Person (over-the-shoulder) mode management.
 *
 * First-person mode:
 *   Camera IS the eye – positioned at (characterPos.x, characterPos.y + EYE_HEIGHT, characterPos.z)
 *   with full mouse-look. Avatar mesh is hidden so it doesn't block the view.
 *
 * Third-person mode:
 *   Avatar is visible.  Camera orbits the avatar from a fixed behind-and-above offset that rotates
 *   with the character's heading (yaw), NOT with the mouse pitch.  This gives the classic
 *   "follow-cam" feel where the avatar is always centred and the camera arm stays horizontal.
 *   A SpringArm raycasts backward from the avatar to detect wall occlusion and pulls the camera
 *   forward to avoid clipping.
 */
export const VIEW_MODES = {
  FIRST_PERSON: 'FIRST_PERSON',
  THIRD_PERSON: 'THIRD_PERSON'
};

export class ViewModeManager {
  constructor(camera, avatarManager, cameraController, collisionSystem, eventEmitter) {
    this.camera          = camera;
    this.avatar          = avatarManager;
    this.controller      = cameraController;
    this.collisionSystem = collisionSystem;
    this.events          = eventEmitter;

    // ---- First-person config (natural eye level for 1.8m human) ----
    this.EYE_HEIGHT = 1720; // mm above floor

    // ---- Third-person arm config (tuned for 2.2m ceiling and comfortable follow view) ----
    this.ARM_DISTANCE   = 3200;  // camera distance behind avatar (mm)
    this.ARM_HEIGHT     = 1850;  // camera height above floor (mm, safe under ceiling)
    this.FOCUS_HEIGHT   = 1350;  // avatar look-at focus height above feet (mm)
    this.MIN_ARM_DIST   = 600;   // minimum SpringArm retraction near walls
    this.ARM_SMOOTH     = 0.12;  // camera position lerp alpha (per tick at 60fps base)
    this.currentArmDist = this.ARM_DISTANCE;

    // Raycaster for SpringArm collision
    this.raycaster = new THREE.Raycaster();

    // 预分配复用数学对象（避免 updateThirdPerson 每帧 GC）
    this._focus = new THREE.Vector3();
    this._armDir = new THREE.Vector3();
    this._idealPos = new THREE.Vector3();
    this._toIdeal = new THREE.Vector3();
    this._targetCamPos = new THREE.Vector3();

    this.mode = VIEW_MODES.FIRST_PERSON;
    this.avatar?.setVisible(false);

    this._onKeyDown = (e) => {
      if (e.code === 'KeyV') this.toggle();
    };

    this._bindKeyboard();
  }

  _bindKeyboard() {
    window.addEventListener('keydown', this._onKeyDown);
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
  }

  // ------------------------------------------------------------------
  async setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;

    if (this.mode === VIEW_MODES.FIRST_PERSON) {
      // Hide avatar body so it doesn't obstruct first-person view
      this.avatar?.setVisible(false);
    } else {
      // 切换第三人称：按需懒加载 Avatar 模型
      if (this.avatar && !this.avatar.isLoaded && typeof this.avatar.ensureLoaded === 'function') {
        try {
          await this.avatar.ensureLoaded();
        } catch (err) {
          console.warn('[ViewModeManager] Lazy load avatar failed:', err);
        }
      }
      this.avatar?.setVisible(true);
      this._snapThirdPersonCamera();
    }

    this.events?.emit('viewModeChange', this.mode);
  }

  toggle() {
    this.setMode(
      this.mode === VIEW_MODES.FIRST_PERSON
        ? VIEW_MODES.THIRD_PERSON
        : VIEW_MODES.FIRST_PERSON
    );
  }

  // ------------------------------------------------------------------
  // Called every frame from the render loop
  // ------------------------------------------------------------------
  /**
   * Update first-person camera: camera sits at exact eye position, driven by mouse-look.
   * The CameraController already handles position (characterPos) and yaw/pitch.
   * We simply ensure the camera Y is set to eye height.
   */
  updateFirstPerson(characterPos) {
    this.camera.position.set(
      characterPos.x,
      characterPos.y + this.EYE_HEIGHT,
      characterPos.z
    );
    // Rotation is already managed by CameraController (yaw+pitch Euler)
  }

  /**
   * Update third-person camera: camera follows avatar from behind-above.
   * Camera arm direction is based ONLY on character heading yaw – NOT on mouse pitch –
   * so the camera stays level while the player looks around.
   *
   * @param {THREE.Vector3} avatarFeet  – avatar feet position (y = floor)
   * @param {number}        charYaw     – character heading (radians, from CameraController)
   */
  updateThirdPerson(avatarFeet, charYaw, delta = 0.016) {
    // Focus point: avatar chest area
    this._focus.copy(avatarFeet);
    this._focus.y += this.FOCUS_HEIGHT;

    // Camera arm direction: directly behind the character
    this._armDir.set(
      Math.sin(charYaw),
      0,
      Math.cos(charYaw)
    ).normalize();

    // Ideal camera position: behind and above
    this._idealPos.copy(avatarFeet);
    this._idealPos.x += this._armDir.x * this.ARM_DISTANCE;
    this._idealPos.z += this._armDir.z * this.ARM_DISTANCE;
    this._idealPos.y  = avatarFeet.y + this.ARM_HEIGHT;

    // SpringArm: cast from focus outward toward ideal camera to find wall
    this._toIdeal.subVectors(this._idealPos, this._focus).normalize();
    let safeDist = this.ARM_DISTANCE;

    if (this.collisionSystem?.colliObjects?.length > 0) {
      this.raycaster.set(this._focus, this._toIdeal);
      this.raycaster.near = 100;
      this.raycaster.far  = this.ARM_DISTANCE + 500;
      const hits = this.raycaster.intersectObjects(this.collisionSystem.colliObjects, true);
      if (hits.length > 0) {
        // Pull camera forward 300mm in front of the wall hit
        safeDist = Math.max(this.MIN_ARM_DIST, hits[0].distance - 300);
      }
    }

    // 帧率无关指数阻尼因子 (基于 10.0 decay 速率，在 60Hz 与 144Hz 屏幕体验物理一致)
    const dampFactor = 1 - Math.exp(-10.0 * Math.min(delta, 0.1));

    // Smooth arm length transition (avoids jitter on thin walls)
    this.currentArmDist += (safeDist - this.currentArmDist) * dampFactor;

    // Final camera position along the arm
    this._targetCamPos.copy(this._focus).addScaledVector(this._toIdeal, this.currentArmDist);
    this._targetCamPos.y = this._idealPos.y; // keep height constant

    // 帧率无关平滑插值移动
    this.camera.position.lerp(this._targetCamPos, dampFactor);

    // Always look at focus
    this.camera.lookAt(this._focus);
  }

  // Immediately snap the third-person camera without lerp (on mode switch)
  _snapThirdPersonCamera() {
    if (!this.controller) return;
    const charPos = this.controller.characterPos;
    const yaw = this.controller.yaw;

    this._focus.copy(charPos);
    this._focus.y += this.FOCUS_HEIGHT;

    this._armDir.set(Math.sin(yaw), 0, Math.cos(yaw)).normalize();
    this._targetCamPos.copy(charPos).addScaledVector(this._armDir, this.ARM_DISTANCE);
    this._targetCamPos.y = charPos.y + this.ARM_HEIGHT;

    this.camera.position.copy(this._targetCamPos);
    this.camera.lookAt(this._focus);
    this.currentArmDist = this.ARM_DISTANCE;
  }
}
