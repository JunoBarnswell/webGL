import * as THREE from "three";
import { FrameScheduler } from "./FrameScheduler.js";
import { AdaptiveQuality } from "./AdaptiveQuality.js";
import { PerformanceMonitor } from "./PerformanceMonitor.js";
import { ResourceRegistry } from "./ResourceRegistry.js";

/** Device owner. Scene documents and all business semantics belong to SceneRuntime. */
export class ShowroomEngine {
  constructor({ container }) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 10, 35000);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute("aria-label", "三维场景视口");
    container.appendChild(this.renderer.domElement);
    this.resourceRegistry = new ResourceRegistry();
    this.updates = new Set();
    this.renders = new Set();
    this.adaptiveQuality = new AdaptiveQuality(this.renderer);
    this.perfMonitor = new PerformanceMonitor(this.renderer, {
      container,
      visible: false,
    });
    this.frameScheduler = new FrameScheduler({
      onUpdate: (delta) => {
        const started = performance.now();
        let active = false;
        for (const update of this.updates) active = update(delta) || active;
        this.perfMonitor.sample(
          this.perfMonitor.cpuUpdates,
          performance.now() - started,
        );
        return active;
      },
      onRender: () => {
        const started = performance.now(),
          query = this.perfMonitor.beginGpu();
        this.renderer.render(this.scene, this.camera);
        this.perfMonitor.endGpu(query);
        for (const callback of this.renders) callback();
        this.perfMonitor.sample(
          this.perfMonitor.cpuRenders,
          performance.now() - started,
        );
        this.adaptiveQuality.update(this.frameScheduler.fps);
        this.perfMonitor.update();
      },
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.frameScheduler.start();
  }
  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.requestRender();
  }
  requestRender(frames = 3) {
    this.frameScheduler.markDirty(frames);
  }
  onUpdate(callback) {
    this.updates.add(callback);
    return () => this.updates.delete(callback);
  }
  onRender(callback) {
    this.renders.add(callback);
    return () => this.renders.delete(callback);
  }
  dispose() {
    this.resizeObserver.disconnect();
    this.frameScheduler.dispose();
    this.updates.clear();
    this.renders.clear();
    this.perfMonitor.dispose();
    this.resourceRegistry.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
