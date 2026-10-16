import {
  getComponent,
  type SceneDocument,
  type ChangeSet,
} from "../../scene-schema/src/index";
import type { SceneRuntime } from "../../scene-runtime/src/SceneRuntime";
import type { RuntimeSystem } from "../../scene-runtime/src/systems/RuntimeSystem";
export class SamplePulseSystem implements RuntimeSystem {
  readonly id = "studio.sample";
  private active = new Map<
    string,
    { enabled: boolean; base: [number, number, number] }
  >();
  private time = 0;
  constructor(private runtime: SceneRuntime) {}
  attach(document: SceneDocument): void {
    for (const e of document.entities)
      if (getComponent(e, "studio.sample.Pulse")) {
        const object = this.runtime.getObject(e.id);
        if (object)
          this.active.set(e.id, {
            enabled: Boolean(
              getComponent(e, "studio.sample.Pulse")!.data.active,
            ),
            base: object.scale.toArray(),
          });
      }
  }
  beforeChange(): void {
    this.mode();
  }
  change(change: ChangeSet): void {
    this.active.clear();
    this.attach(change.after);
  }
  mode(): void {
    this.time = 0;
    for (const [id, entry] of this.active) {
      const object = this.runtime.getObject(id);
      if (object) object.scale.fromArray(entry.base);
    }
  }
  actions = {
    "studio.sample.SetPulse": async (action: {
      targetId: string;
      data: Record<string, unknown>;
    }) => {
      const entry = this.active.get(action.targetId);
      if (!entry) throw Error("脉冲组件未就绪");
      entry.enabled = Boolean(action.data.active);
      if (!entry.enabled)
        this.runtime.getObject(action.targetId)?.scale.fromArray(entry.base);
      this.runtime.spatial.invalidate();
      this.runtime.engine.requestRender();
    },
  };
  update(dt: number): boolean {
    if (this.runtime.mode !== "play") return false;
    this.time += dt;
    let active = false;
    for (const [id, entry] of this.active) {
      const object = this.runtime.getObject(id),
        c = this.runtime.index.entities
          .get(id)
          ?.components.find((c) => c.type === "studio.sample.Pulse");
      if (object && c) {
        const scale = entry.enabled
          ? 1 +
            Math.sin(this.time * Number(c.data.speed) * Math.PI * 2) *
              Number(c.data.amplitude)
          : 1;
        object.scale.fromArray(entry.base).multiplyScalar(scale);
        active = entry.enabled || active;
      }
    }
    return active;
  }
  detach(): void {
    this.mode();
    this.active.clear();
  }
}

export default SamplePulseSystem;
