import * as THREE from "three";
import {
  visualPriorities,
  type VisualOverride,
} from "../../scene-runtime/src/systems/VisualStateSystem";
import {
  getComponent,
  type SceneDocument,
  type ChangeSet,
  type BehaviorAction,
} from "../../scene-schema/src/index";
import type { SceneRuntime } from "../../scene-runtime/src/SceneRuntime";
import type { RuntimeSystem } from "../../scene-runtime/src/systems/RuntimeSystem";
import {
  evaluatePose,
  pathCurve,
  stages,
  type AssemblyStage,
  type BasePose,
} from "./pose";
interface Part {
  base: BasePose;
  stages: AssemblyStage[];
  units: number;
}
interface Sequence {
  complete?: () => void;
  progress: number;
  playing: boolean;
  duration: number;
  loop: boolean;
  parts: Map<string, Part>;
  lastPublish: number;
}
export class AssemblySystem implements RuntimeSystem {
  readonly id = "studio.assembly";
  readonly sequences = new Map<string, Sequence>();
  private rebuildPending = true;
  private trails = new THREE.Group();
  private trailResources = new Set<THREE.BufferGeometry | THREE.Material>();
  private trailsByPart = new Map<string, THREE.Line[]>();
  constructor(private runtime: SceneRuntime) {}
  attach(document: SceneDocument): void {
    this.runtime.engine.scene.add(this.trails);
    for (const e of document.entities) {
      const c = getComponent(e, "studio.assembly.Root");
      if (c)
        this.sequences.set(e.id, {
          progress: 0,
          playing: false,
          duration: Number(c.data.duration),
          loop: Boolean(c.data.loop),
          parts: new Map(),
          lastPublish: 0,
        });
    }
    for (const e of document.entities) {
      const c = getComponent(e, "studio.assembly.Part"),
        object = this.runtime.getObject(e.id);
      if (!c || !object) continue;
      const group = this.runtime.index.entities.get(String(c.data.groupId));
      const groupComponent =
        group && getComponent(group, "studio.assembly.Group");
      const owner = String(groupComponent?.data.rootId || c.data.groupId);
      const sequence = this.sequences.get(owner);
      if (!sequence) continue;
      const recipe = stages(c.data.stages);
      sequence.parts.set(e.id, {
        base: {
          position: object.position.clone(),
          rotation: object.quaternion.clone(),
          scale: object.scale.clone(),
          visible: object.visible,
        },
        stages: recipe,
        units: this.runtime.sourceUnits(e),
      });
      for (const stage of recipe.filter((s) => s.trail)) {
        const geometry = new THREE.BufferGeometry().setFromPoints(
          pathCurve(stage.path).getPoints(48),
        );
        const material = new THREE.LineBasicMaterial({
          color: "#66d7b9",
          transparent: true,
          opacity: 0.6,
        });
        const line = new THREE.Line(geometry, material);
        line.userData.partId = e.id;
        line.userData.stage = stage;
        this.trails.add(line);
        const lines = this.trailsByPart.get(e.id) ?? [];
        lines.push(line);
        this.trailsByPart.set(e.id, lines);
        for (const resource of [geometry, material]) {
          this.trailResources.add(resource);
          this.runtime.engine.resourceRegistry.retain(resource);
        }
      }
    }
    this.trails.userData.runtimeOwned = true;
    this.trails.visible = this.runtime.mode === "play";
  }
  beforeChange(change: ChangeSet): void {
    this.rebuildPending = change.entityIds.some((id) => {
      const before = change.before.entities.find((e) => e.id === id),
        after = change.after.entities.find((e) => e.id === id);
      for (const type of [
        "studio.assembly.Root",
        "studio.assembly.Group",
        "studio.assembly.Part",
      ])
        if (
          before?.components.find((c) => c.type === type) !==
          after?.components.find((c) => c.type === type)
        )
          return true;
      const tracked = [...this.sequences.values()].some((s) => s.parts.has(id));
      if (
        tracked &&
        (before?.transform !== after?.transform ||
          before?.parentId !== after?.parentId ||
          before?.components.find((c) => c.type === "ModelNode") !==
            after?.components.find((c) => c.type === "ModelNode"))
      )
        return true;
      return (
        before?.components.find((c) => c.type === "Model") !==
        after?.components.find((c) => c.type === "Model")
      );
    });
    if (this.rebuildPending) {
      this.mode();
      this.releaseTrails();
    }
  }

  change(change: ChangeSet): void {
    if (!this.rebuildPending) return;
    const old = [...this.sequences.keys()];
    this.sequences.clear();
    this.attach(change.after);
    const extensions = { ...this.runtime.getSnapshot().extensions };
    for (const id of old)
      if (!this.sequences.has(id)) delete extensions[this.id + ":" + id];
    this.runtime.state.patch({ extensions });
    this.rebuildPending = false;
  }
  seek(id: string, progress: number): void {
    const sequence = this.sequence(id);
    sequence.progress = THREE.MathUtils.clamp(progress, 0, 1);
    const overrides = this.evaluate(id, sequence.progress);
    this.runtime.visual.setScope(
      "assembly-pose:" + id,
      overrides,
      visualPriorities.assembly,
    );
    this.publish(id);
  }
  evaluate(id: string, progress: number): VisualOverride[] {
    const overrides: VisualOverride[] = [];
    for (const [partId, part] of this.sequence(id).parts) {
      const object = this.runtime.getObject(partId);
      if (!object) continue;
      const pose = evaluatePose(
        part.base,
        part.stages,
        THREE.MathUtils.clamp(progress, 0, 1),
        part.units,
      );
      overrides.push({
        targetId: partId,
        channel: "transform",
        composition: "replace",
        value: {
          position: pose.position.toArray(),
          rotation: pose.rotation.toArray() as [number, number, number, number],
          scale: pose.scale.toArray(),
        },
      });
      overrides.push({
        targetId: partId,
        channel: "visibility",
        composition: "and",
        value: pose.visible,
      });
    }
    return overrides;
  }
  private publish(id: string, force = false): void {
    const s = this.sequence(id),
      now = performance.now();
    if (!force && now - s.lastPublish < 80 && s.playing && s.progress < 1)
      return;
    s.lastPublish = now;
    this.runtime.state.patch({
      extensions: {
        ...this.runtime.getSnapshot().extensions,
        [this.id + ":" + id]: {
          progress: s.progress,
          status: s.playing
            ? "playing"
            : s.progress === 1
              ? "completed"
              : "paused",
        },
      },
    });
  }
  private owner(id: string): string {
    if (this.sequences.has(id)) return id;
    const entity = this.runtime.index.entities.get(id);
    const groupId = String(
      (entity && getComponent(entity, "studio.assembly.Part")?.data.groupId) ||
        id,
    );
    const group = this.runtime.index.entities.get(groupId);
    return String(
      (group && getComponent(group, "studio.assembly.Group")?.data.rootId) ||
        groupId,
    );
  }
  private members(id: string): string[] {
    if (this.sequences.has(id)) return [...this.sequence(id).parts.keys()];
    const entity = this.runtime.index.entities.get(id);
    if (entity && getComponent(entity, "studio.assembly.Part")) return [id];
    return this.runtime.index
      .query("studio.assembly.Part")
      .filter(
        (part) =>
          getComponent(
            this.runtime.index.entities.get(part)!,
            "studio.assembly.Part",
          )?.data.groupId === id,
      );
  }
  actions: Record<
    string,
    (action: BehaviorAction, signal: AbortSignal) => Promise<void>
  > = {
    "studio.assembly.SetProgress": async (a) => {
      const s = this.sequence(a.targetId);
      s.playing = false;
      s.complete?.();
      this.seek(a.targetId, Number(a.data.progress));
    },
    "studio.assembly.Play": async (a, signal) => {
      const s = this.sequence(a.targetId);
      if (a.wait && s.loop) throw Error("循环装配不能等待自然完成");
      if (s.progress === 1) this.seek(a.targetId, 0);
      const scope = this.runtime.actionScope(
        "assembly:" + a.targetId,
        signal,
        () => {
          s.playing = false;
          this.publish(a.targetId, true);
        },
      );
      s.complete = scope.complete;
      s.playing = true;
      this.publish(a.targetId, true);
      if (a.wait)
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            stop();
            scope.signal.removeEventListener("abort", cancel);
          };
          const cancel = () => {
            cleanup();
            reject(new DOMException("Cancelled", "AbortError"));
          };
          const stop = this.runtime.engine.onUpdate(() => {
            if (!s.playing) {
              cleanup();
              scope.complete();
              resolve();
            }
            return false;
          });
          scope.signal.addEventListener("abort", cancel, { once: true });
          if (scope.signal.aborted) cancel();
        });
    },
    "studio.assembly.Pause": async (a) => {
      const s = this.sequence(a.targetId);
      s.playing = false;
      s.complete?.();
      this.publish(a.targetId, true);
    },
    "studio.assembly.Restore": async (a) => {
      const s = this.sequence(a.targetId);
      s.playing = false;
      s.complete?.();
      this.seek(a.targetId, 0);
      this.runtime.visual.reset("assembly:" + a.targetId);
    },
    "studio.assembly.SelectStep": async (a) => {
      const s = this.sequence(a.targetId);
      const stage = [...s.parts.values()]
        .flatMap((p) => p.stages)
        .find((step) => step.id === a.data.stepId);
      if (!stage) throw Error("装配步骤不存在");
      s.playing = false;
      s.complete?.();
      this.seek(a.targetId, stage.start);
    },
    "studio.assembly.HighlightPart": async (a) => {
      this.runtime.visual.highlight(
        "assembly:" + this.owner(a.targetId),
        this.members(a.targetId),
      );
    },
    "studio.assembly.IsolatePart": async (a) => {
      this.runtime.visual.isolate(
        "assembly:" + this.owner(a.targetId),
        this.members(a.targetId),
        this.sequence(this.owner(a.targetId)).parts.keys(),
      );
    },
    "studio.assembly.FocusPart": async (a, signal) => {
      const task = this.runtime.focusObjects(
        this.members(a.targetId),
        1,
        signal,
      );
      if (a.wait) await task;
      else
        void task.catch((error) => {
          if (!(error instanceof DOMException && error.name === "AbortError"))
            this.runtime.issue(a.targetId, error);
        });
    },
  };
  private sequence(id: string): Sequence {
    const s = this.sequences.get(id);
    if (!s) throw Error("装配序列不存在");
    return s;
  }
  update(dt: number): boolean {
    if (this.runtime.mode !== "play") return false;
    let active = false;
    for (const [id, s] of this.sequences)
      if (s.playing) {
        const next = s.progress + dt / s.duration;
        this.seek(id, next >= 1 && s.loop ? next % 1 : Math.min(1, next));
        if (next >= 1 && !s.loop) {
          s.playing = false;
          s.complete?.();
          this.publish(id, true);
        }
        active = true;
      }
    return active;
  }
  render(): void {
    if (this.runtime.mode !== "play") return;
    for (const [id, lines] of this.trailsByPart) {
      const object = this.runtime.getObject(id);
      const part = [...this.sequences.values()]
        .map((s) => s.parts.get(id))
        .find(Boolean);
      if (!object || !part) continue;
      object.parent?.updateWorldMatrix(true, false);
      for (const line of lines) {
        const points = pathCurve((line.userData.stage as AssemblyStage).path)
          .getPoints(48)
          .map((p) =>
            p
              .divideScalar(part.units)
              .add(part.base.position)
              .applyMatrix4(object.parent?.matrixWorld ?? new THREE.Matrix4()),
          );
        line.geometry.setFromPoints(points);
      }
    }
  }
  mode(): void {
    for (const [id, s] of this.sequences) {
      s.playing = false;
      s.complete?.();
      s.progress = 0;
      this.runtime.visual.reset("assembly-pose:" + id);
      this.publish(id, true);
    }
    for (const id of this.sequences.keys())
      this.runtime.visual.reset("assembly:" + id);
    this.trails.userData.runtimeOwned = true;
    this.trails.visible = this.runtime.mode === "play";
  }
  private releaseTrails(): void {
    for (const resource of this.trailResources)
      this.runtime.engine.resourceRegistry.release(resource);
    this.trailResources.clear();
    this.trails.clear();
    this.trailsByPart.clear();
  }
  detach(): void {
    this.mode();
    this.sequences.clear();
    this.releaseTrails();
    this.trails.removeFromParent();
  }
}
export default AssemblySystem;
