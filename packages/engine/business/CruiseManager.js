import * as THREE from 'three';
import { normalizeAngleDiff } from '../core/MathUtils.js';

/**
 * CruiseManager: Automated 3D spline tour cruise system with collision-safe path planning.
 *
 * Plan A Mode:
 *  - First-person cinematic tour (Avatar is hidden by default to ensure an unobstructed view of the art)
 *  - Eye height at calibrated human perspective (Y=1750mm)
 *  - Camera yaw/pitch smoothly interpolated with normalizeAngleDiff to avoid gimbal flips
 *  - Dwell stops synchronize with gallery zone highlights
 */
export class CruiseManager {
  constructor(camera, avatarManager, cameraController, collisionSystem, eventEmitter) {
    this.camera = camera;
    this.avatar = avatarManager;
    this.controller = cameraController;
    this.collision = collisionSystem;
    this.events = eventEmitter;

    this.curve = null;
    this._initCruisePath();

    // Playback state
    this.isPlaying = false;
    this.progress = 0; // 0.0 → 1.0
    this.speed = 1.0;
    this.baseDuration = 60.0; // seconds for one full loop at 1x
    this.wasAvatarVisible = false;

    // Dwell/pause at key waypoints
    this.isDwelling = false;
    this.dwellTimer = 0;
    this.dwellEnvelopeTime = 0.5; // seconds to ease in/out of dwell

    this.dwellStops = [
      { progress: 0.10, zoneKey: 'A', name: 'A区 - 经典写实油画', duration: 3.0 },
      { progress: 0.33, zoneKey: 'B', name: 'B区 - 印象派光影',   duration: 3.0 },
      { progress: 0.60, zoneKey: 'C', name: 'C区 - 当代浪漫表现', duration: 3.0 },
      { progress: 0.83, zoneKey: 'D', name: 'D区 - 抽象意象空间', duration: 3.0 }
    ];
    this.visitedStops = new Set();

    // Internal interpolation – separate from camera so we can lerp
    this._desiredPos    = new THREE.Vector3();
    this._desiredTarget = new THREE.Vector3();
    this._lerpAlpha = 0.08; // position smoothness
    this._lookAlpha = 0.06; // look-target smoothness
  }

  // ------------------------------------------------------------------
  // Path definition: flat waypoints at calibrated EYE height (Y=1750 mm)
  // ------------------------------------------------------------------
  _initCruisePath() {
    const EYE = 1750; // calibrated human eye height
    const points = [
      new THREE.Vector3(-1846,  EYE,   726),
      new THREE.Vector3(-4500,  EYE, -4000),
      new THREE.Vector3(-8000,  EYE,-12000),
      new THREE.Vector3(-11142, EYE,-20020),
      new THREE.Vector3(-14000, EYE,-16000),
      new THREE.Vector3(-15500, EYE,-10000),
      new THREE.Vector3(-13619, EYE, -5834),
      new THREE.Vector3( -8000, EYE,  2000),
      new THREE.Vector3( -3000, EYE,  9000),
      new THREE.Vector3(  4864, EYE, 20000),
      new THREE.Vector3(  2000, EYE, 27000),
      new THREE.Vector3(-10323, EYE, 29875),
      new THREE.Vector3(-13000, EYE, 22000),
      new THREE.Vector3(-12000, EYE, 12000),
      new THREE.Vector3( -7000, EYE,  5000),
      new THREE.Vector3( -3000, EYE,  2000),
    ];

    this.curve = new THREE.CatmullRomCurve3(points, true, 'centripetal', 0.5);

    // Pre-bake evenly-spaced positions for smooth parameterisation
    this._arcLengthDivisions = 500;
    this.curve.arcLengthDivisions = this._arcLengthDivisions;
    this.curve.updateArcLengths();
  }

  // ------------------------------------------------------------------
  // Playback controls
  // ------------------------------------------------------------------
  start() {
    this.isPlaying = true;
    this.visitedStops.clear();

    // Plan A: Hide avatar during cruise so visual exhibition is pure and unobstructed
    if (this.avatar) {
      this.wasAvatarVisible = this.avatar.isVisible;
      this.avatar.setVisible(false);
    }

    this._syncDesiredFromProgress();
    this.events?.emit('cruiseStateChange', { isPlaying: true, progress: this.progress, speed: this.speed });
  }

  pause() {
    this.isPlaying = false;
    this.events?.emit('cruiseStateChange', { isPlaying: false, progress: this.progress, speed: this.speed });
  }

  toggle() {
    this.isPlaying ? this.pause() : this.start();
  }

  stop() {
    this.pause();
    this.progress = 0;
    this.visitedStops.clear();

    // Restore avatar visibility state prior to cruise
    if (this.wasAvatarVisible && this.avatar) {
      this.avatar.setVisible(true);
    }

    // Hand over camera position and player feet to CameraController
    if (this.controller) {
      this.controller.characterPos.set(
        this.camera.position.x,
        0,
        this.camera.position.z
      );
    }

    this.events?.emit('cruiseProgress', { progress: 0 });
  }

  setSpeed(s) {
    this.speed = Math.max(0.25, Math.min(4.0, s));
    this.events?.emit('cruiseStateChange', { isPlaying: this.isPlaying, progress: this.progress, speed: this.speed });
  }

  seek(t) {
    this.progress = Math.max(0, Math.min(1.0, t));
    this._syncDesiredFromProgress();
    this.events?.emit('cruiseProgress', { progress: this.progress });
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  _syncDesiredFromProgress() {
    const pos = this.curve.getPointAt(this.progress);
    const tangent = this._getFlatTangent(this.progress);
    this._desiredPos.copy(pos);
    this._desiredTarget.copy(pos).addScaledVector(tangent, 3000);
    // Snap camera instantly when seeking/starting
    this.camera.position.copy(this._desiredPos);
    this._applyCameraLook(this._desiredTarget);
  }

  /** Returns horizontal-only unit tangent (no vertical drift) */
  _getFlatTangent(t) {
    const raw = this.curve.getTangentAt(t);
    raw.y = 0;
    return raw.lengthSq() > 0 ? raw.normalize() : new THREE.Vector3(0, 0, -1);
  }

  /** Update controller angles from look direction so hand-off is smooth */
  _applyCameraLook(lookTarget) {
    const dir = lookTarget.clone().sub(this.camera.position).normalize();
    this.controller.pitch = 0; // keep horizon during cruise
    this.controller.yaw   = Math.atan2(-dir.x, -dir.z);
    const euler = new THREE.Euler(0, this.controller.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);
  }

  // ------------------------------------------------------------------
  // Per-frame update
  // ------------------------------------------------------------------
  update(delta) {
    if (!this.isPlaying) return;

    // --- Dwell management -----------------------------------------
    if (this.isDwelling) {
      this.dwellTimer -= delta;
      if (this.dwellTimer <= 0) {
        this.isDwelling = false;
      }
      // Keep camera smoothly frozen (lerp to same point keeps it stable)
      this._lerpCamera(delta);
      return;
    }

    // --- Advance progress ----------------------------------------
    const step = (delta * this.speed) / this.baseDuration;
    this.progress = (this.progress + step) % 1.0;

    // --- Check dwell stops ----------------------------------------
    for (const stop of this.dwellStops) {
      if (!this.visitedStops.has(stop.name) &&
          Math.abs(this.progress - stop.progress) < 0.012) {
        this.isDwelling = true;
        this.dwellTimer = stop.duration;
        this.visitedStops.add(stop.name);
        this.events?.emit('cruiseDwell', stop);
        if (stop.zoneKey) {
          this.events?.emit('zoneChange', { key: stop.zoneKey, name: stop.name });
        }
        break;
      }
    }

    // Reset visited stops on loop
    if (this.progress < 0.03 && this.visitedStops.size > 2) {
      this.visitedStops.clear();
    }

    // --- Compute desired pose from spline -------------------------
    const pos    = this.curve.getPointAt(this.progress);
    const tangent = this._getFlatTangent(this.progress);

    this._desiredPos.copy(pos);
    this._desiredTarget.copy(pos).addScaledVector(tangent, 3000);

    // --- Apply smooth lerp to camera ------------------------------
    this._lerpCamera(delta);

    // Plan A: keep avatar hidden during cruise so visual exhibition is pure and unobstructed
    if (this.avatar && this.avatar.isVisible) {
      this.avatar.setVisible(false);
    }

    this.events?.emit('cruiseProgress', { progress: this.progress });
  }

  _lerpCamera(delta) {
    // Position – smooth exponential lerp (frame-rate independent)
    const alpha = 1 - Math.pow(1 - this._lerpAlpha, delta * 60);
    this.camera.position.lerp(this._desiredPos, alpha);

    // Look direction – smooth yaw rotation using normalizeAngleDiff to avoid 360 flip
    const lookAlpha = 1 - Math.pow(1 - this._lookAlpha, delta * 60);
    const dir = this._desiredTarget.clone().sub(this.camera.position).normalize();
    const targetYaw = Math.atan2(-dir.x, -dir.z);

    const diff = normalizeAngleDiff(targetYaw - this.controller.yaw);
    this.controller.yaw += diff * lookAlpha;
    this.controller.pitch = this.controller.pitch * (1 - lookAlpha); // ease back to 0

    const euler = new THREE.Euler(this.controller.pitch, this.controller.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);

    const euler = new THREE.Euler(this.controller.pitch, this.controller.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);
  }
}
