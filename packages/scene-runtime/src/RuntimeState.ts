import type { Scalar, Vec3, JsonValue } from "@studio/scene-schema";

export interface LoadProgress {
  phase:
    | "idle"
    | "structure"
    | "assets"
    | "gpu"
    | "ready"
    | "error"
    | "cancelled";
  completed: number;
  total: number;
  message: string;
  stages: Record<string, number>;
}
export interface TourState {
  id: string;
  status: "stopped" | "playing" | "paused" | "completed";
  progress: number;
  stopId: string;
}
export interface MediaState {
  status: "playing" | "paused" | "stopped" | "ended";
  time: number;
  duration: number;
  volume: number;
}
export interface ExecutionTrace {
  id: number;
  ruleId: string;
  actionId: string;
  status:
    | "start"
    | "running"
    | "completed"
    | "cancelled"
    | "error"
    | "queued"
    | "skipped";
  message: string;
  time: number;
}
export interface RuntimeSnapshot {
  extensions: Record<string, Record<string, JsonValue>>;
  mode: "edit" | "play";
  entered: boolean;
  load: LoadProgress;
  viewMode: "first" | "third";
  displayMode: "solid" | "xray";
  contentId: string;
  variables: Record<string, Scalar>;
  tour: TourState;
  media: Record<string, MediaState>;
  animations: Record<string, "playing" | "paused" | "stopped">;
  uiVisibility: Record<string, boolean>;
  trace: ExecutionTrace[];
  errors: Record<string, string>;
}
export interface CameraPose {
  position: Vec3;
  target: Vec3;
  fov: number;
}
export const emptySnapshot = (): RuntimeSnapshot => ({
  extensions: {},
  mode: "edit",
  entered: false,
  load: { phase: "idle", completed: 0, total: 0, message: "", stages: {} },
  viewMode: "first",
  displayMode: "solid",
  contentId: "",
  variables: {},
  tour: { id: "", status: "stopped", progress: 0, stopId: "" },
  media: {},
  animations: {},
  uiVisibility: {},
  trace: [],
  errors: {},
});
export class RuntimeState {
  private value = emptySnapshot();
  private listeners = new Set<() => void>();
  readonly getSnapshot = (): RuntimeSnapshot => this.value;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  patch(patch: Partial<RuntimeSnapshot>): void {
    this.value = { ...this.value, ...patch };
    for (const listener of this.listeners) listener();
  }
  reset(): void {
    this.value = emptySnapshot();
    for (const listener of this.listeners) listener();
  }
  dispose(): void {
    this.listeners.clear();
  }
}
