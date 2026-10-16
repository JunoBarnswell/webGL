export interface AssetTaskOptions {
  signal?: AbortSignal;
  onProgress?: (message: string, completed: number, total: number) => void;
}
interface Job {
  operation: string;
  payload: unknown;
  options: AssetTaskOptions;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  abort: () => void;
  finish?: () => void;
}
/** One cancellable, bounded worker lifecycle for resource and editor document analysis tasks. */
export function createWorkerTaskPool(factory: () => Worker, concurrency = 2) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16)
    throw Error("Worker 并发范围为 1～16");
  const queue: Job[] = [],
    slots: { worker: Worker | null; busy: boolean }[] = Array.from(
      { length: concurrency },
      () => ({ worker: null, busy: false }),
    );
  const start = () => {
    for (const slot of slots) {
      if (slot.busy || !queue.length) continue;
      const job = queue.shift()!;
      if (job.options.signal?.aborted) {
        job.abort();
        continue;
      }
      slot.busy = true;
      let worker: Worker;
      try {
        worker = slot.worker ?? factory();
        slot.worker = worker;
      } catch (error) {
        slot.busy = false;
        job.options.signal?.removeEventListener("abort", job.abort);
        job.reject(error instanceof Error ? error : Error(String(error)));
        continue;
      }
      let done = false;
      const finish = (error?: Error, result?: unknown) => {
        if (done) return;
        done = true;
        job.finish = undefined;
        worker.onmessage = null;
        worker.onerror = null;
        job.options.signal?.removeEventListener("abort", job.abort);
        if (error) {
          worker.terminate();
          slot.worker = null;
        }
        slot.busy = false;
        if (error) job.reject(error);
        else job.resolve(result);
        start();
      };
      job.finish = () => finish(new DOMException("任务已取消", "AbortError"));
      worker.onmessage = (event) => {
        const value = event.data;
        if (value.progress) {
          job.options.onProgress?.(value.message, value.completed, value.total);
          return;
        }
        if (value.error) finish(Error(value.error));
        else finish(undefined, value.result);
      };
      worker.onerror = (event) =>
        finish(Error("Worker 失败：" + event.message));
      try {
        worker.postMessage({ operation: job.operation, payload: job.payload });
      } catch (error) {
        finish(error instanceof Error ? error : Error(String(error)));
      }
    }
    if (queue.length && slots.some((slot) => !slot.busy)) queueMicrotask(start);
  };
  return function run<T>(
    operation: string,
    payload: unknown,
    options: AssetTaskOptions = {},
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const job: Job = {
        operation,
        payload,
        options,
        resolve: resolve as (value: unknown) => void,
        reject,
        abort: () => {
          if (job.finish) {
            job.finish();
            return;
          }
          const index = queue.indexOf(job);
          if (index >= 0) queue.splice(index, 1);
          options.signal?.removeEventListener("abort", job.abort);
          reject(new DOMException("任务已取消", "AbortError"));
        },
      };
      if (options.signal?.aborted) {
        job.abort();
        return;
      }
      options.signal?.addEventListener("abort", job.abort, { once: true });
      queue.push(job);
      start();
    });
  };
}
export const runAssetTask = createWorkerTaskPool(
  () =>
    new Worker(new URL("./asset.worker.ts", import.meta.url), {
      type: "module",
    }),
);
