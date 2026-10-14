import * as THREE from 'three';
import { EventEmitter } from './EventEmitter.js';
import { RenderLoop } from './RenderLoop.js';
import { O2vrMeshLoader } from '../loader/O2vrMeshLoader.js';
import { SceneParser } from '../loader/SceneParser.js';
import { LightmapManager } from '../material/LightmapManager.js';
import { EnvironmentMap } from '../material/EnvironmentMap.js';
import { MaterialFactory } from '../material/MaterialFactory.js';
import { CollisionSystem } from '../controls/CollisionSystem.js';
import { CameraController } from '../controls/CameraController.js';
import { ArtworkManager } from '../business/ArtworkManager.js';
import { ZoneGuideManager } from '../business/ZoneGuideManager.js';
import { AudioSystem } from '../business/AudioSystem.js';
import { AvatarManager } from '../avatar/AvatarManager.js';
import { ViewModeManager, VIEW_MODES } from '../controls/ViewModeManager.js';
import { CruiseManager } from '../business/CruiseManager.js';
import { PanoramaSystem } from '../business/PanoramaSystem.js';
import { DisplayModeController } from '../controls/DisplayModeController.js';
import { HotspotSystem } from '../business/HotspotSystem.js';
import { ComponentMountSystem } from '../business/ComponentMountSystem.js';

/**
 * ShowroomEngine: Top-level unified facade for the 3D exhibition showroom
 */
export class ShowroomEngine {
  constructor(options = {}) {
    this.container = options.container || document.body;
    this.events = new EventEmitter();

    // 1. Core Three.js setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(options.backgroundColor || 0x111317);

    const aspect = this.container.clientWidth / this.container.clientHeight || 1;
    this.camera = new THREE.PerspectiveCamera(options.fov || 60, aspect, 10, options.maxDistance || 30000);
    this.camera.position.set(-1846, 2000, 726); // Default entrance position

    this.renderer = new THREE.WebGLRenderer({
      antialias: options.antialias !== undefined ? options.antialias : true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.container.appendChild(this.renderer.domElement);

    // 2. Ambient & Directional Lighting
    this._setupLighting();

    // 3. Subsystem instances
    this.meshLoader = new O2vrMeshLoader();
    this.lightmapManager = new LightmapManager();
    this.envMapManager = new EnvironmentMap();
    this.materialFactory = new MaterialFactory(this.lightmapManager, this.envMapManager);
    this.sceneParser = new SceneParser(this.meshLoader, this.materialFactory);

    this.collisionSystem = new CollisionSystem();
    if (options.collision !== undefined) {
      this.collisionSystem.enabled = options.collision;
    }

    this.cameraController = new CameraController(this.camera, this.renderer.domElement, this.collisionSystem);
    this.zoneGuide = new ZoneGuideManager(this.cameraController, this.events);
    this.audio = new AudioSystem(options.bgmUrl || '', this.events);

    // Advanced features: Avatar, ViewMode, Cruise, Panorama
    this.avatar = new AvatarManager(this.scene);
    this.viewMode = new ViewModeManager(this.camera, this.avatar, this.cameraController, this.collisionSystem, this.events);
    // Pass collisionSystem so CruiseManager can do collision-aware pathing
    this.cruise = new CruiseManager(this.camera, this.avatar, this.cameraController, this.collisionSystem, this.events);
    this.panorama = new PanoramaSystem(this.renderer, this.scene, this.camera, this.cameraController, this.events);

    // Automotive / Exhibition specialized systems
    this.displayMode = new DisplayModeController(this.events);
    this.hotspot = new HotspotSystem(this.camera, this.container, this.events);
    this.componentMount = new ComponentMountSystem(this.scene, this.camera, this.events);

    this.artworkManager = null;
    this.meshMap = new Map();

    // 4. Render Loop
    this.renderLoop = new RenderLoop((delta) => {
      if (this.cruise.isPlaying) {
        // During cruise: CruiseManager owns camera position & orientation
        this.cruise.update(delta);
        this.avatar.update(delta, 2500, false);
      } else {
        // Normal roaming: CameraController advances characterPos & rotation
        this.cameraController.update(delta);

        // Avatar orientation: face movement direction when walking, else face camera heading
        const avatarTargetYaw = this.cameraController.currentSpeed > 0
          ? this.cameraController.moveDirectionYaw
          : this.cameraController.yaw;

        this.avatar.setPose(this.cameraController.characterPos, avatarTargetYaw);
        this.avatar.update(delta, this.cameraController.currentSpeed, this.cameraController.keys.sprint);

        // ViewModeManager owns ALL camera positioning:
        if (this.viewMode.mode === VIEW_MODES.THIRD_PERSON) {
          // Third-person: camera arm behind avatar based on character heading
          this.viewMode.updateThirdPerson(
            this.cameraController.characterPos,
            this.cameraController.yaw  // character heading (not mouse pitch)
          );
        } else {
          // First-person: camera at exact eye level, rotation from mouse yaw/pitch
          this.viewMode.updateFirstPerson(this.cameraController.characterPos);
        }
      }

      // Update dynamic components animations
      this.componentMount.update(delta);

      this.renderer.render(this.scene, this.camera);

      // Project 3D hotspots to 2D DOM screen space
      this.hotspot.update();
    });

    // 5. Handle Resize
    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);

    this.renderLoop.start();
  }

  _setupLighting() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfff6ea, 0.5);
    dirLight.position.set(5000, 10000, 5000);
    this.scene.add(dirLight);
  }

  _onResize() {
    if (!this.container || !this.renderer) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  /**
   * Load entire showroom scene, avatar model and optional artwork manifest
   */
  async loadScene({ sceneUrl, baseUrl = '', manifestUrl = '', avatarUrl = '/model/avatar/character.glb' }) {
    this.sceneParser.setBaseUrl(baseUrl);
    this.lightmapManager.setBaseUrl(baseUrl);
    this.envMapManager.setBaseUrl(baseUrl);
    this.materialFactory.setBaseUrl(baseUrl);

    this.events.emit('loadStart');

    // 1. Parse and load 3D showroom scene
    const { root, colliObjects, groundObjects, meshMap } = await this.sceneParser.parse(
      sceneUrl,
      (percent, loaded, total) => {
        this.events.emit('progress', { percent, loaded, total });
      }
    );

    this.meshMap = meshMap;
    this.scene.add(root);

    // Auto-register display mode layers (exterior shell vs interior chassis)
    this.displayMode.autoRegisterFromScene(root);

    // Setup collision and floor clamping
    this.collisionSystem.setColliObjects(colliObjects);
    this.collisionSystem.setGroundObjects(groundObjects);

    // 2. Load 3D Character Avatar
    if (avatarUrl) {
      try {
        await this.avatar.load(avatarUrl);
        // Default to first-person (avatar hidden)
        this.viewMode.setMode(VIEW_MODES.FIRST_PERSON);
      } catch (err) {
        console.warn('[ShowroomEngine] Avatar load failed, continuing in pure roaming mode:', err);
      }
    }

    // 3. Initialize ArtworkManager for dynamic mounting and raycast interactions
    this.artworkManager = new ArtworkManager(this.meshMap, this.camera, this.renderer.domElement, this.events);

    // 4. Load artwork manifest if provided
    if (manifestUrl) {
      try {
        const res = await fetch(manifestUrl);
        if (res.ok) {
          const manifest = await res.json();
          await this.artworkManager.loadManifest(manifest);
        }
      } catch (err) {
        console.warn('Failed to load artwork manifest:', err);
      }
    }

    this.events.emit('loadComplete');
  }

  // --- Public APIs ---

  on(event, handler) {
    return this.events.on(event, handler);
  }

  off(event, handler) {
    this.events.off(event, handler);
  }

  flyToZone(zoneKey) {
    this.zoneGuide.flyToZone(zoneKey);
  }

  getAllZones() {
    return this.zoneGuide.getAllZones();
  }

  setCollision(enabled) {
    this.collisionSystem.enabled = enabled;
  }

  toggleAudio() {
    this.audio.toggle();
  }

  // View Mode API
  toggleViewMode() {
    this.viewMode.toggle();
  }

  getViewMode() {
    return this.viewMode.mode;
  }

  // Cruise API
  startCruise() {
    this.cruise.start();
  }

  pauseCruise() {
    this.cruise.pause();
  }

  toggleCruise() {
    this.cruise.toggle();
  }

  setCruiseSpeed(speed) {
    this.cruise.setSpeed(speed);
  }

  seekCruise(progress) {
    this.cruise.seek(progress);
  }

  // 720 Panorama API
  togglePanorama() {
    this.panorama.togglePanoramaMode();
  }

  export720Panorama(width = 2048, height = 1024) {
    return this.panorama.export720Snapshot(width, height);
  }

  // Display Mode (Immersive / Schematic X-Ray) API
  toggleDisplayMode() {
    this.displayMode.toggle();
  }

  setDisplayMode(mode) {
    this.displayMode.setMode(mode);
  }

  getDisplayMode() {
    return this.displayMode.mode;
  }

  // Hotspot API
  addHotspot(hotspotDef) {
    this.hotspot.add(hotspotDef);
  }

  removeHotspot(id) {
    this.hotspot.remove(id);
  }

  clearHotspots() {
    this.hotspot.clear();
  }

  // Component Mount API (Streaming glTF loading & assembly)
  async mountComponent(componentDef, parentObject = null) {
    return this.componentMount.mount(componentDef, parentObject);
  }

  unmountComponent(id) {
    this.componentMount.unmount(id);
  }

  playComponentAnimation(id, animationIndex = 0) {
    this.componentMount.playAnimation(id, animationIndex);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.renderLoop.stop();
    this.cameraController.dispose();
    if (this.artworkManager) this.artworkManager.dispose();
    this.panorama.dispose();
    this.displayMode.dispose();
    this.hotspot.dispose();
    this.componentMount.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement && this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
    this.events.clear();
  }
}

