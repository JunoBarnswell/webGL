import type { RuntimeSystem } from "../../scene-runtime/src/systems/RuntimeSystem";
export default class OptimizationSystem implements RuntimeSystem {
  constructor(_runtime: unknown) {}
  readonly id = "studio.optimization";
  attach(): void {}
  change(): void {}
  mode(): void {}
  detach(): void {}
}
