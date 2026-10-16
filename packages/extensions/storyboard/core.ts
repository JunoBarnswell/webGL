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
export interface StoryClip {
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
/** Pure absolute-time sampling: no previous frame and no fixed-frame-rate dependency. */
export function evaluateStoryboard(
  story: Storyboard,
  time: number,
): StorySample[] {
  time = THREE.MathUtils.clamp(time, 0, story.duration);
  return story.tracks
    .filter((t) => !t.muted)
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
    .flatMap((track) => {
      const clip = [...track.clips]
        .filter((c) => c.start <= time)
        .sort((a, b) => b.start - a.start || b.id.localeCompare(a.id))[0];
      if (!clip) return [];
      const t = ease(
          THREE.MathUtils.lerp(
            clip.curveStart ?? 0,
            clip.curveEnd ?? 1,
            THREE.MathUtils.clamp((time - clip.start) / clip.duration, 0, 1),
          ),
          clip.easing,
        ),
        mix = (a: Vec3, b: Vec3) =>
          new THREE.Vector3()
            .fromArray(a)
            .lerp(new THREE.Vector3().fromArray(b), t)
            .toArray() as Vec3;
      const transform: Transform = {
        position: mix(clip.fromTransform.position, clip.toTransform.position),
        rotation: new THREE.Quaternion()
          .fromArray(clip.fromTransform.rotation)
          .slerp(new THREE.Quaternion().fromArray(clip.toTransform.rotation), t)
          .toArray() as [number, number, number, number],
        scale: mix(clip.fromTransform.scale, clip.toTransform.scale),
      };
      if (clip.path.length)
        transform.position = new THREE.CatmullRomCurve3(
          [
            clip.fromTransform.position,
            ...clip.path,
            clip.toTransform.position,
          ].map((p) => new THREE.Vector3().fromArray(p)),
        )
          .getPoint(t)
          .toArray();
      const camera = {
        position: mix(clip.fromCamera.position, clip.toCamera.position),
        target: mix(clip.fromCamera.target, clip.toCamera.target),
        fov: THREE.MathUtils.lerp(clip.fromCamera.fov, clip.toCamera.fov, t),
      };
      return [
        {
          track,
          clip,
          time,
          t,
          active: time < clip.start + clip.duration,
          value: THREE.MathUtils.lerp(clip.fromValue, clip.toValue, t),
          transform,
          camera,
        },
      ];
    });
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
