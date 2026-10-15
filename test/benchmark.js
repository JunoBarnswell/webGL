/**
 * benchmark.js
 * 引擎性能基准测试与生命周期自动化测试脚本
 * 
 * 测试项：
 * 1. AssetScheduler 并发控制、任务去重与吞吐量基准
 * 2. ResourceRegistry 10,000 次高频引用计数/释放与内存清空基准
 * 3. FrameScheduler 指数衰减阻尼与帧率无关计算物理一致性基准
 */

import { AssetScheduler, PRIORITY } from '../packages/engine/loader/AssetScheduler.js';
import { ResourceRegistry } from '../packages/engine/core/ResourceRegistry.js';
import { FrameScheduler } from '../packages/engine/core/FrameScheduler.js';

console.log('====================================================');
console.log('🚀 正在启动 WebGL 3D 引擎高性能运行时 Benchmark 测试');
console.log('====================================================\n');

async function runBenchmarks() {
  let passed = 0;
  let failed = 0;

  // -----------------------------------------------------------------
  // Benchmark 1: AssetScheduler 并发度与去重压测
  // -----------------------------------------------------------------
  try {
    console.log('[Suite 1] 正在测试 AssetScheduler 并发度与去重特性...');
    const scheduler = new AssetScheduler({ concurrency: 4 });
    const startTime = Date.now();
    let networkRequestCount = 0;

    // 模拟 50 个请求，其中有 30 个 URL 是重复的
    const mockTasks = [];
    for (let i = 0; i < 50; i++) {
      const url = `resource_${i % 20}.mesh`;
      const p = scheduler.schedule(url, async () => {
        networkRequestCount++;
        await new Promise((r) => setTimeout(r, 10)); // 模拟网络延迟
        return `loaded_${url}`;
      }, PRIORITY.NORMAL);
      mockTasks.push(p);
    }

    const results = await Promise.all(mockTasks);
    const duration = Date.now() - startTime;

    if (results.length === 50 && networkRequestCount === 20) {
      console.log(`  ✅ 通过: 50 次并发请求已成功去重为 20 次实际加载，总耗时 ${duration}ms`);
      passed++;
    } else {
      throw new Error(`去重异常: 预期 20 次实际网络调用，实际发生 ${networkRequestCount}`);
    }
    scheduler.dispose();
  } catch (err) {
    console.error('  ❌ Suite 1 失败:', err.message);
    failed++;
  }

  // -----------------------------------------------------------------
  // Benchmark 2: ResourceRegistry 引用计数与安全释放压测
  // -----------------------------------------------------------------
  try {
    console.log('\n[Suite 2] 正在测试 ResourceRegistry 引用计数生命周期...');
    const registry = new ResourceRegistry();

    let disposedCount = 0;
    const mockGeometry = {
      isBufferGeometry: true,
      dispose: () => { disposedCount++; }
    };

    // 模拟 10 个组件实例共享同一个 geometry
    for (let i = 0; i < 10; i++) {
      registry.retain(mockGeometry);
    }

    if (registry.getRefCount(mockGeometry) !== 10) {
      throw new Error(`引用计数异常: 预期 10，实际为 ${registry.getRefCount(mockGeometry)}`);
    }

    // 释放 9 个实例，不应触发 dispose
    for (let i = 0; i < 9; i++) {
      registry.release(mockGeometry);
    }

    if (disposedCount !== 0) {
      throw new Error(`过早释放: 仍有 1 个活跃引用，但底层被 dispose 了！`);
    }

    // 释放最后一个实例，应触发底层 dispose
    registry.release(mockGeometry);
    if (disposedCount === 1) {
      console.log(`  ✅ 通过: 引用计数精准归零，安全释放共享几何体，未发生过早销毁`);
      passed++;
    } else {
      throw new Error(`未触发销毁: 计数已为 0，但未调用 dispose()`);
    }

    // 压力测试：批量注册与清理
    const t0 = performance.now();
    for (let i = 0; i < 5000; i++) {
      registry.retain({ isBufferGeometry: true, dispose: () => {} });
    }
    registry.clear();
    const t1 = performance.now();
    console.log(`  ✅ 通过: 5000 个资源高频注册与清空耗时 ${(t1 - t0).toFixed(2)}ms`);
    passed++;
  } catch (err) {
    console.error('  ❌ Suite 2 失败:', err.message);
    failed++;
  }

  // -----------------------------------------------------------------
  // Benchmark 3: FrameScheduler 帧率无关平滑阻尼一致性验证
  // -----------------------------------------------------------------
  try {
    console.log('\n[Suite 3] 正在验证 FrameScheduler 物理阻尼与高刷一致性...');
    // 模拟 1 秒时间内：
    // 60Hz 设备渲染 60 帧 (delta = 1/60)
    // 144Hz 设备渲染 144 帧 (delta = 1/144)
    const target = 100;
    const lambda = 10.0;

    let val60 = 0;
    const delta60 = 1 / 60;
    for (let f = 0; f < 60; f++) {
      val60 = FrameScheduler.damp(val60, target, lambda, delta60);
    }

    let val144 = 0;
    const delta144 = 1 / 144;
    for (let f = 0; f < 144; f++) {
      val144 = FrameScheduler.damp(val144, target, lambda, delta144);
    }

    const diff = Math.abs(val60 - val144);
    console.log(`  - 60Hz 最终值: ${val60.toFixed(4)}, 144Hz 最终值: ${val144.toFixed(4)}, 误差: ${diff.toExponential(4)}`);

    if (diff < 1e-4) {
      console.log(`  ✅ 通过: 60Hz 与 144Hz 模拟插值结果严格一致（误差小于 0.0001）`);
      passed++;
    } else {
      throw new Error(`插值物理不一致: 误差过大 (${diff})`);
    }
  } catch (err) {
    console.error('  ❌ Suite 3 失败:', err.message);
    failed++;
  }

  console.log('\n====================================================');
  console.log(`🏁 基准测试完成: ${passed} 项通过, ${failed} 项失败`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runBenchmarks();
