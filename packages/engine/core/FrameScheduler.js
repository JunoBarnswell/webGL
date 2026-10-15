/**
 * FrameScheduler.js
 * 工业级帧调度器与脏标记按需渲染系统
 * 
 * 核心设计：
 * 1. 模拟更新 (Simulation Update) 与 渲染绘制 (Render Decision) 分离
 * 2. 脏标记追踪 (Dirty State Tracker)：无变动时进入按需休眠，GPU/CPU 负载降至近 0
 * 3. 动态唤醒 (Event-driven Wakeup)：按键、拖拽、动画、过渡自动唤醒 60/120Hz 全速渲染
 * 4. 帧率无关插值 (Frame-rate Independent Damping)：解决 60Hz 与 144Hz 屏幕手感差异
 */

export class FrameScheduler {
  /**
   * @param {Object} callbacks
   * @param {Function} callbacks.onUpdate 模拟推进回调 (delta) => boolean (返回 true 代表有动态变化)
   * @param {Function} callbacks.onRender 渲染执行回调 (delta)
   * @param {Object} [options]
   * @param {boolean} [options.onDemand=true] 是否启用按需重绘优化
   * @param {number} [options.idleFramesThreshold=3] 静止多少帧后进入空闲休眠
   * @param {number} [options.heartbeatInterval=1000] 休眠期间心跳重绘间隔(ms)，保证画面一致性
   */
  constructor(callbacks, options = {}) {
    this.onUpdate = callbacks.onUpdate || (() => false);
    this.onRender = callbacks.onRender || (() => {});

    this.onDemand = options.onDemand !== undefined ? options.onDemand : true;
    this.idleFramesThreshold = options.idleFramesThreshold || 3;
    this.heartbeatInterval = options.heartbeatInterval || 1000;

    this.isRunning = false;
    this.rafId = null;
    this.lastTime = performance.now();
    this.lastRenderTime = 0;

    // 脏标记与静止帧计数
    this._dirtyFrames = this.idleFramesThreshold; // 初始渲染几帧以完成场景沉淀
    this._isIdle = false;

    // 帧率与统计
    this.fps = 60;
    this._frameCount = 0;
    this._lastFpsUpdate = performance.now();

    this._tick = this._tick.bind(this);
  }

  /**
   * 标记场景为脏（需要重绘），唤醒渲染管线
   * @param {number} [frames=3] 保持渲染的帧数（默认 3 帧确保过渡平滑完成）
   */
  markDirty(frames = 3) {
    this._dirtyFrames = Math.max(this._dirtyFrames, frames);
    this._isIdle = false;
  }

  /**
   * 启动帧调度循环
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();
    this.lastRenderTime = this.lastTime;
    this.markDirty(5);
    this.rafId = requestAnimationFrame(this._tick);
  }

  /**
   * 停止帧调度循环
   */
  stop() {
    this.isRunning = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * 主循环帧回调
   * @private
   */
  _tick(currentTime) {
    if (!this.isRunning) return;

    // 限制单帧最大 delta 为 100ms，避免切后台唤醒时的物理爆炸
    const delta = Math.min((currentTime - this.lastTime) / 1000, 0.1);
    this.lastTime = currentTime;

    // 统计 FPS
    this._frameCount++;
    if (currentTime - this._lastFpsUpdate >= 500) {
      this.fps = Math.round((this._frameCount * 1000) / (currentTime - this._lastFpsUpdate));
      this._frameCount = 0;
      this._lastFpsUpdate = currentTime;
    }

    // 1. 模拟阶段推进 (Simulation Update)
    // onUpdate 可以返回 boolean，告知调度器本帧是否有活跃状态（如移动、过渡、动画）
    let hasSimulationActivity = false;
    try {
      hasSimulationActivity = Boolean(this.onUpdate(delta));
    } catch (err) {
      console.error('[FrameScheduler] Error in onUpdate:', err);
    }

    if (hasSimulationActivity) {
      this._dirtyFrames = Math.max(this._dirtyFrames, 2);
    }

    // 2. 渲染决策 (Render Decision)
    const isHeartbeatDue = currentTime - this.lastRenderTime >= this.heartbeatInterval;
    const shouldRender = !this.onDemand || this._dirtyFrames > 0 || isHeartbeatDue;

    if (shouldRender) {
      try {
        this.onRender(delta);
        this.lastRenderTime = currentTime;
      } catch (err) {
        console.error('[FrameScheduler] Error in onRender:', err);
      }

      if (this._dirtyFrames > 0) {
        this._dirtyFrames--;
      }
      this._isIdle = false;
    } else {
      this._isIdle = true;
    }

    this.rafId = requestAnimationFrame(this._tick);
  }

  /**
   * 帧率无关平滑阻尼公式 (Exponential Decay)
   * 在 60Hz、120Hz、144Hz 等任意高刷设备上保持完全一致的手感
   * @param {number} current 当前值
   * @param {number} target 目标值
   * @param {number} lambda 衰减阻尼系数 (通常 8~15)
   * @param {number} delta 帧耗时(秒)
   */
  static damp(current, target, lambda, delta) {
    return target + (current - target) * Math.exp(-lambda * delta);
  }

  /**
   * 向量级别的帧率无关平滑阻尼
   */
  static dampVector3(currentVec, targetVec, lambda, delta) {
    const factor = 1 - Math.exp(-lambda * delta);
    currentVec.lerp(targetVec, factor);
    return currentVec;
  }

  get isIdle() {
    return this._isIdle;
  }

  dispose() {
    this.stop();
  }
}
