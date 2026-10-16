import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ShowroomEngine } from "@o2vr/engine";
import {
  frameObjects,
  type CameraPose,
  type SceneRuntime,
} from "@studio/scene-runtime";

export class EditorCamera {
  private history: CameraPose[] = [];
  private contextStart: { x: number; y: number } | undefined;
  private controller = new AbortController();
  private keys = new Set<string>();
  private flying = false;
  private enabled = true;
  private navigation: "select" | "orbit" | "walk" = "select";
  private saved: CameraPose | null = null;
  private cleanup: () => void;
  constructor(
    private engine: ShowroomEngine,
    private runtime: SceneRuntime,
    readonly orbit: OrbitControls,
    onContext?: (x: number, y: number) => void,
  ) {
    const canvas = engine.renderer.domElement,
      signal = this.controller.signal;
    orbit.mouseButtons.LEFT = undefined;
    orbit.mouseButtons.RIGHT = undefined;
    canvas.addEventListener("contextmenu", (event) => event.preventDefault(), {
      signal,
    });
    canvas.addEventListener(
      "pointerdown",
      (event) => {
        if (event.button === 2 && this.enabled)
          this.contextStart = { x: event.clientX, y: event.clientY };
        if (!this.enabled) return;
        orbit.mouseButtons.LEFT =
          event.altKey || this.navigation === "orbit"
            ? THREE.MOUSE.ROTATE
            : undefined;
        if (
          event.button === 2 ||
          (this.navigation === "walk" && event.button === 0)
        ) {
          this.remember();
          this.flying = true;
          orbit.enabled = false;
          canvas.focus();
          canvas.setPointerCapture(event.pointerId);
          event.stopImmediatePropagation();
        } else if (
          event.altKey ||
          event.button === 1 ||
          this.navigation === "orbit"
        )
          this.remember();
      },
      { capture: true, signal },
    );
    canvas.addEventListener(
      "pointermove",
      (event) => {
        if (!this.flying || !this.enabled) return;
        const euler = new THREE.Euler().setFromQuaternion(
          engine.camera.quaternion,
          "YXZ",
        );
        euler.y -= event.movementX * 0.003;
        euler.x = THREE.MathUtils.clamp(
          euler.x - event.movementY * 0.003,
          -1.53,
          1.53,
        );
        engine.camera.quaternion.setFromEuler(euler);
        orbit.target.copy(
          engine.camera
            .getWorldDirection(new THREE.Vector3())
            .multiplyScalar(1000)
            .add(engine.camera.position),
        );
        engine.requestRender();
      },
      { signal },
    );
    canvas.addEventListener(
      "pointerup",
      (event) => {
        if (
          event.button === 2 &&
          this.contextStart &&
          Math.hypot(
            event.clientX - this.contextStart.x,
            event.clientY - this.contextStart.y,
          ) < 4 &&
          !this.keys.size
        )
          onContext?.(event.clientX, event.clientY);
        this.contextStart = undefined;
      },
      { signal },
    );
    const release = () => {
      this.flying = false;
      this.keys.clear();
      orbit.enabled = this.enabled;
    };
    for (const event of ["pointerup", "pointercancel", "blur"])
      canvas.addEventListener(event, release, { signal });
    canvas.addEventListener(
      "keydown",
      (event) => {
        if (
          this.enabled &&
          this.flying &&
          !event.isComposing &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          [
            "KeyW",
            "KeyS",
            "KeyA",
            "KeyD",
            "KeyQ",
            "KeyE",
            "ShiftLeft",
            "ShiftRight",
          ].includes(event.code)
        ) {
          this.keys.add(event.code);
          event.preventDefault();
          engine.requestRender();
        }
      },
      { signal },
    );
    canvas.addEventListener("keyup", (event) => this.keys.delete(event.code), {
      signal,
    });
    this.cleanup = engine.onUpdate((dt: number) => {
      if (!this.enabled || !this.flying) return false;
      const z = Number(this.keys.has("KeyW")) - Number(this.keys.has("KeyS")),
        x = Number(this.keys.has("KeyD")) - Number(this.keys.has("KeyA")),
        y = Number(this.keys.has("KeyE")) - Number(this.keys.has("KeyQ"));
      if (!x && !y && !z) return false;
      const delta = new THREE.Vector3(x, y, -z)
        .normalize()
        .applyQuaternion(engine.camera.quaternion)
        .multiplyScalar(
          (runtime.document?.settings.moveSpeed ?? 1500) *
            dt *
            (this.keys.has("ShiftLeft") ? 3 : 1),
        );
      engine.camera.position.add(delta);
      orbit.target.add(delta);
      return true;
    });
  }
  get isFlying(): boolean {
    return this.flying;
  }
  pose(): CameraPose {
    return {
      position: this.engine.camera.position.toArray(),
      target: this.orbit.target.toArray(),
      fov: this.engine.camera.fov,
    };
  }
  private remember(): void {
    this.history.push(this.pose());
    if (this.history.length > 30) this.history.shift();
  }
  setPose(pose: CameraPose, remember = true): void {
    if (remember) this.remember();
    this.engine.camera.position.fromArray(pose.position);
    this.orbit.target.fromArray(pose.target);
    this.engine.camera.fov = pose.fov;
    this.engine.camera.updateProjectionMatrix();
    this.orbit.update();
    this.engine.requestRender();
  }
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    if (!enabled) {
      this.saved = this.pose();
      this.keys.clear();
      this.flying = false;
    }
    this.enabled = enabled;
    this.orbit.enabled = enabled;
    if (enabled && this.saved) {
      this.setPose(this.saved, false);
      this.saved = null;
    }
  }
  setNavigation(mode: "select" | "orbit" | "walk"): void {
    this.navigation = mode;
    this.orbit.mouseButtons.LEFT =
      mode === "orbit" ? THREE.MOUSE.ROTATE : undefined;
  }
  reset(remember = true): void {
    const s = this.runtime.document?.settings;
    if (!remember) this.history = [];
    if (s)
      this.setPose(
        { position: s.position, target: s.target, fov: s.fov },
        remember,
      );
  }
  back(): void {
    const pose = this.history.pop();
    if (pose) this.setPose(pose, false);
  }
  orient(direction: "front" | "top" | "right" | "perspective"): void {
    const current = this.pose(),
      distance =
        this.engine.camera.position.distanceTo(this.orbit.target) || 2000;
    const axis = {
      front: new THREE.Vector3(0, 0, 1),
      top: new THREE.Vector3(0, 0.999, 0.001),
      right: new THREE.Vector3(1, 0, 0),
      perspective: new THREE.Vector3(1, 0.7, 1).normalize(),
    }[direction];
    this.setPose({
      ...current,
      position: this.orbit.target
        .clone()
        .add(axis.multiplyScalar(distance))
        .toArray(),
    });
  }
  focus(ids: string[]): void {
    const objects = ids.length
      ? ids
          .map((id) => this.runtime.getObject(id))
          .filter((object): object is THREE.Object3D => Boolean(object))
      : [...this.runtime.objects.values()].map((instance) => instance.root);
    try {
      const pose = frameObjects(this.engine.camera, objects);
      this.engine.camera.far = pose.far;
      this.setPose(pose);
    } catch {
      /* An empty selection has no geometry to frame. */
    }
  }
  cancelInteraction(): boolean {
    if (!this.flying) return false;
    this.flying = false;
    this.contextStart = undefined;
    this.keys.clear();
    this.orbit.enabled = this.enabled;
    return true;
  }
  dispose(): void {
    this.controller.abort();
    this.cleanup();
  }
}
