import * as THREE from 'three';

/**
 * ArtworkManager: Manages dynamic artwork binding onto 3D picture frame meshes and interaction raycasting
 */
export class ArtworkManager {
  constructor(meshMap, camera, domElement, eventEmitter) {
    this.meshMap = meshMap;
    this.camera = camera;
    this.domElement = domElement;
    this.events = eventEmitter;

    this.manifest = {};
    this.boundMeshes = [];
    this.textureLoader = new THREE.TextureLoader();
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.hoveredMesh = null;
    this._bindEvents();
  }

  _bindEvents() {
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);

    this.domElement.addEventListener('pointermove', this._onPointerMove);
    this.domElement.addEventListener('pointerdown', this._onPointerDown);
  }

  dispose() {
    this.domElement.removeEventListener('pointermove', this._onPointerMove);
    this.domElement.removeEventListener('pointerdown', this._onPointerDown);

    // 释放所有动态绑定的艺术品画框材质和纹理显存
    for (const mesh of this.boundMeshes) {
      if (mesh.material) {
        if (mesh.material.map && typeof mesh.material.map.dispose === 'function') {
          mesh.material.map.dispose();
        }
        mesh.material.dispose();
      }
    }
    this.boundMeshes = [];
  }

  /**
   * Bind artworks to meshes from manifest map
   * 采用受控并发（批次大小 4），避免 57 张外部大图瞬间击穿网络与 GPU 上传峰值
   * @param {object} manifest Object with { [uuid]: { name, url, preview, showbox } }
   * @param {number} [concurrency=4]
   */
  async loadManifest(manifest, concurrency = 4) {
    this.manifest = manifest || {};
    this.boundMeshes = [];

    const entries = Object.entries(this.manifest);
    const validTasks = [];

    for (const [uuid, artInfo] of entries) {
      const mesh = this.meshMap.get(uuid);
      if (mesh) {
        mesh.userData.artwork = artInfo;
        this.boundMeshes.push(mesh);

        const imgUrl = artInfo.preview || artInfo.url;
        if (imgUrl) {
          validTasks.push({ mesh, imgUrl });
        }
      }
    }

    // 4 路受控并发加载队列
    const runWorker = async () => {
      while (validTasks.length > 0) {
        const item = validTasks.shift();
        if (!item) break;
        await this._loadSingleArtworkTexture(item.mesh, item.imgUrl);
      }
    };

    const workers = [];
    for (let i = 0; i < Math.min(concurrency, validTasks.length); i++) {
      workers.push(runWorker());
    }

    await Promise.all(workers);
    console.log(`[ArtworkManager] Successfully mounted ${this.boundMeshes.length} artworks onto 3D frames.`);
  }

  _loadSingleArtworkTexture(mesh, imgUrl) {
    return new Promise((resolve) => {
      this.textureLoader.load(
        imgUrl,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.generateMipmaps = true;
          texture.minFilter = THREE.LinearMipmapLinearFilter;
          texture.magFilter = THREE.LinearFilter;

          if (mesh.material) {
            // Clone material so individual paintings don't overwrite each other
            mesh.material = mesh.material.clone();
            mesh.material.map = texture;
            mesh.material.needsUpdate = true;
          }
          resolve();
        },
        undefined,
        (err) => {
          console.warn(`Failed to load artwork texture ${imgUrl}:`, err);
          resolve(); // 容错放行，不中断其它图片加载
        }
      );
    });
  }

  _updateMouseCoords(e) {
    const rect = this.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  _onPointerMove(e) {
    if (this.boundMeshes.length === 0) return;
    this._updateMouseCoords(e);

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.boundMeshes, false);

    if (intersects.length > 0) {
      const mesh = intersects[0].object;
      if (this.hoveredMesh !== mesh) {
        this.hoveredMesh = mesh;
        this.domElement.style.cursor = 'pointer';
        this.events.emit('artworkHover', mesh.userData.artwork);
      }
    } else {
      if (this.hoveredMesh) {
        this.hoveredMesh = null;
        this.domElement.style.cursor = 'default';
        this.events.emit('artworkUnhover');
      }
    }
  }

  _onPointerDown(e) {
    // Left-click only
    if (e.button !== 0 || this.boundMeshes.length === 0) return;
    this._updateMouseCoords(e);

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.boundMeshes, false);

    if (intersects.length > 0) {
      const mesh = intersects[0].object;
      const artwork = mesh.userData.artwork;
      if (artwork) {
        this.events.emit('artworkClick', artwork);
      }
    }
  }
}
