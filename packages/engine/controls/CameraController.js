import * as THREE from 'three';

/**
 * CameraController: First-person roaming controller.
 *
 * Responsibilities:
 *  - Track character feet position (characterPos) in world space
 *  - Handle keyboard WASD movement with wall collision
 *  - Handle mouse-drag rotation (yaw + pitch)
 *  - Clamp pitch so the player never looks straight up/down past ±80°
 *  - Provide smooth fly-to transition for zone jumps
 *
 * It does NOT set camera.position directly – that is done by:
 *  - ViewModeManager.updateFirstPerson()  (first-person mode)
 *  - ViewModeManager.updateThirdPerson()  (third-person mode)
 *  This separation ensures single responsibility and no conflicts.
 */
export class CameraController {
  constructor(camera, domElement, collisionSystem) {
    this.camera = camera;
    this.domElement = domElement;
    this.collisionSystem = collisionSystem;

    // Movement configuration
    this.walkSpeed        = 3500;  // mm/s
    this.sprintMultiplier = 2.0;
    this.rotationSensitivity = 0.0025;

    // Orientation (Euler YXZ – yaw first, then pitch)
    this.yaw   = 0;
    this.pitch = 0;
    this.minPitch = -Math.PI * 0.44; // ~-79°
    this.maxPitch =  Math.PI * 0.44; // ~+79°

    // Movement state
    this.keys = {
      forward: false, backward: false,
      left: false,    right: false,
      sprint: false
    };

    // Character foot position (Y = floor)
    this.characterPos    = new THREE.Vector3(-1846, 0, 726);
    this.currentSpeed    = 0;
    this.moveDirectionYaw = 0;

    // Pointer state
    this.isDragging      = false;
    this.prevPointerPos  = { x: 0, y: 0 };

    // Fly-to transition
    this.isTransitioning      = false;
    this.transitionProgress   = 0;
    this.transitionDuration   = 1.5;
    this.transitionStartPos   = new THREE.Vector3();
    this.transitionEndPos     = new THREE.Vector3();
    this.transitionStartTarget = new THREE.Vector3();
    this.transitionEndTarget  = new THREE.Vector3();
    this.onTransitionComplete = null;

    this._bindEvents();
  }

  // ------------------------------------------------------------------
  _bindEvents() {
    this._onKeyDown    = this._onKeyDown.bind(this);
    this._onKeyUp      = this._onKeyUp.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp  = this._onPointerUp.bind(this);
    this._onContextMenu = (e) => e.preventDefault();

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup',   this._onKeyUp);
    this.domElement.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup',   this._onPointerUp);
    this.domElement.addEventListener('contextmenu', this._onContextMenu);
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup',   this._onKeyUp);
    this.domElement.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup',   this._onPointerUp);
    this.domElement.removeEventListener('contextmenu', this._onContextMenu);
  }

  // ------------------------------------------------------------------
  _onKeyDown(e) {
    switch (e.code) {
      case 'KeyW': case 'ArrowUp':    this.keys.forward  = true; break;
      case 'KeyS': case 'ArrowDown':  this.keys.backward = true; break;
      case 'KeyA': case 'ArrowLeft':  this.keys.left     = true; break;
      case 'KeyD': case 'ArrowRight': this.keys.right    = true; break;
      case 'ShiftLeft': case 'ShiftRight': this.keys.sprint = true; break;
    }
  }

  _onKeyUp(e) {
    switch (e.code) {
      case 'KeyW': case 'ArrowUp':    this.keys.forward  = false; break;
      case 'KeyS': case 'ArrowDown':  this.keys.backward = false; break;
      case 'KeyA': case 'ArrowLeft':  this.keys.left     = false; break;
      case 'KeyD': case 'ArrowRight': this.keys.right    = false; break;
      case 'ShiftLeft': case 'ShiftRight': this.keys.sprint = false; break;
    }
  }

  _onPointerDown(e) {
    if (this.isTransitioning) return;
    this.isDragging = true;
    this.prevPointerPos.x = e.clientX;
    this.prevPointerPos.y = e.clientY;
  }

  _onPointerMove(e) {
    if (!this.isDragging || this.isTransitioning) return;
    const dx = e.clientX - this.prevPointerPos.x;
    const dy = e.clientY - this.prevPointerPos.y;
    this.prevPointerPos.x = e.clientX;
    this.prevPointerPos.y = e.clientY;

    this.yaw   -= dx * this.rotationSensitivity;
    this.pitch -= dy * this.rotationSensitivity;
    this.pitch  = Math.max(this.minPitch, Math.min(this.maxPitch, this.pitch));

    this._applyRotation();
  }

  _onPointerUp() {
    this.isDragging = false;
  }

  /** Sync camera quaternion from current yaw + pitch */
  _applyRotation() {
    const euler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);
  }

  // ------------------------------------------------------------------
  /**
   * Programmatically set camera view direction
   */
  setView(posX, posY, posZ, targetX, targetY, targetZ) {
    this.camera.position.set(posX, posY, posZ);
    const dir = new THREE.Vector3(
      targetX - posX, targetY - posY, targetZ - posZ
    ).normalize();
    this.pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    this.yaw   = Math.atan2(-dir.x, -dir.z);
    this._applyRotation();
  }

  /**
   * Smooth fly-to a target viewpoint (used by ZoneGuideManager)
   */
  flyTo(endPos, endTarget, duration = 1.5, onComplete = null) {
    this.isTransitioning    = true;
    this.transitionProgress = 0;
    this.transitionDuration = duration;
    this.onTransitionComplete = onComplete;

    this.transitionStartPos.copy(this.camera.position);
    this.transitionEndPos.copy(endPos);

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.transitionStartTarget.copy(this.camera.position).add(forward.multiplyScalar(2000));
    this.transitionEndTarget.copy(endTarget);
  }

  // ------------------------------------------------------------------
  /**
   * Per-frame update – advances character position and (if first-person) camera rotation.
   * Camera POSITION is NOT set here; ViewModeManager owns that.
   */
  update(delta) {
    // ① Fly-to transition
    if (this.isTransitioning) {
      this.transitionProgress += delta / this.transitionDuration;
      const t    = Math.min(this.transitionProgress, 1.0);
      const ease = t * t * (3 - 2 * t); // cubic smoothstep

      this.camera.position.lerpVectors(this.transitionStartPos, this.transitionEndPos, ease);

      const curTarget = new THREE.Vector3().lerpVectors(
        this.transitionStartTarget, this.transitionEndTarget, ease
      );
      const dir = curTarget.clone().sub(this.camera.position).normalize();
      this.pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
      this.yaw   = Math.atan2(-dir.x, -dir.z);
      this._applyRotation();

      if (t >= 1.0) {
        this.isTransitioning = false;
        // Sync character foot position to end position minus eye height
        this.characterPos.set(
          this.transitionEndPos.x,
          this.transitionEndPos.y - 2000,
          this.transitionEndPos.z
        );
        if (this.onTransitionComplete) {
          this.onTransitionComplete();
          this.onTransitionComplete = null;
        }
      }
      return;
    }

    // ② Keyboard movement
    const speed = this.walkSpeed * (this.keys.sprint ? this.sprintMultiplier : 1.0);
    const moveVector = new THREE.Vector3();

    if (this.keys.forward)  moveVector.z -= 1;
    if (this.keys.backward) moveVector.z += 1;
    if (this.keys.left)     moveVector.x -= 1;
    if (this.keys.right)    moveVector.x += 1;

    if (moveVector.lengthSq() > 0) {
      moveVector.normalize();
      this.currentSpeed = speed;

      // Project movement onto the horizontal plane using camera yaw only
      const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const right   = new THREE.Vector3( Math.cos(this.yaw), 0, -Math.sin(this.yaw));

      const worldMove = new THREE.Vector3()
        .addScaledVector(forward, -moveVector.z)
        .addScaledVector(right,    moveVector.x)
        .normalize();

      this.moveDirectionYaw = Math.atan2(worldMove.x, worldMove.z);

      const deltaMove = worldMove.clone().multiplyScalar(speed * delta);
      const safeMove  = this.collisionSystem
        ? this.collisionSystem.validateMovement(this.characterPos, deltaMove)
        : deltaMove;

      this.characterPos.add(safeMove);
    } else {
      this.currentSpeed = 0;
    }

    // ③ Floor clamping (keep feet on ground)
    if (this.collisionSystem) {
      // getFloorHeight returns floor_Y + EYE_HEIGHT internally; we only want floor Y
      // characterPos.y tracks floor-level, so request from slightly above
      const testPos = this.characterPos.clone();
      testPos.y += 3000;
      const hits = this._castDown(testPos);
      if (hits !== null) {
        const targetFloorY = hits;
        this.characterPos.y += (targetFloorY - this.characterPos.y) * 0.15;
      }
    }
  }

  /** Cast downward from a point and return floor Y or null */
  _castDown(fromPos) {
    if (!this.collisionSystem || this.collisionSystem.groundObjects.length === 0) return null;
    const r = new THREE.Raycaster(
      fromPos.clone(),
      new THREE.Vector3(0, -1, 0),
      1,
      8000
    );
    const hits = r.intersectObjects(this.collisionSystem.groundObjects, true);
    return hits.length > 0 ? hits[0].point.y : null;
  }
}
