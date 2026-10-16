import * as THREE from "three";
import {
  getComponent,
  type SceneDocument,
  type ChangeSet,
  type BehaviorAction,
} from "../../scene-schema/src/index";
import type { SceneRuntime } from "../../scene-runtime/src/SceneRuntime";
import type { RuntimeSystem } from "../../scene-runtime/src/systems/RuntimeSystem";
interface Sequence {
  complete?: () => void;
  progress: number;
  playing: boolean;
  duration: number;
  loop: boolean;
  parts: Map<
    string,
    {
      base: THREE.Vector3;
      direction: THREE.Vector3;
      distance: number;
      start: number;
      end: number;
    }
  >;
}
export class AssemblySystem implements RuntimeSystem {
  readonly id = "studio.assembly";
  readonly sequences = new Map<string, Sequence>();
  constructor(private runtime: SceneRuntime) {}
  attach(document: SceneDocument): void {
    for (const e of document.entities) {
      const c = getComponent(e, "studio.assembly.Root");
      if (c)
        this.sequences.set(e.id, {
          progress: 0,
          playing: false,
          duration: Number(c.data.duration),
          loop: Boolean(c.data.loop),
          parts: new Map(),
        });
    }
    for (const e of document.entities) {
      const c = getComponent(e, "studio.assembly.Part");
      if (!c) continue;
      let parent = String(c.data.groupId || e.parentId || "");
      const visited = new Set<string>();
      while (parent && !this.sequences.has(parent) && !visited.has(parent)) {
        visited.add(parent);
        parent = this.runtime.index.entities.get(parent)?.parentId ?? "";
      }
      const sequence = this.sequences.get(parent),
        object = this.runtime.getObject(e.id);
      if (sequence && object)
        sequence.parts.set(e.id, {
          base: object.position.clone(),
          direction: new THREE.Vector3()
            .fromArray(c.data.direction as number[])
            .normalize(),
          distance: Number(c.data.distance) / this.runtime.sourceUnits(e),
          start: Number(c.data.start),
          end: Number(c.data.end),
        });
    }
  }
  beforeChange(): void {
    this.mode();
  }
  change(change: ChangeSet): void {
    this.sequences.clear();
    this.attach(change.after);
  }
  seek(id: string, progress: number): void {
    const sequence = this.sequences.get(id);
    if (!sequence) throw Error("装配序列不存在");
    sequence.progress = THREE.MathUtils.clamp(progress, 0, 1);
    for (const [partId, part] of sequence.parts) {
      const t = THREE.MathUtils.clamp(
        (sequence.progress - part.start) /
          Math.max(0.000001, part.end - part.start),
        0,
        1,
      );
      const smooth = t * t * (3 - 2 * t);
      this.runtime
        .getObject(partId)
        ?.position.copy(part.base)
        .addScaledVector(part.direction, part.distance * smooth);
    }
    this.runtime.spatial.invalidate();
    this.runtime.engine.requestRender();
  }
  actions: Record<
    string,
    (action: BehaviorAction, signal: AbortSignal) => Promise<void>
  > = {
    "studio.assembly.SetProgress": async (a) => {
      this.sequence(a.targetId).playing = false;
      this.sequence(a.targetId).complete?.();
      this.seek(a.targetId, Number(a.data.progress));
    },
    "studio.assembly.Play": async (a, signal) => {
      const sequence = this.sequence(a.targetId);
      if (a.wait && sequence.loop) throw Error("循环装配不能等待自然完成");
      if (sequence.progress === 1) this.seek(a.targetId, 0);
      const scope = this.runtime.actionScope(
        "assembly:" + a.targetId,
        signal,
        () => {
          sequence.playing = false;
        },
      );
      sequence.complete = scope.complete;
      sequence.playing = true;
      if (a.wait)
        await new Promise<void>((resolve, reject) => {
          const stop = this.runtime.engine.onUpdate(() => {
            if (scope.signal.aborted) {
              stop();
              scope.complete();
              reject(new DOMException("Cancelled", "AbortError"));
            } else if (!sequence.playing) {
              stop();
              scope.complete();
              resolve();
            }
            return false;
          });
        });
    },
    "studio.assembly.Pause": async (a) => {
      this.sequence(a.targetId).playing = false;
      this.sequence(a.targetId).complete?.();
    },
    "studio.assembly.Restore": async (a) => {
      this.sequence(a.targetId).playing = false;
      this.sequence(a.targetId).complete?.();
      this.seek(a.targetId, 0);
    },
  };
  private sequence(id: string): Sequence {
    const sequence = this.sequences.get(id);
    if (!sequence) throw Error("装配序列未就绪");
    return sequence;
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
        }
        active = true;
      }
    return active;
  }
  mode(): void {
    for (const [id, s] of this.sequences) {
      s.playing = false;
      s.complete?.();
      this.seek(id, 0);
    }
  }
  detach(): void {
    this.mode();
    this.sequences.clear();
  }
}

export default AssemblySystem;
