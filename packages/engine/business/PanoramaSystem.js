import * as THREE from 'three';

/**
 * PanoramaSystem: 720-degree spherical free-look viewing, FOV zoom, and 720-degree Equirectangular panorama snapshot export
 */
export class PanoramaSystem {
  constructor(renderer, scene, camera, cameraController, eventEmitter) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.controller = cameraController;
    this.events = eventEmitter;

    this.isPanoramaMode = false;
    this.baseFov = camera.fov;
    this.currentFov = camera.fov;

    this._bindZoom();
  }

  _bindZoom() {
    this._onWheel = (e) => {
      if (!this.isPanoramaMode) return;
      e.preventDefault();
      // Zoom in/out FOV between 30 and 95 degrees
      this.currentFov = Math.max(30, Math.min(95, this.currentFov + e.deltaY * 0.05));
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    };

    window.addEventListener('wheel', this._onWheel, { passive: false });
  }

  dispose() {
    window.removeEventListener('wheel', this._onWheel);
  }

  setPanoramaMode(enabled) {
    this.isPanoramaMode = enabled;
    if (this.isPanoramaMode) {
      // Widen view and unconstrain pitch
      this.currentFov = 75;
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
      this.controller.minPitch = -Math.PI / 2.05;
      this.controller.maxPitch = Math.PI / 2.05;
    } else {
      // Restore standard walking FOV
      this.currentFov = this.baseFov;
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
      this.controller.minPitch = -Math.PI / 2.2;
      this.controller.maxPitch = Math.PI / 2.2;
    }

    if (this.events) {
      this.events.emit('panoramaModeChange', { enabled: this.isPanoramaMode });
    }
  }

  togglePanoramaMode() {
    this.setPanoramaMode(!this.isPanoramaMode);
  }

  /**
   * Capture and export standard 2:1 Equirectangular 720° panorama image
   * @param {number} width Resolution width (e.g. 2048 or 4096)
   * @param {number} height Resolution height (e.g. 1024 or 2048)
   */
  async export720Snapshot(width = 2048, height = 1024) {
    if (this.events) this.events.emit('panoramaExportStart');

    // 1. Create CubeRenderTarget and CubeCamera
    const cubeRenderTarget = new THREE.WebGLCubeRenderTarget(1024, {
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      colorSpace: THREE.SRGBColorSpace
    });

    const cubeCamera = new THREE.CubeCamera(10, 35000, cubeRenderTarget);
    cubeCamera.position.copy(this.camera.position);

    // Hide UI elements or helpers before shooting
    cubeCamera.update(this.renderer, this.scene);

    // 2. Offscreen scene to convert CubeMap to Equirectangular
    const equiScene = new THREE.Scene();
    const equiCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const equiMaterial = new THREE.ShaderMaterial({
      uniforms: {
        envMap: { value: cubeRenderTarget.texture }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform samplerCube envMap;
        varying vec2 vUv;
        #define PI 3.141592653589793
        void main() {
          float theta = vUv.x * 2.0 * PI - PI;
          float phi = (1.0 - vUv.y) * PI - PI * 0.5;
          vec3 dir = vec3(cos(phi) * sin(theta), sin(phi), cos(phi) * cos(theta));
          gl_FragColor = textureCube(envMap, dir);
        }
      `
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), equiMaterial);
    equiScene.add(quad);

    const equiRenderTarget = new THREE.WebGLRenderTarget(width, height, {
      colorSpace: THREE.SRGBColorSpace
    });

    // 3. Render Equirectangular projection
    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(equiRenderTarget);
    this.renderer.render(equiScene, equiCamera);
    this.renderer.setRenderTarget(prevTarget);

    // 4. Read pixels into Canvas2D for image download
    const pixels = new Uint8Array(width * height * 4);
    this.renderer.readRenderTargetPixels(equiRenderTarget, 0, 0, width, height, pixels);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(width, height);

    // Flip Y during pixel copy (WebGL reads from bottom-left)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = ((height - 1 - y) * width + x) * 4;
        const dstIdx = (y * width + x) * 4;
        imgData.data[dstIdx] = pixels[srcIdx];
        imgData.data[dstIdx + 1] = pixels[srcIdx + 1];
        imgData.data[dstIdx + 2] = pixels[srcIdx + 2];
        imgData.data[dstIdx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // 5. Trigger download
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    const link = document.createElement('a');
    link.download = `720_Panorama_Showroom_${Date.now()}.jpg`;
    link.href = dataUrl;
    link.click();

    // Clean up GPU render targets
    cubeRenderTarget.dispose();
    equiRenderTarget.dispose();
    equiMaterial.dispose();
    quad.geometry.dispose();

    if (this.events) this.events.emit('panoramaExportComplete', { dataUrl });
    console.log('[PanoramaSystem] 720° Equirectangular Panorama exported successfully.');
  }
}
