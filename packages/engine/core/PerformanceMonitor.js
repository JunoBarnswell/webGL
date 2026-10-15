/**
 * PerformanceMonitor.js
 * 运行时性能遥测与监控系统
 * 
 * 核心指标：
 * - FPS 与帧耗时分布 (P50, P95, P99)
 * - GPU 提交指标 (Draw Calls, Triangles, Points, Lines)
 * - 资源占用 (Geometries, Textures, Memory)
 */
export class PerformanceMonitor {
  /**
   * @param {THREE.WebGLRenderer} renderer 
   * @param {Object} [options]
   * @param {HTMLElement} [options.container] 
   * @param {boolean} [options.visible=true]
   * @param {number} [options.maxHistory=120] 
   */
  constructor(renderer, options = {}) {
    this.renderer = renderer;
    this.container = options.container || document.body;
    this.visible = options.visible !== undefined ? options.visible : true;
    this.maxHistory = options.maxHistory || 120;

    // 帧耗时历史（ms）
    this.frameTimes = [];
    this.lastFrameTimestamp = performance.now();
    this.fps = 60;
    this.avgFrameTime = 16.6;
    this.p50 = 16.6;
    this.p95 = 16.6;
    this.p99 = 16.6;

    // 统计刷新节流（250ms 刷新一次 DOM，降低监控本身的 CPU 消耗）
    this.lastUiUpdate = 0;
    this.uiUpdateInterval = 250;

    this.domElement = null;
    this._onKeyDown = this._onKeyDown.bind(this);

    this._initDom();
    window.addEventListener('keydown', this._onKeyDown);
  }

  _initDom() {
    this.domElement = document.createElement('div');
    this.domElement.id = 'perf-monitor-hud';
    Object.assign(this.domElement.style, {
      position: 'fixed',
      top: '12px',
      left: '12px',
      zIndex: '99999',
      backgroundColor: 'rgba(15, 23, 42, 0.85)',
      backdropFilter: 'blur(8px)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '8px',
      padding: '10px 14px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: '11px',
      color: '#e2e8f0',
      lineHeight: '1.5',
      pointerEvents: 'auto',
      userSelect: 'none',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
      display: this.visible ? 'block' : 'none',
      minWidth: '200px'
    });

    this.domElement.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:4px; margin-bottom:6px; font-weight:600;">
        <span style="color:#38bdf8;">⚡ ENGINE TELEMETRY</span>
        <span style="font-size:9px; color:#94a3b8;">F2 / ~ 开关</span>
      </div>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:4px 12px;">
        <div>FPS: <strong id="pm-fps" style="color:#4ade80;">--</strong></div>
        <div>Frame: <span id="pm-time">-- ms</span></div>
        <div>P50: <span id="pm-p50">-- ms</span></div>
        <div>P95: <span id="pm-p95" style="color:#fbbf24;">-- ms</span></div>
        <div>Draw Calls: <strong id="pm-calls" style="color:#38bdf8;">--</strong></div>
        <div>Triangles: <span id="pm-triangles">--</span></div>
        <div>Geometries: <span id="pm-geoms">--</span></div>
        <div>Textures: <span id="pm-textures">--</span></div>
      </div>
    `;

    this.container.appendChild(this.domElement);
  }

  _onKeyDown(e) {
    if (e.key === 'F2' || e.key === '`') {
      this.toggle();
    }
  }

  toggle() {
    this.visible = !this.visible;
    if (this.domElement) {
      this.domElement.style.display = this.visible ? 'block' : 'none';
    }
  }

  /**
   * 记录一帧结束
   */
  update() {
    const now = performance.now();
    const delta = now - this.lastFrameTimestamp;
    this.lastFrameTimestamp = now;

    if (delta > 0 && delta < 1000) {
      this.frameTimes.push(delta);
      if (this.frameTimes.length > this.maxHistory) {
        this.frameTimes.shift();
      }
    }

    if (now - this.lastUiUpdate >= this.uiUpdateInterval) {
      this.lastUiUpdate = now;
      this._calculateMetrics();
      if (this.visible && this.domElement) {
        this._renderDom();
      }
    }
  }

  _calculateMetrics() {
    if (this.frameTimes.length === 0) return;

    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((acc, v) => acc + v, 0);

    this.avgFrameTime = sum / count;
    this.fps = Math.round(1000 / this.avgFrameTime);

    this.p50 = sorted[Math.floor(count * 0.5)].toFixed(1);
    this.p95 = sorted[Math.min(count - 1, Math.floor(count * 0.95))].toFixed(1);
    this.p99 = sorted[Math.min(count - 1, Math.floor(count * 0.99))].toFixed(1);
  }

  _renderDom() {
    const rInfo = this.renderer.info;
    const calls = rInfo.render.calls;
    const triangles = rInfo.render.triangles;
    const geoms = rInfo.memory.geometries;
    const textures = rInfo.memory.textures;

    const fpsEl = this.domElement.querySelector('#pm-fps');
    const timeEl = this.domElement.querySelector('#pm-time');
    const p50El = this.domElement.querySelector('#pm-p50');
    const p95El = this.domElement.querySelector('#pm-p95');
    const callsEl = this.domElement.querySelector('#pm-calls');
    const triEl = this.domElement.querySelector('#pm-triangles');
    const geomsEl = this.domElement.querySelector('#pm-geoms');
    const textEl = this.domElement.querySelector('#pm-textures');

    if (fpsEl) {
      fpsEl.textContent = this.fps;
      fpsEl.style.color = this.fps >= 55 ? '#4ade80' : (this.fps >= 30 ? '#fbbf24' : '#ef4444');
    }
    if (timeEl) timeEl.textContent = `${this.avgFrameTime.toFixed(1)} ms`;
    if (p50El) p50El.textContent = `${this.p50} ms`;
    if (p95El) p95El.textContent = `${this.p95} ms`;
    if (callsEl) callsEl.textContent = calls;
    if (triEl) triEl.textContent = triangles > 1000 ? `${(triangles / 1000).toFixed(1)}k` : triangles;
    if (geomsEl) geomsEl.textContent = geoms;
    if (textEl) textEl.textContent = textures;
  }

  /**
   * 获取当前性能与开销指标快照
   */
  getMetrics() {
    const rInfo = this.renderer.info;
    return {
      fps: this.fps,
      avgFrameTime: Number(this.avgFrameTime.toFixed(2)),
      p50: Number(this.p50),
      p95: Number(this.p95),
      p99: Number(this.p99),
      drawCalls: rInfo.render.calls,
      triangles: rInfo.render.triangles,
      geometries: rInfo.memory.geometries,
      textures: rInfo.memory.textures
    };
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    if (this.domElement && this.domElement.parentNode) {
      this.domElement.parentNode.removeChild(this.domElement);
    }
    this.frameTimes = [];
  }
}
