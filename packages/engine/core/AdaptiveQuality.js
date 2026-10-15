/**
 * AdaptiveQuality.js
 * 自适应渲染画质与动态 Pixel Ratio 调节系统
 * 
 * 机制：
 * 当高分辨率屏幕（如 2K/4K/Retina）在复杂模型或大量零部件交互下出现 GPU 像素填充瓶颈时，
 * 动态平滑调降 renderer.setPixelRatio，避免卡顿；帧率稳定后平滑恢复。
 */
export class AdaptiveQuality {
  /**
   * @param {THREE.WebGLRenderer} renderer 
   * @param {Object} [options]
   * @param {boolean} [options.enabled=true]
   * @param {number} [options.minPixelRatio=1.0] 最小降级比例
   * @param {number} [options.maxPixelRatio] 最大比例（默认 Math.min(window.devicePixelRatio, 2.0)）
   * @param {number} [options.targetFps=55] 目标帧率下限
   */
  constructor(renderer, options = {}) {
    this.renderer = renderer;
    this.enabled = options.enabled !== undefined ? options.enabled : true;
    this.minPixelRatio = options.minPixelRatio || 1.0;
    this.maxPixelRatio = options.maxPixelRatio || Math.min(window.devicePixelRatio || 1, 2.0);
    this.targetFps = options.targetFps || 55;

    this.currentPixelRatio = this.maxPixelRatio;

    this._lowFpsFrames = 0;
    this._highFpsFrames = 0;
    this._checkInterval = 30; // 每 30 帧做一次决策
    this._frameCounter = 0;
  }

  /**
   * 记录帧耗时并自适应调节分辨率
   * @param {number} fps 
   */
  update(fps) {
    if (!this.enabled) return;

    this._frameCounter++;
    if (fps < this.targetFps - 10) {
      this._lowFpsFrames++;
      this._highFpsFrames = 0;
    } else if (fps >= this.targetFps) {
      this._highFpsFrames++;
      this._lowFpsFrames = 0;
    }

    if (this._frameCounter >= this._checkInterval) {
      this._frameCounter = 0;

      // 连续掉帧：平滑降低 Pixel Ratio
      if (this._lowFpsFrames >= 15 && this.currentPixelRatio > this.minPixelRatio) {
        this.currentPixelRatio = Math.max(this.minPixelRatio, Number((this.currentPixelRatio - 0.25).toFixed(2)));
        this.renderer.setPixelRatio(this.currentPixelRatio);
        this._lowFpsFrames = 0;
      }
      // 持续高帧率：平滑恢复 Pixel Ratio
      else if (this._highFpsFrames >= 30 && this.currentPixelRatio < this.maxPixelRatio) {
        this.currentPixelRatio = Math.min(this.maxPixelRatio, Number((this.currentPixelRatio + 0.25).toFixed(2)));
        this.renderer.setPixelRatio(this.currentPixelRatio);
        this._highFpsFrames = 0;
      }
    }
  }

  getPixelRatio() {
    return this.currentPixelRatio;
  }

  dispose() {
    this.renderer.setPixelRatio(this.maxPixelRatio);
  }
}
