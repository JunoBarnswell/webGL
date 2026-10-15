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

    // 预分配复用数学对象（避免每帧产生 GC 垃圾回收与堆对象分配）
    this._moveVector = new THREE.Vector3();
    this._forwardDir = new THREE.Vector3();
    this._rightDir = new THREE.Vector3();
    this._worldMove = new THREE.Vector3();
    this._deltaMove = new THREE.Vector3();
    this._testFloorPos = new THREE.Vector3();
    this._floorRaycaster = new THREE.Raycaster();
    this._floorRaycaster.near = 1;
    this._floorRaycaster.far = 8000;
    this._downDirection = new THREE.Vector3(0, -1, 0);
    this._curTransitionTarget = new THREE.Vector3();
    this._dirVec = new THREE.Vector3();

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
    this.characterPos.set(posX, posY - 1720, posZ);
    this._forceFloorCheck = true;

    this._dirVec.set(targetX - posX, targetY - posY, targetZ - posZ).normalize();
    this.pitch = Math.asin(Math.max(-1, Math.min(1, this._dirVec.y)));
    this.yaw   = Math.atan2(-this._dirVec.x, -this._dirVec.z);
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

    const forward = this._dirVec.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
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

      // 同步推进 characterPos，保证过渡过程与结束时与相机保持严格的一致（减去眼高 1720mm）
      this.characterPos.set(
        this.camera.position.x,
        this.camera.position.y - 1720,
        this.camera.position.z
      );

      this._curTransitionTarget.lerpVectors(
        this.transitionStartTarget, this.transitionEndTarget, ease
      );
      this._dirVec.subVectors(this._curTransitionTarget, this.camera.position).normalize();
      this.pitch = Math.asin(Math.max(-1, Math.min(1, this._dirVec.y)));
      this.yaw   = Math.atan2(-this._dirVec.x, -this._dirVec.z);
      this._applyRotation();

      if (t >= 1.0) {
        this.isTransitioning = false;
        this.characterPos.set(
          this.transitionEndPos.x,
          this.transitionEndPos.y - 1720,
          this.transitionEndPos.z
        );
        if (this.onTransitionComplete) {
          const cb = this.onTransitionComplete;
          this.onTransitionComplete = null;
          cb();
        }
      }
      return;
    }

    // ② Keyboard movement
    const speed = this.walkSpeed * (this.keys.sprint ? this.sprintMultiplier : 1.0);
    this._moveVector.set(0, 0, 0);

    if (this.keys.forward)  this._moveVector.z -= 1;
    if (this.keys.backward) this._moveVector.z += 1;
    if (this.keys.left)     this._moveVector.x -= 1;
    if (this.keys.right)    this._moveVector.x += 1;

    let hasMoved = false;

    if (this._moveVector.lengthSq() > 0) {
      this._moveVector.normalize();
      this.currentSpeed = speed;

      // Project movement onto the horizontal plane using camera yaw only
      this._forwardDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      this._rightDir.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

      this._worldMove.set(0, 0, 0)
        .addScaledVector(this._forwardDir, -this._moveVector.z)
        .addScaledVector(this._rightDir,    this._moveVector.x)
        .normalize();

      this.moveDirectionYaw = Math.atan2(this._worldMove.x, this._worldMove.z);

      this._deltaMove.copy(this._worldMove).multiplyScalar(speed * delta);
      const safeMove = this.collisionSystem
        ? this.collisionSystem.validateMovement(this.characterPos, this._deltaMove)
        : this._deltaMove;

      this.characterPos.add(safeMove);
      hasMoved = true;
    } else {
      this.currentSpeed = 0;
    }

    // ③ Floor clamping (keep feet on ground)
    // 状态驱动优化：仅在角色发生位移时执行地面射线检测，静止时完全跳过，大幅降低 CPU 开销
    if (this.collisionSystem && (hasMoved || this._forceFloorCheck)) {
      this._forceFloorCheck = false;
      this._testFloorPos.copy(this.characterPos);
      this._testFloorPos.y += 3000;
      const hits = this._castDown(this._testFloorPos);
      if (hits !== null) {
        const targetFloorY = hits;
        this.characterPos.y += (targetFloorY - this.characterPos.y) * 0.15;
      }
    }
  }

  /** Cast downward from a point and return floor Y or null - 复用 Raycaster 消除 GC 内存抖动 */
  _castDown(fromPos) {
    if (!this.collisionSystem || this.collisionSystem.groundObjects.length === 0) return null;
    this._floorRaycaster.set(fromPos, this._downDirection);
    const hits = this._floorRaycaster.intersectObjects(this.collisionSystem.groundObjects, true);
    return hits.length > 0 ? hits[0].point.y : null;
  }
}
