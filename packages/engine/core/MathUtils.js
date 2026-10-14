/**
 * MathUtils: 数学与插值工具集
 * 提供帧率无关指数平滑、平滑过渡曲线与角度归一化计算
 */

/**
 * 帧率无关的指数平滑插值权重计算
 * @param {number} baseAlpha - 目标基准 60FPS 下的阻尼系数（例如 0.12）
 * @param {number} delta - 实际当前帧耗时（秒）
 * @returns {number} 适应当前实际帧率的插值系数
 */
export function frameIndependentAlpha(baseAlpha, delta) {
  return 1 - Math.pow(1 - baseAlpha, Math.max(0, delta) * 60);
}

/**
 * 三次 Smoothstep 平滑曲线插值（用于运镜过渡）
 * @param {number} t - 进度 [0.0, 1.0]
 * @returns {number}
 */
export function smoothstep(t) {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}

/**
 * 角度差归一化到 [-π, π]，避免相机跨越 180° / 360° 时突变倒转
 * @param {number} diff - 弧度差值
 * @returns {number}
 */
export function normalizeAngleDiff(diff) {
  let d = diff;
  while (d < -Math.PI) d += Math.PI * 2;
  while (d > Math.PI) d -= Math.PI * 2;
  return d;
}

export const MathUtils = {
  frameIndependentAlpha,
  smoothstep,
  normalizeAngleDiff
};

