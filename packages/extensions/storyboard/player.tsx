import { useState } from "react";
import { createAction, getComponent } from "../../scene-schema/src/index";
import type { PlayerWidget, PlayerWidgetProps } from "../player-contract";
import type { Storyboard } from "./core";
function StoryboardWidget({
  document,
  runtime,
  state,
  node,
  design,
}: PlayerWidgetProps) {
  const sequences = document.entities.filter((e) =>
      getComponent(e, "studio.storyboard.Sequence"),
    ),
    [active, setActive] = useState(""),
    [error, setError] = useState("");
  const entity =
    sequences.find((e) => e.id === (node?.targetId || active)) ?? sequences[0];
  if (!entity) return null;
  const story = getComponent(entity, "studio.storyboard.Sequence")!
      .data as unknown as Storyboard,
    playback = state.extensions["studio.storyboard:" + entity.id],
    time = Number(playback?.time ?? 0);
  const run = (type: string, values: Record<string, number> = {}) => {
    if (!runtime) return;
    const a = createAction("studio.storyboard." + type);
    a.targetId = entity.id;
    Object.assign(a.data, values);
    void runtime.dispatch(a).catch((error) => setError(String(error)));
  };
  return (
    <section className="storyboard-player" aria-label="演示播放">
      <select
        aria-label="选择演示"
        value={entity.id}
        onChange={(e) => {
          if (playback?.playing) run("Stop");
          setActive(e.target.value);
        }}
      >
        {sequences.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
      <div className="player-action-row">
        <button
          disabled={design}
          onClick={() => run("Play", { time, speed: 1 })}
        >
          播放
        </button>
        <button disabled={design} onClick={() => run("Pause")}>
          暂停
        </button>
        <button
          disabled={design}
          onClick={() => run("Play", { time, speed: -1 })}
        >
          倒放
        </button>
        <button disabled={design} onClick={() => run("Stop")}>
          结束
        </button>
      </div>
      <label>
        {time.toFixed(2)} / {story.duration}s
        <input
          type="range"
          min={0}
          max={story.duration}
          step={1 / Number(story.fps)}
          disabled={design}
          value={time}
          onChange={(e) => run("Seek", { time: Number(e.target.value) })}
        />
      </label>
      <nav aria-label="演示章节">
        {story.markers.map((marker) => (
          <button
            key={marker.id}
            disabled={design}
            onClick={() => run("Seek", { time: marker.time })}
          >
            {marker.name}
          </button>
        ))}
      </nav>
      {playback?.caption && (
        <p className="storyboard-caption" aria-live="polite">
          {String(playback.caption)}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
export const widgets: PlayerWidget[] = [
  {
    kind: "storyboard",
    title: "故事板播放",
    componentType: "studio.storyboard.Sequence",
    Component: StoryboardWidget,
  },
];
