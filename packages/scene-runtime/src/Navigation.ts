import * as THREE from "three";
import type { SceneSettings } from "@studio/scene-schema";

export class Navigation {
  enabled = false;
  viewMode: "first" | "third" = "first";
  eye = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  speed = 0;
  sprint = false;
  colliders: THREE.Object3D[] = [];
  grounds: THREE.Object3D[] = [];
  settings!: SceneSettings;
  private keys = new Set<string>();
  private movement = { forward: 0, right: 0 };
  private dragging = false;
  private ray = new THREE.Raycaster();
  private previousCamera = new THREE.Vector3();
  private controller = new AbortController();
  private inputListeners = new Set<(active: boolean) => void>();
  onInputChanged(listener: (active: boolean) => void): () => void {
    this.inputListeners.add(listener);
    return () => {
      this.inputListeners.delete(listener);
    };
  }
  private notifyInput(active: boolean): void {
    for (const listener of this.inputListeners) listener(active);
  }
  get hasInput(): boolean {
    return (
      this.dragging ||
      this.keys.size > 0 ||
      Boolean(this.movement.forward || this.movement.right)
    );
  }
  constructor(
    private camera: THREE.PerspectiveCamera,
    private canvas: HTMLCanvasElement,
    private wake: () => void,
  ) {
    const signal = this.controller.signal;
    canvas.addEventListener(
      "keydown",
      (event) => {
        if (
          !this.enabled ||
          event.isComposing ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey
        )
          return;
        if (
          [
            "KeyW",
            "KeyS",
            "KeyA",
            "KeyD",
            "ArrowUp",
            "ArrowDown",
            "ArrowLeft",
            "ArrowRight",
            "ShiftLeft",
            "ShiftRight",
          ].includes(event.code)
        ) {
          event.preventDefault();
          this.keys.add(event.code);
          this.notifyInput(true);
          wake();
        }
      },
      { signal },
    );
    canvas.addEventListener(
      "keyup",
      (event) => {
        this.keys.delete(event.code);
        this.notifyInput(this.hasInput);
      },
      { signal },
    );
    canvas.addEventListener(
      "blur",
      () => {
        this.keys.clear();
        this.movement = { forward: 0, right: 0 };
        this.dragging = false;
        this.notifyInput(this.hasInput);
      },
      { signal },
    );
    canvas.addEventListener(
      "pointerdown",
      (event) => {
        if (!this.enabled || event.button !== 0) return;
        this.dragging = true;
        this.notifyInput(true);
        canvas.focus();
        canvas.setPointerCapture(event.pointerId);
      },
      { signal },
    );
    canvas.addEventListener(
      "pointermove",
      (event) => {
        if (!this.enabled || !this.dragging) return;
        this.yaw -= event.movementX * this.settings.lookSensitivity;
        this.pitch = THREE.MathUtils.clamp(
          this.pitch - event.movementY * this.settings.lookSensitivity,
          -THREE.MathUtils.degToRad(this.settings.pitchLimit),
          THREE.MathUtils.degToRad(this.settings.pitchLimit),
        );
        wake();
      },
      { signal },
    );
    canvas.addEventListener(
      "pointerup",
      () => {
        this.dragging = false;
        this.notifyInput(this.hasInput);
      },
      { signal },
    );
    canvas.addEventListener(
      "pointercancel",
      () => {
        this.dragging = false;
        this.keys.clear();
        this.notifyInput(this.hasInput);
      },
      { signal },
    );
    canvas.addEventListener(
      "wheel",
      (event) => {
        if (!this.enabled) return;
        event.preventDefault();
        this.notifyInput(true);
        camera.fov = THREE.MathUtils.clamp(
          camera.fov + event.deltaY * 0.02,
          20,
          110,
        );
        camera.updateProjectionMatrix();
        this.notifyInput(this.hasInput);
        wake();
      },
      { passive: false, signal },
    );
  }
  setMovement(forward: number, right: number): void {
    this.movement = {
      forward: Math.max(-1, Math.min(1, forward)),
      right: Math.max(-1, Math.min(1, right)),
    };
    this.notifyInput(this.hasInput);
    this.wake();
  }
  reset(settings: SceneSettings): void {
    this.settings = settings;
    this.eye.fromArray(settings.position);
    this.lookAt(new THREE.Vector3().fromArray(settings.target));
    this.viewMode = settings.viewMode;
    this.keys.clear();
    this.speed = 0;
    this.pose();
  }
  lookAt(target: THREE.Vector3): void {
    const direction = target.clone().sub(this.eye).normalize();
    this.yaw = Math.atan2(-direction.x, -direction.z);
    this.pitch = Math.asin(direction.y);
  }
  pose(dt = 0): void {
    this.camera.quaternion.setFromEuler(
      new THREE.Euler(this.pitch, this.yaw, 0, "YXZ"),
    );
    if (this.viewMode === "first") this.camera.position.copy(this.eye);
    else {
      const feet = this.eye
        .clone()
        .add(new THREE.Vector3(0, -this.settings.eyeHeight, 0));
      const focus = feet
        .clone()
        .add(new THREE.Vector3(0, this.settings.thirdPersonFocusHeight, 0));
      const ideal = feet
        .clone()
        .add(
          new THREE.Vector3(
            Math.sin(this.yaw) * this.settings.thirdPersonDistance,
            this.settings.thirdPersonHeight,
            Math.cos(this.yaw) * this.settings.thirdPersonDistance,
          ),
        );
      const offset = ideal.sub(focus);
      this.ray.set(focus, offset.clone().normalize());
      this.ray.near = 0;
      this.ray.far = offset.length();
      const hit = this.ray.intersectObjects(this.colliders, true)[0];
      if (hit)
        offset.setLength(
          Math.max(
            this.settings.thirdPersonMinDistance,
            hit.distance - this.settings.playerRadius,
          ),
        );
      const target = focus.add(offset);
      if (dt)
        this.camera.position.lerp(
          target,
          1 - Math.pow(1 - this.settings.thirdPersonSmoothing, dt * 60),
        );
      else this.camera.position.copy(target);
      this.camera.lookAt(
        feet.add(new THREE.Vector3(0, this.settings.thirdPersonFocusHeight, 0)),
      );
    }
  }
  update(dt: number): boolean {
    if (!this.enabled) {
      this.speed = 0;
      return false;
    }
    this.previousCamera.copy(this.camera.position);
    const forward =
      this.movement.forward +
      Number(this.keys.has("KeyW") || this.keys.has("ArrowUp")) -
      Number(this.keys.has("KeyS") || this.keys.has("ArrowDown"));
    const right =
      this.movement.right +
      Number(this.keys.has("KeyD") || this.keys.has("ArrowRight")) -
      Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft"));
    this.sprint = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    this.speed =
      forward || right
        ? this.settings.moveSpeed *
          (this.sprint ? this.settings.sprintMultiplier : 1)
        : 0;
    if (this.speed) {
      const delta = new THREE.Vector3(right, 0, -forward)
        .normalize()
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw)
        .multiplyScalar(this.speed * dt);
      const steps = Math.max(
        1,
        Math.ceil(delta.length() / Math.max(1, this.settings.playerRadius)),
      );
      delta.divideScalar(steps);
      for (let step = 0; step < steps; step++) {
        let allowed = delta.length();
        if (this.settings.collision) {
          for (const height of [
            0,
            -0.45 * this.settings.eyeHeight,
            -0.85 * this.settings.eyeHeight,
          ]) {
            this.ray.set(
              this.eye.clone().add(new THREE.Vector3(0, height, 0)),
              delta.clone().normalize(),
            );
            this.ray.near = 0;
            this.ray.far = delta.length() + this.settings.playerRadius;
            const hit = this.ray.intersectObjects(this.colliders, true)[0];
            if (hit)
              allowed = Math.min(
                allowed,
                Math.max(0, hit.distance - this.settings.playerRadius),
              );
          }
        }
        this.eye.add(delta.clone().setLength(allowed));
      }
      if (this.settings.collision && this.grounds.length) {
        this.ray.set(
          this.eye.clone().add(new THREE.Vector3(0, 2000, 0)),
          new THREE.Vector3(0, -1, 0),
        );
        this.ray.near = 0;
        this.ray.far = 8000;
        const hit = this.ray.intersectObjects(this.grounds, true)[0];
        if (hit) this.eye.y = hit.point.y + this.settings.eyeHeight;
      }
    }
    this.pose(dt);
    return Boolean(
      this.speed ||
        this.dragging ||
        this.camera.position.distanceToSquared(this.previousCamera) > 0.01,
    );
  }
  clearInput(): void {
    this.keys.clear();
    this.movement = { forward: 0, right: 0 };
    this.dragging = false;
    this.notifyInput(false);
  }
  pause(): void {
    this.enabled = false;
    this.clearInput();
  }
  dispose(): void {
    this.pause();
    this.controller.abort();
    this.inputListeners.clear();
  }
}

export function frameObjects(
  camera: THREE.PerspectiveCamera,
  objects: readonly THREE.Object3D[],
): {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  far: number;
} {
  const box = new THREE.Box3();
  for (const object of objects) {
    object.updateWorldMatrix(true, true);
    object.traverseVisible((node) => {
      if (!(node instanceof THREE.Mesh) || node.userData.collider) return;
      if (node instanceof THREE.SkinnedMesh) {
        node.skeleton.update();
        node.computeBoundingBox();
        if (node.boundingBox)
          box.union(node.boundingBox.clone().applyMatrix4(node.matrixWorld));
      } else {
        if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
        if (node.geometry.boundingBox)
          box.union(
            node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld),
          );
      }
    });
  }
  if (box.isEmpty()) throw Error("选择中没有可定位的可见几何");
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 100);
  const half = Math.min(
    THREE.MathUtils.degToRad(camera.fov) / 2,
    Math.atan(
      Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect,
    ),
  );
  const distance = (radius / Math.max(0.01, Math.sin(half))) * 1.15;
  const direction = camera.position.clone().sub(center).normalize();
  if (!direction.lengthSq()) direction.set(1, 0.7, 1).normalize();
  return {
    position: center.clone().addScaledVector(direction, distance).toArray(),
    target: center.toArray(),
    fov: camera.fov,
    far: Math.max(camera.far, distance * 10),
  };
}
export function framePoint(
  camera: THREE.PerspectiveCamera,
  center: THREE.Vector3,
  radius = 500,
): {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
} {
  const distance = Math.max(radius * 2.5, 1000),
    direction = camera.position.clone().sub(center).normalize();
  if (!direction.lengthSq()) direction.set(1, 0.7, 1).normalize();
  return {
    position: center.clone().addScaledVector(direction, distance).toArray(),
    target: center.toArray(),
    fov: camera.fov,
  };
}
