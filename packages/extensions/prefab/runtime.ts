import type { RuntimeSystem } from "../../scene-runtime/src/systems/RuntimeSystem";
export default class PrefabSystem implements RuntimeSystem {
  constructor(_runtime: unknown) {}
  readonly id = "studio.prefab";
  attach(): void {}
  change(): void {}
  mode(): void {}
  detach(): void {}
}
