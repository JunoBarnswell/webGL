import * as THREE from 'three';
import type { SceneSettings } from '@studio/scene-schema';

export class Navigation {
  enabled = false;
  viewMode: 'first' | 'third' = 'first';
  eye = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  speed = 0;
  sprint = false;
  colliders: THREE.Object3D[] = [];
  grounds: THREE.Object3D[] = [];
  settings!: SceneSettings;
  private keys = new Set<string>();
  private dragging = false;
  private ray = new THREE.Raycaster();
  private previousCamera=new THREE.Vector3();
  private controller = new AbortController();
  onInterrupt?: () => void;
  constructor(private camera: THREE.PerspectiveCamera, private canvas: HTMLCanvasElement, private wake: () => void) {
    const signal = this.controller.signal;
    canvas.addEventListener('keydown', event => {
      if (!this.enabled) return;
      if (['KeyW','KeyS','KeyA','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight'].includes(event.code)) {
        event.preventDefault(); this.keys.add(event.code); this.onInterrupt?.(); wake();
      }
    }, { signal });
    canvas.addEventListener('keyup', event => { this.keys.delete(event.code); }, { signal });
    canvas.addEventListener('blur', () => { this.keys.clear(); this.dragging = false; }, { signal });
    canvas.addEventListener('pointerdown', event => {
      if (!this.enabled || event.button !== 0) return;
      this.dragging = true; canvas.focus(); canvas.setPointerCapture(event.pointerId);
    }, { signal });
    canvas.addEventListener('pointermove', event => {
      if (!this.enabled || !this.dragging) return;
      this.yaw -= event.movementX * this.settings.lookSensitivity; this.pitch = THREE.MathUtils.clamp(this.pitch - event.movementY * this.settings.lookSensitivity, -THREE.MathUtils.degToRad(this.settings.pitchLimit), THREE.MathUtils.degToRad(this.settings.pitchLimit)); wake();
    }, { signal });
    canvas.addEventListener('pointerup', () => { this.dragging = false; }, { signal });
    canvas.addEventListener('pointercancel', () => { this.dragging = false; this.keys.clear(); }, { signal });
    canvas.addEventListener('wheel', event => {
      if (!this.enabled) return;
      event.preventDefault(); camera.fov = THREE.MathUtils.clamp(camera.fov + event.deltaY * .02, 20, 110); camera.updateProjectionMatrix(); wake();
    }, { passive: false, signal });
  }
  reset(settings: SceneSettings): void {
    this.settings = settings; this.eye.fromArray(settings.position); this.lookAt(new THREE.Vector3().fromArray(settings.target));
    this.viewMode = settings.viewMode; this.keys.clear(); this.speed = 0; this.pose();
  }
  lookAt(target: THREE.Vector3): void {
    const direction = target.clone().sub(this.eye).normalize();
    this.yaw = Math.atan2(-direction.x, -direction.z); this.pitch = Math.asin(direction.y);
  }
  pose(dt=0): void {
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch,this.yaw,0,'YXZ'));
    if(this.viewMode==='first')this.camera.position.copy(this.eye);
    else {
      const feet=this.eye.clone().add(new THREE.Vector3(0,-this.settings.eyeHeight,0));
      const focus=feet.clone().add(new THREE.Vector3(0,this.settings.thirdPersonFocusHeight,0));
      const ideal=feet.clone().add(new THREE.Vector3(Math.sin(this.yaw)*this.settings.thirdPersonDistance,this.settings.thirdPersonHeight,Math.cos(this.yaw)*this.settings.thirdPersonDistance));
      const offset=ideal.sub(focus);
      this.ray.set(focus,offset.clone().normalize());this.ray.near=0;this.ray.far=offset.length();
      const hit=this.ray.intersectObjects(this.colliders,true)[0];
      if(hit)offset.setLength(Math.max(this.settings.thirdPersonMinDistance,hit.distance-this.settings.playerRadius));
      const target=focus.add(offset);if(dt)this.camera.position.lerp(target,1-Math.pow(1-this.settings.thirdPersonSmoothing,dt*60));else this.camera.position.copy(target);
      this.camera.lookAt(feet.add(new THREE.Vector3(0,this.settings.thirdPersonFocusHeight,0)));
    }
  }
  update(dt: number): boolean {
    if (!this.enabled) { this.speed = 0; return false; }
    this.previousCamera.copy(this.camera.position);
    const forward = Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown'));
    const right = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    this.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    this.speed = forward || right ? this.settings.moveSpeed * (this.sprint ? this.settings.sprintMultiplier : 1) : 0;
    if (this.speed) {
      const delta = new THREE.Vector3(right, 0, -forward).normalize().applyAxisAngle(new THREE.Vector3(0,1,0), this.yaw).multiplyScalar(this.speed * dt);
      const steps = Math.max(1, Math.ceil(delta.length() / Math.max(1, this.settings.playerRadius)));
      delta.divideScalar(steps);
      for (let step = 0; step < steps; step++) {
        let allowed = delta.length();
        if (this.settings.collision) {
          for (const height of [0, -.45 * this.settings.eyeHeight, -.85 * this.settings.eyeHeight]) {
            this.ray.set(this.eye.clone().add(new THREE.Vector3(0,height,0)), delta.clone().normalize());
            this.ray.near = 0; this.ray.far = delta.length() + this.settings.playerRadius;
            const hit = this.ray.intersectObjects(this.colliders, true)[0];
            if (hit) allowed = Math.min(allowed, Math.max(0, hit.distance - this.settings.playerRadius));
          }
        }
        this.eye.add(delta.clone().setLength(allowed));
      }
      if (this.settings.collision && this.grounds.length) {
        this.ray.set(this.eye.clone().add(new THREE.Vector3(0,2000,0)), new THREE.Vector3(0,-1,0)); this.ray.near = 0; this.ray.far = 8000;
        const hit = this.ray.intersectObjects(this.grounds, true)[0]; if (hit) this.eye.y = hit.point.y + this.settings.eyeHeight;
      }
    }
    this.pose(dt); return Boolean(this.speed || this.dragging || this.camera.position.distanceToSquared(this.previousCamera)>.01);
  }
  pause(): void { this.enabled = false; this.keys.clear(); this.dragging = false; }
  dispose(): void { this.pause(); this.controller.abort(); }
}
