import * as THREE from 'three';

/**
 * CameraController: First-person roaming, mouse/touch rotation, inertia damping, and smooth viewpoint transitions
 */
export class CameraController {
  constructor(camera, domElement, collisionSystem) {
    this.camera = camera;
    this.domElement = domElement;
    this.collisionSystem = collisionSystem;

    // Movement configuration
    this.walkSpeed = 3500; // Units per second
    this.sprintMultiplier = 2.0;
    this.rotationSensitivity = 0.0025;
    this.damping = 0.1;

    // Orientation angles (Euler YXZ)
    this.yaw = 0;
    this.pitch = 0;
    this.minPitch = -Math.PI / 2.2;
    this.maxPitch = Math.PI / 2.2;

    // Movement state
    this.keys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      sprint: false
    };
    this.velocity = new THREE.Vector3();
    this.characterPos = new THREE.Vector3(-1846, 0, 726); // Character position (feet level)
    this.currentSpeed = 0;
    this.moveDirectionYaw = 0;

    // Mouse / Touch interaction state
    this.isDragging = false;
    this.prevPointerPos = { x: 0, y: 0 };

    // Transition (Fly-to) state
    this.isTransitioning = false;
    this.transitionProgress = 0;
    this.transitionDuration = 1.5;
    this.transitionStartPos = new THREE.Vector3();
    this.transitionEndPos = new THREE.Vector3();
    this.transitionStartTarget = new THREE.Vector3();
    this.transitionEndTarget = new THREE.Vector3();
    this.onTransitionComplete = null;

    this._bindEvents();
  }

  _bindEvents() {
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onContextMenu = (e) => e.preventDefault();

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    this.domElement.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    this.domElement.addEventListener('contextmenu', this._onContextMenu);
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this.domElement.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    this.domElement.removeEventListener('contextmenu', this._onContextMenu);
  }

  _onKeyDown(e) {
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': this.keys.forward = true; break;
      case 'KeyS': case 'ArrowDown': this.keys.backward = true; break;
      case 'KeyA': case 'ArrowLeft': this.keys.left = true; break;
      case 'KeyD': case 'ArrowRight': this.keys.right = true; break;
      case 'ShiftLeft': case 'ShiftRight': this.keys.sprint = true; break;
    }
  }

  _onKeyUp(e) {
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': this.keys.forward = false; break;
      case 'KeyS': case 'ArrowDown': this.keys.backward = false; break;
      case 'KeyA': case 'ArrowLeft': this.keys.left = false; break;
      case 'KeyD': case 'ArrowRight': this.keys.right = false; break;
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

    const deltaX = e.clientX - this.prevPointerPos.x;
    const deltaY = e.clientY - this.prevPointerPos.y;
    this.prevPointerPos.x = e.clientX;
    this.prevPointerPos.y = e.clientY;

    this.yaw -= deltaX * this.rotationSensitivity;
    this.pitch -= deltaY * this.rotationSensitivity;
    this.pitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.pitch));

    this._updateCameraRotation();
  }

  _onPointerUp() {
    this.isDragging = false;
  }

  _updateCameraRotation() {
    const euler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);
  }

  /**
   * Set camera position and lookAt direction explicitly
   */
  setView(posX, posY, posZ, targetX, targetY, targetZ) {
    this.camera.position.set(posX, posY, posZ);

    const dir = new THREE.Vector3(targetX - posX, targetY - posY, targetZ - posZ).normalize();
    this.pitch = Math.asin(dir.y);
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this._updateCameraRotation();
  }

  /**
   * Smooth fly-to transition to target viewpoint
   */
  flyTo(endPos, endTarget, duration = 1.5, onComplete = null) {
    this.isTransitioning = true;
    this.transitionProgress = 0;
    this.transitionDuration = duration;
    this.onTransitionComplete = onComplete;

    this.transitionStartPos.copy(this.camera.position);
    this.transitionEndPos.copy(endPos);

    // Compute current forward lookAt point
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.transitionStartTarget.copy(this.camera.position).add(forward.multiplyScalar(2000));
    this.transitionEndTarget.copy(endTarget);
  }

  /**
   * Update per frame called by RenderLoop
   */
  update(delta) {
    // 1. Handle Smooth Fly-to Transition
    if (this.isTransitioning) {
      this.transitionProgress += delta / this.transitionDuration;
      const t = Math.min(this.transitionProgress, 1.0);
      // Smooth cubic ease-in-out: 3t^2 - 2t^3
      const ease = t * t * (3 - 2 * t);

      // Lerp position
      this.camera.position.lerpVectors(this.transitionStartPos, this.transitionEndPos, ease);

      // Lerp lookAt target
      const currentTarget = new THREE.Vector3().lerpVectors(this.transitionStartTarget, this.transitionEndTarget, ease);
      const dir = currentTarget.sub(this.camera.position).normalize();
      this.pitch = Math.asin(dir.y);
      this.yaw = Math.atan2(-dir.x, -dir.z);
      this._updateCameraRotation();

      if (t >= 1.0) {
        this.isTransitioning = false;
        if (this.onTransitionComplete) {
          this.onTransitionComplete();
          this.onTransitionComplete = null;
        }
      }
      return;
    }

    // 2. Handle Keyboard Roaming
    const speed = this.walkSpeed * (this.keys.sprint ? this.sprintMultiplier : 1.0);
    const moveVector = new THREE.Vector3();

    if (this.keys.forward) moveVector.z -= 1;
    if (this.keys.backward) moveVector.z += 1;
    if (this.keys.left) moveVector.x -= 1;
    if (this.keys.right) moveVector.x += 1;

    if (moveVector.lengthSq() > 0) {
      moveVector.normalize();
      this.currentSpeed = speed;

      // Transform direction according to camera yaw
      const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

      const worldMove = new THREE.Vector3();
      worldMove.addScaledVector(forward, -moveVector.z);
      worldMove.addScaledVector(right, moveVector.x);
      worldMove.normalize();

      // Heading angle of movement
      this.moveDirectionYaw = Math.atan2(worldMove.x, worldMove.z);

      const deltaMove = worldMove.clone().multiplyScalar(speed * delta);

      // Validate collision with wall boundaries
      const safeMove = this.collisionSystem
        ? this.collisionSystem.validateMovement(this.characterPos, deltaMove)
        : deltaMove;

      this.characterPos.add(safeMove);
    } else {
      this.currentSpeed = 0;
    }

    // 3. Maintain Ground Height
    if (this.collisionSystem) {
      const targetY = this.collisionSystem.getFloorHeight(this.characterPos) - 2000;
      this.characterPos.y += (targetY - this.characterPos.y) * 0.1;
    }

    // Default 1st Person camera position if not overridden by 3rd person manager
    if (!this.isThirdPerson) {
      this.camera.position.set(this.characterPos.x, this.characterPos.y + 2000, this.characterPos.z);
    }
  }
}
