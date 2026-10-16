import type { SceneDocument } from "../../scene-schema/src/types";
import { validateStory, type Storyboard } from "./core";
export function validate(document: SceneDocument, publish: boolean): string[] {
  const errors: string[] = [];
  for (const e of document.entities)
    for (const c of e.components)
      if (c.enabled && c.type === "studio.storyboard.Sequence") {
        const story = c.data as unknown as Storyboard;
        errors.push(...validateStory(story));
        if (publish)
          for (const track of story.tracks) {
            if (track.muted || !track.clips.length) continue;
            if (
              track.channel === "audio" &&
              !document.entities
                .find((e) => e.id === track.targetId)
                ?.components.some((c) => c.enabled && c.type === "Audio")
            )
              errors.push("音频轨道目标能力不匹配");
            if (
              [
                "transform",
                "opacity",
                "visibility",
                "annotation",
                "assembly",
                "audio",
              ].includes(track.channel) &&
              !track.targetId
            )
              errors.push("故事板轨道缺少目标：" + track.name);
            if (
              track.channel === "assembly" &&
              !document.entities
                .find((e) => e.id === track.targetId)
                ?.components.some(
                  (c) => c.enabled && c.type === "studio.assembly.Root",
                )
            )
              errors.push("装配轨道目标能力不匹配");
          }
      }
  return errors;
}
