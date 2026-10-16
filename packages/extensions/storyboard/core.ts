import * as THREE from "three";
import type { Transform, Vec3 } from "../../scene-schema/src/types";
import type { CameraPose } from "../../scene-runtime/src/RuntimeState";
export type TrackChannel =
  | "transform"
  | "opacity"
  | "visibility"
  | "camera"
  | "annotation"
  | "assembly"
  | "content"
  | "audio"
  | "caption";
export interface StoryKeyframe {
  id: string;
  time: number;
  transform: Transform;
  camera: CameraPose;
  value: number;
  easing: string;
  bezier?: [number, number, number, number];
}
export interface StoryClip {
  keyframes?: StoryKeyframe[];
  bezier?: [number, number, number, number];
  waveform?: number[];
  id: string;
  name: string;
  start: number;
  duration: number;
  easing: string;
  fromTransform: Transform;
  toTransform: Transform;
  path: Vec3[];
  fromCamera: CameraPose;
  toCamera: CameraPose;
  fromValue: number;
  toValue: number;
  text: string;
  groupId: string;
  curveStart: number;
  curveEnd: number;
}
export interface StoryTrack {
  id: string;
  name: string;
  channel: TrackChannel;
  targetId: string;
  contentId: string;
  muted: boolean;
  locked: boolean;
  priority: number;
  clips: StoryClip[];
}
export interface Storyboard {
  name: string;
  duration: number;
  fps: string;
  loop: boolean;
  tracks: StoryTrack[];
  snapshots: {
    id: string;
    name: string;
    pose: CameraPose;
    thumbnailAssetId: string;
    bound: boolean;
    time: number;
  }[];
  markers: { id: string; name: string; time: number }[];
}
export const identityTransform = (): Transform => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
});
export const cameraPose = (): CameraPose => ({
  position: [0, 1000, 3000],
  target: [0, 0, 0],
  fov: 60,
});
export function newClip(start = 0): StoryClip {
  return {
    id: crypto.randomUUID(),
    name: "片段",
    start,
    duration: 2,
    easing: "smooth",
    fromTransform: identityTransform(),
    toTransform: identityTransform(),
    path: [],
    fromCamera: cameraPose(),
    toCamera: cameraPose(),
    fromValue: 0,
    toValue: 1,
    text: "",
    groupId: "",
    curveStart: 0,
    curveEnd: 1,
  };
}
export function ease(t: number, mode: string): number {
  t = THREE.MathUtils.clamp(t, 0, 1);
  return mode === "smooth"
    ? t * t * (3 - 2 * t)
    : mode === "easeIn"
      ? t * t
      : mode === "easeOut"
        ? 1 - (1 - t) * (1 - t)
        : t;
}
export interface StorySample {
  track: StoryTrack;
  clip: StoryClip;
  time: number;
  t: number;
  active: boolean;
  value: number;
  transform: Transform;
  camera: CameraPose;
}
export interface CompiledStoryboard {
  source: Storyboard;
  tracks: {
    track: StoryTrack;
    clips: {
      clip: StoryClip;
      curve: THREE.CatmullRomCurve3 | null;
      frames: StoryKeyframe[];
      rotations: THREE.Quaternion[];
      scratch: THREE.Quaternion;
      point: THREE.Vector3;
    }[];
  }[];
}
const compiledStories = new WeakMap<Storyboard, CompiledStoryboard>();
export function compileStoryboard(story: Storyboard): CompiledStoryboard {
  const cached = Object.isFrozen(story)
    ? compiledStories.get(story)
    : undefined;
  if (cached) return cached;
  const result: CompiledStoryboard = {
    source: story,
    tracks: story.tracks
      .filter((t) => !t.muted)
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
      .map((track) => ({
        track,
        clips: [...track.clips]
          .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
          .map((clip) => {
            const from: StoryKeyframe = {
              id: "@from",
              time: 0,
              transform: clip.fromTransform,
              camera: clip.fromCamera,
              value: clip.fromValue,
              easing: clip.easing,
              bezier: clip.bezier,
            };
            const to: StoryKeyframe = {
              id: "@to",
              time: 1,
              transform: clip.toTransform,
              camera: clip.toCamera,
              value: clip.toValue,
              easing: clip.easing,
            };
            const keys = new Map<number, StoryKeyframe>([
              [0, from],
              [1, to],
            ]);
            for (const frame of clip.keyframes ?? [])
              keys.set(frame.time, frame);
            const frames = [...keys.values()].sort((a, b) => a.time - b.time);
            return {
              clip,
              frames,
              rotations: frames.map((f) =>
                new THREE.Quaternion().fromArray(f.transform.rotation),
              ),
              scratch: new THREE.Quaternion(),
              point: new THREE.Vector3(),
              curve: clip.path.length
                ? new THREE.CatmullRomCurve3(
                    [
                      clip.fromTransform.position,
                      ...clip.path,
                      clip.toTransform.position,
                    ].map((p) => new THREE.Vector3().fromArray(p)),
                  )
                : null,
            };
          }),
      })),
  };
  if (Object.isFrozen(story)) compiledStories.set(story, result);
  return result;
}
/** Cubic Bezier timing uses x as time; y may overshoot. Deterministic bounded inversion. */
export function bezierEase(
  time: number,
  handles: [number, number, number, number],
): number {
  if (time <= 0) return 0;
  if (time >= 1) return 1;
  const [x1, y1, x2, y2] = handles,
    cubic = (t: number, a: number, b: number) =>
      3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  let low = 0,
    high = 1;
  for (let i = 0; i < 22; i++) {
    const mid = (low + high) / 2;
    if (cubic(mid, x1, x2) < time) low = mid;
    else high = mid;
  }
  return cubic((low + high) / 2, y1, y2);
}
/** One absolute-time evaluator. Runtime holds its compiled index; immutable documents share cached indices. */
export function evaluateStoryboard(
  story: Storyboard,
  time: number,
  index = compileStoryboard(story),
): StorySample[] {
  if (index.source !== story) throw Error("故事板索引与文档修订不一致");
  if (!Number.isFinite(time)) throw Error("故事板时间必须为有限数值");
  time = Math.max(0, Math.min(story.duration, time));
  const samples: StorySample[] = [];
  const mix = (a: Vec3, b: Vec3, t: number): Vec3 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
  for (const { track, clips } of index.tracks) {
    let low = 0,
      high = clips.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (clips[mid].clip.start <= time) low = mid + 1;
      else high = mid;
    }
    const compiled = clips[low - 1];
    if (!compiled) continue;
    const { clip, frames } = compiled;
    const parameter =
      (clip.curveStart ?? 0) +
      ((clip.curveEnd ?? 1) - (clip.curveStart ?? 0)) *
        Math.max(0, Math.min(1, (time - clip.start) / clip.duration));
    let left = 0,
      right = frames.length - 1;
    while (left + 1 < right) {
      const mid = (left + right) >>> 1;
      if (frames[mid].time <= parameter) left = mid;
      else right = mid;
    }
    const a = frames[left],
      b = frames[right],
      linear = Math.max(
        0,
        Math.min(1, (parameter - a.time) / (b.time - a.time)),
      ),
      t = a.bezier ? bezierEase(linear, a.bezier) : ease(linear, a.easing);
    const transform: Transform = {
      position: mix(a.transform.position, b.transform.position, t),
      scale: mix(a.transform.scale, b.transform.scale, t),
      rotation: compiled.scratch
        .copy(compiled.rotations[left])
        .slerp(compiled.rotations[right], t)
        .toArray() as [number, number, number, number],
    };
    if (compiled.curve && !clip.keyframes?.length)
      transform.position = compiled.curve.getPoint(t, compiled.point).toArray();
    samples.push({
      track,
      clip,
      time,
      t,
      active: time < clip.start + clip.duration,
      value: a.value + (b.value - a.value) * t,
      transform,
      camera: {
        position: mix(a.camera.position, b.camera.position, t),
        target: mix(a.camera.target, b.camera.target, t),
        fov: a.camera.fov + (b.camera.fov - a.camera.fov) * t,
      },
    });
  }
  return samples;
}
/** One transaction applies a ripple edit to unlocked downstream clips and markers. */
export function rippleStory(
  story: Storyboard,
  at: number,
  delta: number,
  excludedIds: string[] = [],
): void {
  if (
    !Number.isFinite(at) ||
    !Number.isFinite(delta) ||
    story.duration + delta <= 0
  )
    throw Error("波纹编辑范围无效");
  const excluded = new Set(excludedIds);
  for (const track of story.tracks)
    if (!track.locked)
      for (const clip of track.clips)
        if (!excluded.has(clip.id) && clip.start >= at) {
          if (clip.start + delta < 0)
            throw Error("波纹编辑会把片段移动到零点之前");
          clip.start += delta;
        }
  for (const marker of story.markers)
    if (marker.time >= at) {
      if (marker.time + delta < 0)
        throw Error("波纹编辑会把标记移动到零点之前");
      marker.time += delta;
    }
  for (const snapshot of story.snapshots)
    if (snapshot.bound && snapshot.time >= at) snapshot.time += delta;
  story.duration += delta;
}
export function subtitles(story: Storyboard): string {
  const stamp = (seconds: number) => {
    const milliseconds = Math.round(seconds * 1000),
      hours = Math.floor(milliseconds / 3600000),
      minutes = Math.floor(milliseconds / 60000) % 60,
      secs = Math.floor(milliseconds / 1000) % 60;
    return (
      [hours, minutes, secs].map((v) => String(v).padStart(2, "0")).join(":") +
      "." +
      String(milliseconds % 1000).padStart(3, "0")
    );
  };
  return (
    "WEBVTT\n\n" +
    story.tracks
      .filter((t) => !t.muted && t.channel === "caption")
      .flatMap((t) => t.clips)
      .sort((a, b) => a.start - b.start)
      .map(
        (c) =>
          `${c.id}\n${stamp(c.start)} --> ${stamp(c.start + c.duration)}\n${c.text.replaceAll("-->", "→")}\n`,
      )
      .join("\n")
  );
}
export function validateStory(story: Storyboard): string[] {
  const errors: string[] = [],
    ids = new Set<string>();
  for (const track of story.tracks) {
    if (ids.has(track.id)) errors.push("轨道 ID 重复");
    ids.add(track.id);
    for (const clip of track.clips) {
      if (ids.has(clip.id)) errors.push("片段 ID 重复");
      ids.add(clip.id);
      const times = new Set<number>();
      for (const frame of clip.keyframes ?? []) {
        if (
          !Number.isFinite(frame.time) ||
          frame.time < 0 ||
          frame.time > 1 ||
          times.has(frame.time)
        )
          errors.push("关键帧时间必须在 0～1 且不重复");
        times.add(frame.time);
      }
      for (const handles of [
        clip.bezier,
        ...(clip.keyframes ?? []).map((f) => f.bezier),
      ])
        if (
          handles &&
          (handles.length !== 4 ||
            handles.some((v) => !Number.isFinite(v)) ||
            handles[0] < 0 ||
            handles[0] > 1 ||
            handles[2] < 0 ||
            handles[2] > 1)
        )
          errors.push("Bezier 时间控制点 x 必须在 0～1");
      if ((clip.curveStart ?? 0) > (clip.curveEnd ?? 1))
        errors.push("片段求值窗口无效");
      if (clip.start + clip.duration > story.duration + 0.000001)
        errors.push("片段超出故事板时长：" + clip.name);
    }
    for (const other of story.tracks)
      if (
        other.id < track.id &&
        other.targetId === track.targetId &&
        other.channel === track.channel &&
        other.priority === track.priority &&
        !other.muted &&
        !track.muted
      )
        for (const a of track.clips)
          for (const b of other.clips)
            if (
              a.start < b.start + b.duration &&
              b.start < a.start + a.duration
            )
              errors.push("相同目标通道重叠，需要明确不同合成优先级");
    for (let i = 0; i < track.clips.length; i++)
      for (let j = i + 1; j < track.clips.length; j++) {
        const a = track.clips[i],
          b = track.clips[j];
        if (a.start < b.start + b.duration && b.start < a.start + a.duration)
          errors.push("同轨片段重叠：" + track.name);
      }
  }
  return [...new Set(errors)];
}
