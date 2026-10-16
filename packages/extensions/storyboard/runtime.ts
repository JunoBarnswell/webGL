import type {
  SceneDocument,
  ChangeSet,
  BehaviorAction,
  JsonValue,
} from "../../scene-schema/src/types";
import { getComponent } from "../../scene-schema/src/index";
import type { SceneRuntime } from "../../scene-runtime/src/SceneRuntime";
import type { RuntimeSystem } from "../../scene-runtime/src/systems/RuntimeSystem";
import type { VisualOverride } from "../../scene-runtime/src/systems/VisualStateSystem";
import type { CameraPose } from "../../scene-runtime/src/RuntimeState";
import {
  evaluateStoryboard,
  compileStoryboard,
  type CompiledStoryboard,
  type Storyboard,
} from "./core";
import type { AssemblySystem } from "../assembly/runtime";
interface Playback {
  story: Storyboard;
  compiled: CompiledStoryboard;
  time: number;
  speed: number;
  playing: boolean;
  camera?: CameraPose;
  lease?: number;
  lastPublish: number;
  audio: Set<HTMLAudioElement>;
}
export default class StoryboardSystem implements RuntimeSystem {
  readonly id = "studio.storyboard";
  private sequences = new Map<string, Playback>();
  constructor(private runtime: SceneRuntime) {}
  attach(doc: SceneDocument): void {
    for (const e of doc.entities) {
      const c = getComponent(e, "studio.storyboard.Sequence");
      if (c)
        this.sequences.set(e.id, {
          story: c.data as unknown as Storyboard,
          compiled: compileStoryboard(c.data as unknown as Storyboard),
          time: 0,
          speed: 1,
          playing: false,
          lastPublish: 0,
          audio: new Set(),
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
  private sequence(id: string): Playback {
    const sequence = this.sequences.get(id);
    if (!sequence) throw Error("故事板不存在");
    return sequence;
  }
  private owner(id: string): string {
    return "storyboard:" + id;
  }
  seek(id: string, time: number): void {
    const s = this.sequence(id);
    s.time = Math.max(0, Math.min(s.story.duration, time));
    const overrides: VisualOverride[] = [],
      activeAudio = new Set<HTMLAudioElement>();
    let caption = "",
      content = "";
    for (const sample of evaluateStoryboard(s.story, s.time, s.compiled)) {
      const { track, transform, value } = sample,
        targetId = track.targetId;
      if (track.channel === "transform") {
        const entity = this.runtime.entity(targetId),
          units = entity ? this.runtime.sourceUnits(entity) : 1;
        overrides.push({
          targetId,
          channel: "transform",
          composition: "replace",
          value: {
            ...transform,
            position: transform.position.map((v) => v / units) as [
              number,
              number,
              number,
            ],
          },
        });
      } else if (track.channel === "opacity")
        overrides.push({
          targetId,
          channel: "opacity",
          composition: "replace",
          value,
        });
      else if (track.channel === "visibility" || track.channel === "annotation")
        overrides.push({
          targetId,
          channel: "visibility",
          composition: "and",
          value: value >= 0.5,
        });
      else if (track.channel === "assembly") {
        const assembly = this.runtime.systems.find(
          (system) => system.id === "studio.assembly",
        ) as AssemblySystem | undefined;
        if (assembly) overrides.push(...assembly.evaluate(targetId, value));
      } else if (track.channel === "camera") {
        if (this.runtime.cameraOwnership.owner !== this.owner(id)) {
          s.camera ??= this.runtime.getCameraPose();
          s.lease = this.runtime.cameraOwnership.acquire(
            this.owner(id),
            "storyboard",
            () => this.stop(id, false),
          );
        }
        if (s.lease && this.runtime.cameraOwnership.isCurrent(s.lease))
          this.runtime.applyCameraPose(sample.camera);
      } else if (track.channel === "caption" && sample.active)
        caption = sample.clip.text;
      else if (track.channel === "content" && sample.active)
        content = track.contentId;
      else if (track.channel === "audio" && sample.active) {
        const audio = this.runtime.objects.get(targetId)?.audio;
        if (audio) {
          activeAudio.add(audio);
          const desired = s.time - sample.clip.start;
          if (Math.abs(audio.currentTime - desired) > 0.1)
            audio.currentTime = desired;
          if (s.playing && s.speed > 0) {
            audio.playbackRate = Math.abs(s.speed);
            void audio
              .play()
              .catch((error) =>
                this.runtime.issue(id, "音频需要用户操作：" + String(error)),
              );
          } else audio.pause();
        }
      }
    }
    for (const audio of s.audio) if (!activeAudio.has(audio)) audio.pause();
    s.audio = activeAudio;
    this.runtime.visual.setScope(this.owner(id), overrides, "storyboard");
    if (
      content ||
      this.runtime.getSnapshot().extensions[this.id + ":" + id]?.content
    )
      this.runtime.state.patch({ contentId: content });
    const now = performance.now();
    if (!s.playing || now - s.lastPublish > 80 || s.time === s.story.duration) {
      s.lastPublish = now;
      this.runtime.state.patch({
        extensions: {
          ...this.runtime.getSnapshot().extensions,
          [this.id + ":" + id]: {
            time: s.time,
            playing: s.playing,
            speed: s.speed,
            duration: s.story.duration,
            audioPolicy: s.speed < 0 ? "reverse-muted" : "forward-original",
            caption,
            content,
          },
        },
      });
    }
  }
  play(id: string, speed = 1, time?: number): void {
    const s = this.sequence(id);
    if (!Number.isFinite(speed) || speed === 0)
      throw Error("播放速度必须为有限非零数值");
    s.speed = speed;
    s.playing = true;
    if (time !== undefined) s.time = time;
    this.seek(id, s.time);
    this.runtime.engine.requestRender();
  }
  pause(id: string): void {
    const s = this.sequence(id);
    s.playing = false;
    for (const audio of s.audio) audio.pause();
    this.seek(id, s.time);
  }
  stop(id: string, restoreCamera = true): void {
    const s = this.sequence(id);
    s.playing = false;
    s.time = 0;
    for (const audio of s.audio) audio.pause();
    s.audio.clear();
    this.runtime.visual.reset(this.owner(id));
    if (s.lease !== undefined) {
      const owns = this.runtime.cameraOwnership.owner === this.owner(id);
      this.runtime.cameraOwnership.release(s.lease);
      if (owns && restoreCamera && s.camera)
        this.runtime.applyCameraPose(s.camera);
    }
    s.lease = undefined;
    s.camera = undefined;
    if (
      this.runtime.getSnapshot().contentId ===
      this.runtime.getSnapshot().extensions[this.id + ":" + id]?.content
    )
      this.runtime.state.patch({ contentId: "" });
    this.runtime.state.patch({
      extensions: {
        ...this.runtime.getSnapshot().extensions,
        [this.id + ":" + id]: {
          time: 0,
          playing: false,
          duration: s.story.duration,
          caption: "",
          content: "",
        },
      },
    });
  }
  actions: Record<string, (a: BehaviorAction) => void> = {
    "studio.storyboard.Play": (a) =>
      this.play(a.targetId, Number(a.data.speed), Number(a.data.time)),
    "studio.storyboard.Pause": (a) => this.pause(a.targetId),
    "studio.storyboard.Seek": (a) => this.seek(a.targetId, Number(a.data.time)),
    "studio.storyboard.Stop": (a) => this.stop(a.targetId),
  };
  update(dt: number): boolean {
    let active = false;
    for (const [id, s] of this.sequences)
      if (s.playing) {
        const next = s.time + dt * s.speed;
        if (next < 0 || next > s.story.duration) {
          if (s.story.loop)
            s.time =
              ((next % s.story.duration) + s.story.duration) % s.story.duration;
          else {
            s.time = Math.max(0, Math.min(s.story.duration, next));
            s.playing = false;
          }
        } else s.time = next;
        this.seek(id, s.time);
        active = true;
      }
    return active;
  }
  mode(): void {
    for (const id of this.sequences.keys()) this.stop(id);
  }
  detach(): void {
    this.mode();
    this.sequences.clear();
  }
  snapshot(id: string): Record<string, JsonValue> {
    const s = this.sequence(id);
    return { time: s.time, playing: s.playing };
  }
}
