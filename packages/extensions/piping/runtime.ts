import {
  getComponent,
  type SceneDocument,
  type ChangeSet,
  type BehaviorAction,
} from "../../scene-schema/src/index";
import type { SceneRuntime } from "../../scene-runtime/src/SceneRuntime";
import type { RuntimeSystem } from "../../scene-runtime/src/systems/RuntimeSystem";
export class PipingSystem implements RuntimeSystem {
  readonly id = "studio.piping";
  readonly segmentsByLine = new Map<string, Set<string>>();
  constructor(private runtime: SceneRuntime) {}
  attach(document: SceneDocument): void {
    for (const entity of document.entities) {
      const c = getComponent(entity, "studio.piping.Segment");
      if (c) {
        const id = String(c.data.lineId);
        let set = this.segmentsByLine.get(id);
        if (!set) this.segmentsByLine.set(id, (set = new Set()));
        set.add(entity.id);
      }
    }
  }

  change(change: ChangeSet): void {
    for (const id of change.entityIds) {
      const before = change.before.entities.find((e) => e.id === id),
        after = change.after.entities.find((e) => e.id === id);
      const old = before && getComponent(before, "studio.piping.Segment"),
        next = after && getComponent(after, "studio.piping.Segment");
      if (old === next) continue;
      if (old) {
        const key = String(old.data.lineId),
          members = this.segmentsByLine.get(key);
        members?.delete(id);
        if (!members?.size) this.segmentsByLine.delete(key);
      }
      if (next) {
        const key = String(next.data.lineId);
        let members = this.segmentsByLine.get(key);
        if (!members) this.segmentsByLine.set(key, (members = new Set()));
        members.add(id);
      }
    }
  }
  private members(id: string): Set<string> {
    const ids = this.segmentsByLine.get(id);
    if (!ids) throw Error("管线没有关联管段");
    return ids;
  }
  actions: Record<
    string,
    (action: BehaviorAction, signal: AbortSignal) => Promise<void>
  > = {
    "studio.piping.Highlight": async (a) => {
      this.runtime.visual.highlight("piping", this.members(a.targetId));
    },
    "studio.piping.Isolate": async (a) => {
      this.runtime.visual.isolate(
        "piping",
        this.members(a.targetId),
        [...this.segmentsByLine.values()].flatMap((set) => [...set]),
      );
    },
    "studio.piping.Restore": async () => {
      this.runtime.visual.reset("piping");
    },
    "studio.piping.Focus": async (a, signal) => {
      const task = this.runtime.focusObjects(
        [...this.members(a.targetId)],
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
  mode(): void {
    this.runtime.visual.reset("piping");
  }
  detach(): void {
    this.mode();
    this.segmentsByLine.clear();
  }
}
export default PipingSystem;
