/**
 * AssetScheduler.js
 * 统一资源加载与并发任务调度器
 * 
 * 核心能力：
 * 1. 并发度控制 (Concurrency Pool)：防止浏览器请求排队与主线程解析暴击
 * 2. 飞行中请求去重 (In-flight Deduplication)：相同 URL 共享同一个加载 Promise
 * 3. 优先级队列 (Priority Queue)：高优先级（可见结构/碰撞网格）优先调度
 * 4. 任务取消与生命周期管理：场景切换时取消未完成的网络请求
 * 5. 精细化进度统计：分阶段跟踪任务完成百分比
 */

export const PRIORITY = {
  CRITICAL: 0, // 关键核心（例如首屏地面、主展厅结构）
  HIGH: 1,     // 高优先级（可见 Mesh、主光照贴图）
  NORMAL: 2,   // 普通（常规展品、动态零件）
  LOW: 3       // 低优先级（远景区、预取、次要贴图）
};

export class AssetScheduler {
  /**
   * @param {Object} [options]
   * @param {number} [options.concurrency=6] 最大并发加载数（推荐 4~8）
   * @param {Function} [options.onProgress] 进度回调 ({ completed, total, percent })
   */
  constructor(options = {}) {
    this.concurrency = Math.max(1, options.concurrency || 6);
    this.onProgress = options.onProgress || null;

    // 优先级队列数组：index 0 -> CRITICAL, index 3 -> LOW
    this._queues = [[], [], [], []];
    this._activeCount = 0;

    // 飞行中请求映射 (key -> Promise)，用于去重
    this._inFlight = new Map();

    // 进度统计
    this._totalTasks = 0;
    this._completedTasks = 0;

    // 中断控制器列表
    this._abortControllers = new Set();
    this._isDisposed = false;
  }

  /**
   * 添加一个加载任务到调度队列
   * @param {string} key 任务唯一标识（通常为 URL）
   * @param {Function} taskFn 异步加载执行函数 (signal) => Promise<any>
   * @param {number} [priority=PRIORITY.NORMAL] 优先级
   * @returns {Promise<any>}
   */
  schedule(key, taskFn, priority = PRIORITY.NORMAL) {
    if (this._isDisposed) {
      return Promise.reject(new Error('[AssetScheduler] Scheduler is disposed'));
    }

    // 1. 飞行中请求去重：如果已有相同 key 的任务在执行或排队，直接返回已有 Promise
    if (this._inFlight.has(key)) {
      return this._inFlight.get(key);
    }

    this._totalTasks++;
    const clampedPriority = Math.max(0, Math.min(3, priority));

    const promise = new Promise((resolve, reject) => {
      const taskItem = {
        key,
        taskFn,
        priority: clampedPriority,
        resolve,
        reject
      };

      this._queues[clampedPriority].push(taskItem);
      this._drain();
    });

    this._inFlight.set(key, promise);
    this._reportProgress();

    return promise;
  }

  /**
   * 调度队列调度执行
   * @private
   */
  _drain() {
    if (this._isDisposed) return;

    while (this._activeCount < this.concurrency) {
      const task = this._popNextTask();
      if (!task) break;

      this._activeCount++;
      const abortCtrl = new AbortController();
      this._abortControllers.add(abortCtrl);

      task.taskFn(abortCtrl.signal)
        .then((result) => {
          task.resolve(result);
        })
        .catch((err) => {
          task.reject(err);
        })
        .finally(() => {
          this._abortControllers.delete(abortCtrl);
          this._activeCount--;
          this._completedTasks++;
          this._inFlight.delete(task.key);
          this._reportProgress();
          this._drain();
        });
    }
  }

  /**
   * 从高优先级到低优先级弹出下一个任务
   * @private
   */
  _popNextTask() {
    for (let p = 0; p < this._queues.length; p++) {
      if (this._queues[p].length > 0) {
        return this._queues[p].shift();
      }
    }
    return null;
  }

  /**
   * 上报进度
   * @private
   */
  _reportProgress() {
    if (!this.onProgress) return;
    const total = this._totalTasks;
    const completed = this._completedTasks;
    const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 100;
    this.onProgress({ completed, total, percent });
  }

  /**
   * 重置进度统计
   */
  resetProgress() {
    this._totalTasks = 0;
    this._completedTasks = 0;
  }

  /**
   * 获取当前排队与执行中的任务数
   */
  getStatus() {
    let queued = 0;
    for (const q of this._queues) {
      queued += q.length;
    }
    return {
      active: this._activeCount,
      queued,
      inFlight: this._inFlight.size,
      completed: this._completedTasks,
      total: this._totalTasks
    };
  }

  /**
   * 取消所有尚未开始与正在执行的任务
   */
  cancelAll() {
    // 触发所有活跃请求的 AbortController
    for (const ctrl of this._abortControllers) {
      try {
        ctrl.abort();
      } catch (e) {
        // ignore
      }
    }
    this._abortControllers.clear();

    // 拒绝所有排队任务
    for (const queue of this._queues) {
      while (queue.length > 0) {
        const task = queue.shift();
        task.reject(new Error('[AssetScheduler] Task cancelled'));
      }
    }

    this._inFlight.clear();
    this._activeCount = 0;
  }

  dispose() {
    this._isDisposed = true;
    this.cancelAll();
    this.onProgress = null;
  }
}
