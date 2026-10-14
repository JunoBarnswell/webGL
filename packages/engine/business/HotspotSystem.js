import * as THREE from 'three';

/**
 * HotspotSystem: 3D 空间热点标记到 2D DOM 屏幕投影系统
 * 
 * 功能：
 *  - 注册 3D 世界坐标点并动态生成 DOM 交互 Pin
 *  - 实时矩阵投影变换 (World Space -> NDC -> Screen Pixels)
 *  - 视锥近平面/背向裁剪（在相机后方时不渲染）
 *  - 点击事件交互转发
 */
export class HotspotSystem {
  constructor(camera, container, events) {
    this.camera = camera;
    this.container = container;
    this.events = events;

    this._hotspots = new Map(); // id -> { def, domEl, worldVec }
    this._domLayer = this._createDomLayer();
    this.container.appendChild(this._domLayer);
  }

  _createDomLayer() {
    const layer = document.createElement('div');
    layer.className = 'hotspot-layer';
    layer.style.cssText = `
      position: absolute;
      inset: 0;
      pointer-events: none;
      overflow: hidden;
      z-index: 10;
    `;
    return layer;
  }

  /**
   * 注册一个 3D 热点
   * @param {object} def
   * @param {string} def.id - 唯一标识
   * @param {string} def.label - 标题名称
   * @param {{x: number, y: number, z: number}} def.worldPosition - 3D 世界坐标
   * @param {object} [def.data] - 附加业务数据
   */
  add(def) {
    if (!def || !def.id) return;
    if (this._hotspots.has(def.id)) {
      this.remove(def.id);
    }

    const worldVec = new THREE.Vector3(
      def.worldPosition.x || 0,
      def.worldPosition.y || 0,
      def.worldPosition.z || 0
    );

    const domEl = this._createHotspotElement(def);
    this._domLayer.appendChild(domEl);

    this._hotspots.set(def.id, {
      def,
      domEl,
      worldVec
    });
  }

  /**
   * 移除热点
   * @param {string} id 
   */
  remove(id) {
    const entry = this._hotspots.get(id);
    if (!entry) return;
    if (entry.domEl && entry.domEl.parentNode) {
      entry.domEl.parentNode.removeChild(entry.domEl);
    }
    this._hotspots.delete(id);
  }

  _createHotspotElement(def) {
    const el = document.createElement('div');
    el.className = 'hotspot-pin';
    el.dataset.id = def.id;
    el.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      transform: translate3d(-50%, -50%, 0);
      pointer-events: auto;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      background: rgba(18, 24, 38, 0.85);
      border: 1px solid rgba(0, 195, 255, 0.6);
      box-shadow: 0 0 12px rgba(0, 195, 255, 0.35);
      border-radius: 16px;
      color: #fff;
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
      user-select: none;
      transition: opacity 0.2s ease, transform 0.2s ease;
      will-change: transform, opacity;
    `;

    const icon = document.createElement('span');
    icon.style.cssText = `
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #00c3ff;
      box-shadow: 0 0 6px #00c3ff;
      display: inline-block;
    `;

    const text = document.createElement('span');
    text.textContent = def.label || def.id;

    el.appendChild(icon);
    el.appendChild(text);

    el.addEventListener('pointerenter', () => {
      el.style.transform = 'translate3d(-50%, -50%, 0) scale(1.1)';
      el.style.borderColor = '#00e5ff';
    });

    el.addEventListener('pointerleave', () => {
      el.style.transform = 'translate3d(-50%, -50%, 0) scale(1.0)';
      el.style.borderColor = 'rgba(0, 195, 255, 0.6)';
    });

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.events?.emit('hotspotClick', def);
    });

    return el;
  }

  /**
   * 每帧更新热点屏幕投影坐标（在 RenderLoop 中调用）
   */
  update() {
    if (this._hotspots.size === 0) return;

    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    // 预分配临时向量以避免 GC 压力
    const tempVec = new THREE.Vector3();

    for (const [, entry] of this._hotspots) {
      tempVec.copy(entry.worldVec);
      tempVec.project(this.camera);

      // z > 1 说明在视锥体远平面之后或在相机正后方
      if (tempVec.z > 1.0) {
        entry.domEl.style.opacity = '0';
        entry.domEl.style.pointerEvents = 'none';
        continue;
      }

      // 投影 NDC [-1, 1] 映射至屏幕像素坐标 [0, width / height]
      const screenX = (tempVec.x * 0.5 + 0.5) * width;
      const screenY = (-(tempVec.y * 0.5) + 0.5) * height;

      // 屏幕外一定边缘缓冲裁剪
      if (screenX < -100 || screenX > width + 100 || screenY < -100 || screenY > height + 100) {
        entry.domEl.style.opacity = '0';
        entry.domEl.style.pointerEvents = 'none';
        continue;
      }

      entry.domEl.style.opacity = '1';
      entry.domEl.style.pointerEvents = 'auto';
      entry.domEl.style.transform = `translate3d(${screenX}px, ${screenY}px, 0) translate(-50%, -50%)`;
    }
  }

  clear() {
    for (const [, entry] of this._hotspots) {
      if (entry.domEl.parentNode) {
        entry.domEl.parentNode.removeChild(entry.domEl);
      }
    }
    this._hotspots.clear();
  }

  dispose() {
    this.clear();
    if (this._domLayer && this._domLayer.parentNode) {
      this._domLayer.parentNode.removeChild(this._domLayer);
    }
  }
}
