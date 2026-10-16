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
  private dirty = new Set<string>();
  beforeChange(change: ChangeSet): void {
    this.dirty.clear();
    const modelChanged = change.entityIds.some(
      (id) =>
        change.before.entities
          .find((e) => e.id === id)
          ?.components.find((c) => c.type === "Model") !==
        change.after.entities
          .find((e) => e.id === id)
          ?.components.find((c) => c.type === "Model"),
    );
    for (const id of new Set([
      ...change.entityIds,
      ...(modelChanged ? [...this.active.keys()] : []),
    ])) {
      const before = change.before.entities.find((e) => e.id === id),
        after = change.after.entities.find((e) => e.id === id);
      if (
        !modelChanged &&
        before?.transform === after?.transform &&
        before?.components.find((c) => c.type === "studio.sample.Pulse") ===
          after?.components.find((c) => c.type === "studio.sample.Pulse")
      )
        continue;
      this.runtime.visual.reset("sample:" + id);
      this.active.delete(id);
      this.dirty.add(id);
    }
  }
  change(change: ChangeSet): void {
    for (const id of this.dirty) {
      const entity = change.after.entities.find((e) => e.id === id),
        component = entity && getComponent(entity, "studio.sample.Pulse"),
        object = this.runtime.getObject(id);
      if (component && object)
        this.active.set(id, {
          enabled: Boolean(component.data.active),
          base: object.scale.toArray(),
        });
    }
    this.dirty.clear();
  }
  mode(): void {
    this.time = 0;
    for (const id of this.active.keys()) {
      this.runtime.visual.reset("sample:" + id);
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
        this.runtime.visual.reset("sample:" + action.targetId);
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
        this.runtime.visual.setScope(
          "sample:" + id,
          [
            {
              targetId: id,
              channel: "transform",
              composition: "add",
              value: {
                position: [0, 0, 0],
                rotation: [0, 0, 0, 1],
                scale: [scale, scale, scale],
              },
            },
          ],
          45,
        );
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
