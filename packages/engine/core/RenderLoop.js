/**
 * RenderLoop: Manages requestAnimationFrame, delta time, and FPS calculation
 */
export class RenderLoop {
  constructor(renderFn) {
    this.renderFn = renderFn;
    this.isRunning = false;
    this.rafId = null;
    this.lastTime = performance.now();
    this.fps = 60;
    this._frameCount = 0;
    this._lastFpsUpdate = performance.now();
    this._tasks = new Set();
  }

  addTask(fn) {
    this._tasks.add(fn);
    return () => this._tasks.delete(fn);
  }

  removeTask(fn) {
    this._tasks.delete(fn);
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();
    this._tick = this._tick.bind(this);
    this.rafId = requestAnimationFrame(this._tick);
  }

  stop() {
    this.isRunning = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  _tick(currentTime) {
    if (!this.isRunning) return;

    const delta = Math.min((currentTime - this.lastTime) / 1000, 0.1); // Cap at 100ms
    this.lastTime = currentTime;

    // Calculate FPS
    this._frameCount++;
    if (currentTime - this._lastFpsUpdate >= 500) {
      this.fps = Math.round((this._frameCount * 1000) / (currentTime - this._lastFpsUpdate));
      this._frameCount = 0;
      this._lastFpsUpdate = currentTime;
    }

    // Run registered tasks (controls, tweens, animations)
    for (const task of this._tasks) {
      try {
        task(delta, currentTime);
      } catch (err) {
        console.error('Error in RenderLoop task:', err);
      }
    }

    // Call primary render function
    if (this.renderFn) {
      this.renderFn(delta, currentTime);
    }

    this.rafId = requestAnimationFrame(this._tick);
  }
}
