import * as THREE from 'three';

/**
 * CruiseManager: Automated 3D spline tour cruise system with playback controls and path planning
 */
export class CruiseManager {
  constructor(camera, avatarManager, cameraController, eventEmitter) {
    this.camera = camera;
    this.avatar = avatarManager;
    this.controller = cameraController;
    this.events = eventEmitter;

    // Spline curve points
    this.curve = null;
    this._initCruisePath();

    // Playback state
    this.isPlaying = false;
    this.progress = 0; // 0.0 to 1.0
    this.speed = 1.0; // 1.0x, 1.5x, 2.0x
    this.baseDuration = 55.0; // Seconds for full tour at 1.0x speed

    // Dwell/Pause state at key exhibits
    this.isDwelling = false;
    this.dwellTimer = 0;
    this.dwellStops = [
      { progress: 0.12, name: 'A区 - 经典油画展位', duration: 2.5 },
      { progress: 0.35, name: 'B区 - 印象光影展位', duration: 2.5 },
      { progress: 0.62, name: 'C区 - 当代表现展位', duration: 2.5 },
      { progress: 0.85, name: 'D区 - 抽象意象展位', duration: 2.5 }
    ];
    this.visitedStops = new Set();
  }

  _initCruisePath() {
    // 3D waypoints through the exhibition showroom corridors and halls
    const points = [
      new THREE.Vector3(-1846, 2000, 726),      // 展厅入口
      new THREE.Vector3(-6000, 2000, -8000),     // 前往A区过道
      new THREE.Vector3(-11142, 2000, -20020),   // A区 经典写实油画
      new THREE.Vector3(-15500, 2000, -13500),   // AB区连接廊
      new THREE.Vector3(-13619, 2000, -5834),    // B区 印象派光影
      new THREE.Vector3(-5000, 2000, 8000),      // 中央挑高中庭
      new THREE.Vector3(4864, 2000, 25700),      // C区 当代浪漫表现
      new THREE.Vector3(-2500, 2000, 29000),     // CD区回廊
      new THREE.Vector3(-10323, 2000, 29875),    // D区 抽象意象空间
      new THREE.Vector3(-12000, 2000, 16000),    // 西侧返程廊
      new THREE.Vector3(-5500, 2000, 5000)       // 汇合回入口
    ];

    // CatmullRomCurve3 with centripetal tension for gentle natural corners
    this.curve = new THREE.CatmullRomCurve3(points, true, 'centripetal', 0.5);
  }

  start() {
    this.isPlaying = true;
    this.visitedStops.clear();
    if (this.events) this.events.emit('cruiseStateChange', { isPlaying: true, progress: this.progress, speed: this.speed });
  }

  pause() {
    this.isPlaying = false;
    if (this.events) this.events.emit('cruiseStateChange', { isPlaying: false, progress: this.progress, speed: this.speed });
  }

  toggle() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.start();
    }
  }

  stop() {
    this.pause();
    this.progress = 0;
    this.visitedStops.clear();
  }

  setSpeed(speedMultiplier) {
    this.speed = Math.max(0.5, Math.min(3.0, speedMultiplier));
    if (this.events) this.events.emit('cruiseStateChange', { isPlaying: this.isPlaying, progress: this.progress, speed: this.speed });
  }

  seek(newProgress) {
    this.progress = Math.max(0, Math.min(1.0, newProgress));
    this._applyPoseAt(this.progress);
    if (this.events) this.events.emit('cruiseProgress', { progress: this.progress });
  }

  _applyPoseAt(t) {
    const pos = this.curve.getPointAt(t);
    const tangent = this.curve.getTangentAt(t);

    // Look-ahead target point
    const lookTarget = pos.clone().add(tangent.clone().multiplyScalar(2000));

    // Update camera and avatar
    this.camera.position.copy(pos);
    this.camera.lookAt(lookTarget);

    // Update camera controller yaw/pitch angles to prevent sudden jump when user takes over
    const dir = tangent.normalize();
    this.controller.pitch = Math.asin(dir.y);
    this.controller.yaw = Math.atan2(-dir.x, -dir.z);

    // Position character at feet level
    if (this.avatar) {
      const avatarPos = pos.clone();
      avatarPos.y = 0; // Feet on floor
      this.avatar.setPose(avatarPos, this.controller.yaw);
    }
  }

  /**
   * Called per frame by RenderLoop
   */
  update(delta) {
    if (!this.isPlaying) return;

    // Handle temporary dwelling at key highlights
    if (this.isDwelling) {
      this.dwellTimer -= delta;
      if (this.dwellTimer <= 0) {
        this.isDwelling = false;
      }
      return;
    }

    // Advance progress along spline
    const step = (delta * this.speed) / this.baseDuration;
    this.progress = (this.progress + step) % 1.0;

    // Check dwell stops
    for (const stop of this.dwellStops) {
      if (!this.visitedStops.has(stop.name)) {
        if (Math.abs(this.progress - stop.progress) < 0.015) {
          this.isDwelling = true;
          this.dwellTimer = stop.duration;
          this.visitedStops.add(stop.name);
          if (this.events) this.events.emit('cruiseDwell', stop);
          break;
        }
      }
    }

    // Reset visited stops on loop
    if (this.progress < 0.05 && this.visitedStops.size > 2) {
      this.visitedStops.clear();
    }

    this._applyPoseAt(this.progress);

    if (this.events) {
      this.events.emit('cruiseProgress', { progress: this.progress });
    }
  }
}
