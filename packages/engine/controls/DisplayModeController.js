/**
 * DisplayModeController: 外观模式 (Immersive) 与 X-Ray 透视模式 (Schematic) 切换控制器
 * 
 * 机制：
 *  - Immersive 模式：显示完整车身外壳 PBR 材质（高反光、不透明），隐藏内部底盘核心构件以节省性能
 *  - Schematic 模式：外壳半透明化 (alphaMode: BLEND)，关闭 depthWrite 避免遮挡，内部底盘/三电高亮显示
 */
export class DisplayModeController {
  constructor(events) {
    this.events = events;
    this.mode = 'immersive'; // 'immersive' | 'schematic'

    this._layers = {
      shell: [],
      chassis: [],
      components: []
    };

    this._materialSnapshots = new Map();
  }

  /**
   * 注册指定图层的网格数组
   * @param {'shell'|'chassis'|'components'} layerName 
   * @param {THREE.Mesh[]} meshes 
   */
  registerLayer(layerName, meshes) {
    if (!this._layers[layerName]) {
      this._layers[layerName] = [];
    }

    const targetList = Array.isArray(meshes) ? meshes : [meshes];
    for (const mesh of targetList) {
      if (!mesh || !mesh.isMesh) continue;
      this._layers[layerName].push(mesh);

      // 备份初始材质状态用于恢复
      if (!this._materialSnapshots.has(mesh.uuid)) {
        const mat = mesh.material;
        this._materialSnapshots.set(mesh.uuid, {
          transparent: Boolean(mat.transparent),
          opacity: mat.opacity !== undefined ? mat.opacity : 1.0,
          depthWrite: mat.depthWrite !== undefined ? mat.depthWrite : true,
          visible: Boolean(mesh.visible)
        });
      }
    }
  }

  /**
   * 自动从根节点或分组扫描并分类注册图层（根据命名规则）
   * @param {THREE.Object3D} rootObject 
   */
  autoRegisterFromScene(rootObject) {
    if (!rootObject) return;

    rootObject.traverse((obj) => {
      if (!obj.isMesh) return;
      const name = (obj.name || '').toLowerCase();

      if (/shell|exterior|body|paint|window|glass/i.test(name)) {
        this.registerLayer('shell', obj);
      } else if (/chassis|battery|motor|powertrain|frame|wheel|tire|brake/i.test(name)) {
        this.registerLayer('chassis', obj);
      } else if (/component|part|valve|clip|bracket|sensor/i.test(name)) {
        this.registerLayer('components', obj);
      }
    });

    // 初始化应用当前模式
    this._applyMode(this.mode);
  }

  setMode(targetMode) {
    if (this.mode === targetMode) return;
    this.mode = targetMode;
    this._applyMode(this.mode);
    this.events?.emit('displayModeChange', { mode: this.mode });
  }

  toggle() {
    this.setMode(this.mode === 'immersive' ? 'schematic' : 'immersive');
  }

  _applyMode(mode) {
    if (mode === 'immersive') {
      this._applyImmersive();
    } else {
      this._applySchematic();
    }
  }

  _applyImmersive() {
    // 1. 车身外壳恢复完整不透明
    for (const mesh of this._layers.shell) {
      const snap = this._materialSnapshots.get(mesh.uuid);
      mesh.visible = snap ? snap.visible : true;
      mesh.material.transparent = snap ? snap.transparent : false;
      mesh.material.opacity = snap ? snap.opacity : 1.0;
      mesh.material.depthWrite = true;
      mesh.material.needsUpdate = true;
    }

    // 2. 隐藏底层结构与零部件
    for (const mesh of this._layers.chassis) {
      mesh.visible = false;
    }
    for (const mesh of this._layers.components) {
      mesh.visible = false;
    }
  }

  _applySchematic() {
    // 1. 车身外壳转为透视 X-Ray 玻璃感
    for (const mesh of this._layers.shell) {
      mesh.visible = true;
      mesh.material.transparent = true;
      mesh.material.opacity = 0.18;
      // 避免半透明的外部面写入深度缓冲而遮挡内部精细零部件
      mesh.material.depthWrite = false;
      mesh.material.needsUpdate = true;
    }

    // 2. 点亮内部底盘三电与零部件
    for (const mesh of this._layers.chassis) {
      mesh.visible = true;
      mesh.material.depthWrite = true;
      mesh.material.needsUpdate = true;
    }
    for (const mesh of this._layers.components) {
      mesh.visible = true;
      mesh.material.depthWrite = true;
      mesh.material.needsUpdate = true;
    }
  }

  dispose() {
    this._materialSnapshots.clear();
    this._layers.shell = [];
    this._layers.chassis = [];
    this._layers.components = [];
  }
}
