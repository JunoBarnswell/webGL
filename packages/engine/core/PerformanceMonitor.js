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
    this.cpuUpdates = [];
    this.cpuRenders = [];
    this.gpuTimes = [];
    this.pendingQueries = [];
    this.longTasks = { count: 0, milliseconds: 0 };
    this.gl = renderer.getContext();
    this.gpuExtension = renderer.capabilities.isWebGL2
      ? this.gl.getExtension("EXT_disjoint_timer_query_webgl2")
      : null;
    this.observer = null;
    if (
      typeof PerformanceObserver !== "undefined" &&
      PerformanceObserver.supportedEntryTypes.includes("longtask")
    ) {
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.longTasks.count++;
          this.longTasks.milliseconds += entry.duration;
        }
      });
      this.observer.observe({ type: "longtask", buffered: false });
    }

    this._initDom();
  }

  _initDom() {
    this.domElement = document.createElement("div");
    this.domElement.id = "perf-monitor-hud";
    Object.assign(this.domElement.style, {
      position: "absolute",
      top: "57px",
      left: "12px",
      zIndex: "12",
      backgroundColor: "rgba(15, 23, 42, 0.85)",
      backdropFilter: "blur(8px)",
      border: "1px solid rgba(255, 255, 255, 0.1)",
      borderRadius: "8px",
      padding: "10px 14px",
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: "11px",
      color: "#e2e8f0",
      lineHeight: "1.5",
      pointerEvents: "auto",
      userSelect: "none",
      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
      display: this.visible ? "block" : "none",
      minWidth: "200px",
    });

    this.domElement.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:4px; margin-bottom:6px; font-weight:600;">
        <span style="color:#38bdf8;">性能统计</span>
        <span style="font-size:9px; color:#94a3b8;">调度间隔</span>
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

  toggle() {
    this.visible = !this.visible;
    if (this.domElement) {
      this.domElement.style.display = this.visible ? "block" : "none";
    }
  }

  /**
   * 记录一帧结束
   */
  sample(list, value) {
    list.push(value);
    if (list.length > this.maxHistory) list.shift();
  }
  beginGpu() {
    if (!this.gpuExtension || this.pendingQueries.length >= 4) return null;
    const query = this.gl.createQuery();
    this.gl.beginQuery(this.gpuExtension.TIME_ELAPSED_EXT, query);
    return query;
  }
  endGpu(query) {
    if (!query) return;
    this.gl.endQuery(this.gpuExtension.TIME_ELAPSED_EXT);
    this.pendingQueries.push(query);
  }
  update() {
    if (this.gpuExtension) {
      const disjoint = this.gl.getParameter(this.gpuExtension.GPU_DISJOINT_EXT);
      for (const query of [...this.pendingQueries]) {
        if (!this.gl.getQueryParameter(query, this.gl.QUERY_RESULT_AVAILABLE))
          continue;
        if (!disjoint)
          this.sample(
            this.gpuTimes,
            this.gl.getQueryParameter(query, this.gl.QUERY_RESULT) / 1e6,
          );
        this.gl.deleteQuery(query);
        this.pendingQueries.splice(this.pendingQueries.indexOf(query), 1);
      }
    }
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

    const fpsEl = this.domElement.querySelector("#pm-fps");
    const timeEl = this.domElement.querySelector("#pm-time");
    const p50El = this.domElement.querySelector("#pm-p50");
    const p95El = this.domElement.querySelector("#pm-p95");
    const callsEl = this.domElement.querySelector("#pm-calls");
    const triEl = this.domElement.querySelector("#pm-triangles");
    const geomsEl = this.domElement.querySelector("#pm-geoms");
    const textEl = this.domElement.querySelector("#pm-textures");

    if (fpsEl) {
      fpsEl.textContent = this.fps;
      fpsEl.style.color =
        this.fps >= 55 ? "#4ade80" : this.fps >= 30 ? "#fbbf24" : "#ef4444";
    }
    if (timeEl) timeEl.textContent = `${this.avgFrameTime.toFixed(1)} ms`;
    if (p50El) p50El.textContent = `${this.p50} ms`;
    if (p95El) p95El.textContent = `${this.p95} ms`;
    if (callsEl) callsEl.textContent = calls;
    if (triEl)
      triEl.textContent =
        triangles > 1000 ? `${(triangles / 1000).toFixed(1)}k` : triangles;
    if (geomsEl) geomsEl.textContent = geoms;
    if (textEl) textEl.textContent = textures;
  }

  /**
   * 获取当前性能与开销指标快照
   */
  getMetrics() {
    const rInfo = this.renderer.info;
    return {
      cpuUpdate: this.distribution(this.cpuUpdates),
      cpuRender: this.distribution(this.cpuRenders),
      gpu: this.gpuExtension ? this.distribution(this.gpuTimes) : null,
      longTasks: { ...this.longTasks },
      fps: this.fps,
      avgFrameTime: Number(this.avgFrameTime.toFixed(2)),
      p50: Number(this.p50),
      p95: Number(this.p95),
      p99: Number(this.p99),
      drawCalls: rInfo.render.calls,
      triangles: rInfo.render.triangles,
      geometries: rInfo.memory.geometries,
      textures: rInfo.memory.textures,
    };
  }

  distribution(samples) {
    const sorted = [...samples].sort((a, b) => a - b);
    return {
      samples: sorted.length,
      p50: sorted[Math.floor(sorted.length * 0.5)] ?? null,
      p95:
        sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ??
        null,
      p99:
        sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] ??
        null,
    };
  }
  dispose() {
    this.observer?.disconnect();
    for (const query of this.pendingQueries) this.gl.deleteQuery(query);
    this.pendingQueries = [];
    if (this.domElement && this.domElement.parentNode) {
      this.domElement.parentNode.removeChild(this.domElement);
    }
    this.frameTimes = [];
  }
}
