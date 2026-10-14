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
  }

  /**
   * Bind artworks to meshes from manifest map
   * @param {object} manifest Object with { [uuid]: { name, url, preview, showbox } }
   */
  async loadManifest(manifest) {
    this.manifest = manifest || {};
    this.boundMeshes = [];

    const entries = Object.entries(this.manifest);
    for (const [uuid, artInfo] of entries) {
      const mesh = this.meshMap.get(uuid);
      if (mesh) {
        mesh.userData.artwork = artInfo;
        this.boundMeshes.push(mesh);

        // Load artwork texture dynamically
        if (artInfo.preview || artInfo.url) {
          const imgUrl = artInfo.preview || artInfo.url;
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
            },
            undefined,
            (err) => console.warn(`Failed to load artwork texture ${imgUrl}:`, err)
          );
        }
      }
    }

    console.log(`[ArtworkManager] Successfully mounted ${this.boundMeshes.length} artworks onto 3D frames.`);
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
