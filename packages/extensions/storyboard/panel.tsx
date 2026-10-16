import { useEffect, useRef, useState } from "react";
import { createAction, type Transform } from "../../scene-schema/src/index";
import type { ExtensionPanelProps } from "../editor-contract";
import { useDomainEntity, captureThumbnail, AssetThumbnail } from "../designer";
import {
  newClip,
  evaluateStoryboard,
  rippleStory,
  subtitles,
  type Storyboard,
  type StoryClip,
  type TrackChannel,
} from "./core";
import type StoryboardSystem from "./runtime";
export function StoryboardPanel(props: ExtensionPanelProps) {
  const domain = useDomainEntity<Storyboard>(
      "studio.storyboard.Sequence",
      props,
    ),
    { data, entity, mutate } = domain;
  const [tab, setTab] = useState("timeline"),
    [channel, setChannel] = useState<TrackChannel>("transform"),
    [zoom, setZoom] = useState(32),
    [selection, setSelection] = useState<string[]>([]),
    [snap, setSnap] = useState(true),
    [collapsed, setCollapsed] = useState<string[]>([]),
    [preset, setPreset] = useState("产品发布");
  const [ripple, setRipple] = useState(1),
    [timelineView, setTimelineView] = useState({ left: 0, width: 1200 });
  const activeTrack = data?.tracks.find((t) =>
      t.clips.some((c) => selection.includes(c.id)),
    ),
    activeClip = activeTrack?.clips.find((c) => selection.includes(c.id));
  const addKeyframe = () =>
    mutate("记录播放头关键帧", (story) => {
      const sample = evaluateStoryboard(story, time).find(
        (s) => s.clip.id === activeClip?.id,
      );
      if (!sample || !sample.active || sample.track.locked)
        throw Error("播放头必须位于一个未锁定的选中片段中");
      const clip = sample.clip,
        parameter =
          clip.curveStart +
          ((clip.curveEnd - clip.curveStart) * (time - clip.start)) /
            clip.duration;
      const frames = (clip.keyframes ??= []);
      const existing = frames.find((f) => Math.abs(f.time - parameter) < 1e-8);
      const object = props.runtime?.getObject(sample.track.targetId),
        target = props.document.entities.find(
          (e) => e.id === sample.track.targetId,
        ),
        units = props.runtime && target ? props.runtime.sourceUnits(target) : 1;
      const pose: Transform = object
        ? {
            position: object.position
              .toArray()
              .map((v) => v * units) as Transform["position"],
            rotation: object.quaternion.toArray() as Transform["rotation"],
            scale: object.scale.toArray(),
          }
        : sample.transform;
      const frame = {
        id: existing?.id ?? crypto.randomUUID(),
        time: parameter,
        transform: pose,
        camera: props.runtime?.getCameraPose() ?? sample.camera,
        value: sample.value,
        easing: "smooth",
      };
      if (existing) Object.assign(existing, frame);
      else frames.push(frame);
    });
  const waveform = () =>
    void props.services.run("分析原始音频波形", async () => {
      if (!activeTrack || !activeClip || activeTrack.channel !== "audio")
        throw Error("请选择音频轨道片段");
      const entity = props.document.entities.find(
          (e) => e.id === activeTrack.targetId,
        ),
        audio = entity?.components.find((c) => c.type === "Audio" && c.enabled),
        asset = props.document.assets.find((a) => a.id === audio?.data.assetId);
      if (!asset) throw Error("音频资源不存在");
      const bytes = await props.services.assetBytes(asset.id, asset.entry),
        context = new AudioContext();
      try {
        const buffer = await context.decodeAudioData(bytes.slice(0)),
          peaks = Array.from({ length: 256 }, (_, index) => {
            let peak = 0;
            const start = Math.floor((index * buffer.length) / 256),
              end = Math.floor(((index + 1) * buffer.length) / 256);
            for (
              let channel = 0;
              channel < buffer.numberOfChannels;
              channel++
            ) {
              const samples = buffer.getChannelData(channel);
              for (let i = start; i < end; i++)
                peak = Math.max(peak, Math.abs(samples[i]));
            }
            return Math.min(1, peak);
          });
        mutate("保存音频波形", (story) => {
          const track = story.tracks.find((t) => t.id === activeTrack.id),
            clip = track?.clips.find((c) => c.id === activeClip.id);
          if (!clip || track?.targetId !== activeTrack.targetId)
            throw Error("音频轨道已变化");
          clip.waveform = peaks;
        });
      } finally {
        await context.close();
      }
    });
  const drag = useRef<{
    x: number;
    start: number;
    duration: number;
    clipId: string;
    trackId: string;
    edge: string;
    node: HTMLElement;
    left: string;
    width: string;
  } | null>(null);
  const system = props.runtime?.systems.find(
    (s) => s.id === "studio.storyboard",
  ) as StoryboardSystem | undefined;
  useEffect(() => {
    if (entity)
      props.runtime?.capabilities.set("studio.storyboard.active", entity.id);
  }, [entity?.id, props.runtime]);
  const state = entity
      ? props.state.extensions["studio.storyboard:" + entity.id]
      : undefined,
    time = Number(state?.time ?? 0);
  const run = (
    type: string,
    value: Record<string, string | number | boolean> = {},
  ) => {
    if (!entity) return;
    const a = createAction("studio.storyboard." + type);
    a.targetId = entity.id;
    Object.assign(a.data, value);
    if (props.mode === "edit" && system) {
      try {
        if (type === "Play")
          system.play(
            entity.id,
            Number(value.speed ?? 1),
            Number(value.time ?? time),
          );
        else if (type === "Pause") system.pause(entity.id);
        else if (type === "Stop") system.stop(entity.id);
        else system.seek(entity.id, Number(value.time ?? time));
      } catch (error) {
        void props.services.run("故事板预览", async () => {
          throw error;
        });
      }
    } else void props.dispatch(a);
  };
  const addTrack = () => {
    const id = crypto.randomUUID(),
      clip = newClip(Math.min(time, Math.max(0, (data?.duration ?? 30) - 2))),
      targetId = props.selectedIds.find((id) => id !== entity?.id) ?? "";
    const target = props.document.entities.find((e) => e.id === targetId);
    if (target) {
      clip.fromTransform = structuredClone(target.transform);
      clip.toTransform = structuredClone(target.transform);
    }
    if (props.runtime) {
      clip.fromCamera = props.runtime.getCameraPose();
      clip.toCamera = structuredClone(clip.fromCamera);
    }
    mutate("添加故事板轨道", (d) =>
      d.tracks.push({
        id,
        name: channel,
        channel,
        targetId,
        contentId: "",
        muted: false,
        locked: false,
        priority: 0,
        clips: [clip],
      }),
    );
  };
  const dragStart = (
    event: React.PointerEvent<HTMLElement>,
    trackId: string,
    clip: StoryClip,
    edge: string,
  ) => {
    if (
      props.mode === "play" ||
      data?.tracks.find((t) => t.id === trackId)?.locked
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const node = event.currentTarget.closest<HTMLElement>(".timeline-clip")!;
    drag.current = {
      x: event.clientX,
      start: clip.start,
      duration: clip.duration,
      clipId: clip.id,
      trackId,
      edge,
      node,
      left: node.style.left,
      width: node.style.width,
    };
  };
  const dragMove = (event: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const delta = (event.clientX - d.x) / zoom;
    const step = snap ? 1 / Number(data?.fps ?? 30) : 0.001;
    const offset = Math.round(delta / step) * step;
    d.node.style.left =
      Math.max(0, d.start + (d.edge === "end" ? 0 : offset)) * zoom + "px";
    d.node.style.width =
      Math.max(
        step,
        d.duration +
          (d.edge === "end" ? offset : d.edge === "start" ? -offset : 0),
      ) *
        zoom +
      "px";
  };
  const dragEnd = (event: React.PointerEvent<HTMLElement>, cancel = false) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    d.node.style.left = d.left;
    d.node.style.width = d.width;
    if (cancel) return;
    const step = snap ? 1 / Number(data?.fps ?? 30) : 0.001,
      offset = Math.round((event.clientX - d.x) / zoom / step) * step;
    mutate("调整时间线片段", (story) => {
      const track = story.tracks.find((t) => t.id === d.trackId),
        clip = track?.clips.find((c) => c.id === d.clipId);
      if (!clip) return;
      const ids = new Set(selection.includes(clip.id) ? selection : [clip.id]);
      for (const t of story.tracks)
        for (const c of t.clips)
          if (ids.has(c.id) && !t.locked) {
            if (d.edge === "move")
              c.start = Math.max(
                0,
                Math.min(story.duration - c.duration, c.start + offset),
              );
            else if (d.edge === "start") {
              const end = c.start + c.duration;
              c.start = Math.max(0, Math.min(end - step, c.start + offset));
              c.duration = end - c.start;
            } else
              c.duration = Math.max(
                step,
                Math.min(story.duration - c.start, c.duration + offset),
              );
          }
    });
  };
  return (
    <div className="domain-designer storyboard-designer">
      <div className="designer-toolbar">
        <select
          aria-label="故事板"
          value={entity?.id ?? ""}
          onChange={(e) => domain.choose(e.target.value)}
        >
          {domain.entities.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <select
          aria-label="故事板模板"
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
        >
          {["产品发布", "汽车装配", "展厅讲解", "设备维保"].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <button
          onClick={() =>
            domain.create(preset, (d) => {
              d.name = preset;
              d.tracks = (
                [
                  "camera",
                  "transform",
                  "opacity",
                  "annotation",
                  "audio",
                  "caption",
                ] as TrackChannel[]
              ).map((channel) => ({
                id: crypto.randomUUID(),
                name: channel,
                channel,
                targetId: "",
                contentId: "",
                muted: false,
                locked: false,
                priority: 0,
                clips: [],
              }));
            })
          }
        >
          新建故事板
        </button>
        {["timeline", "properties", "snapshots", "scratch"].map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {
              {
                timeline: "时间线",
                properties: "轨道属性",
                snapshots: "镜头快照",
                scratch: "Scratch 试摆",
              }[t]
            }
          </button>
        ))}
      </div>
      {data && entity && (
        <>
          <div className="designer-toolbar">
            <button onClick={() => run("Play", { time, speed: 1 })}>▶</button>
            <button onClick={() => run("Pause")}>暂停</button>
            <button onClick={() => run("Play", { time, speed: -1 })}>
              倒放
            </button>
            <button onClick={() => run("Stop")}>停止并恢复</button>
            <label>
              时间{" "}
              <input
                type="number"
                min={0}
                max={data.duration}
                step={1 / Number(data.fps)}
                value={time.toFixed(3)}
                onChange={(e) => run("Seek", { time: Number(e.target.value) })}
              />
            </label>
            <strong>
              {data.duration}s / {data.fps}fps
            </strong>
            <label>
              <input
                type="checkbox"
                checked={snap}
                onChange={(e) => setSnap(e.target.checked)}
              />
              吸附到帧
            </label>
            <label>
              缩放
              <input
                type="range"
                min={8}
                max={160}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
              />
            </label>
          </div>
          {tab === "timeline" && (
            <>
              <div className="designer-toolbar">
                <button
                  disabled={!activeClip || activeTrack?.locked}
                  onClick={addKeyframe}
                >
                  记录关键帧
                </button>
                <label>
                  波纹秒数
                  <input
                    aria-label="波纹秒数"
                    type="number"
                    step={0.1}
                    value={ripple}
                    onChange={(event) =>
                      setRipple(event.currentTarget.valueAsNumber)
                    }
                  />
                </label>
                <button
                  onClick={() =>
                    mutate("波纹编辑", (story) =>
                      rippleStory(story, time, ripple),
                    )
                  }
                >
                  在播放头插入 / 移除时间
                </button>
                <button
                  onClick={waveform}
                  disabled={activeTrack?.channel !== "audio"}
                >
                  生成音频波形
                </button>
                <button
                  onClick={() =>
                    props.services.downloadFile(
                      data.name + ".vtt",
                      new Blob([subtitles(data)], { type: "text/vtt" }),
                    )
                  }
                >
                  导出字幕 VTT
                </button>
                <select
                  aria-label="新轨道通道"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value as TrackChannel)}
                >
                  {[
                    "camera",
                    "transform",
                    "visibility",
                    "opacity",
                    "annotation",
                    "assembly",
                    "content",
                    "audio",
                    "caption",
                  ].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <button onClick={addTrack}>添加轨道 / 当前对象</button>
                <button
                  onClick={() =>
                    mutate("复制故事板片段", (s) => {
                      for (const t of s.tracks)
                        for (const c of [...t.clips])
                          if (selection.includes(c.id) && !t.locked)
                            t.clips.push({
                              ...structuredClone(c),
                              id: crypto.randomUUID(),
                              start: Math.min(
                                s.duration - c.duration,
                                c.start + c.duration,
                              ),
                            });
                    })
                  }
                >
                  复制选中
                </button>
                <button
                  onClick={() =>
                    mutate("删除故事板片段", (s) => {
                      for (const t of s.tracks)
                        if (!t.locked)
                          t.clips = t.clips.filter(
                            (c) => !selection.includes(c.id),
                          );
                    })
                  }
                >
                  删除片段
                </button>
                <button
                  onClick={() =>
                    mutate("按播放头拆分片段", (s) => {
                      for (const track of s.tracks)
                        for (const clip of [...track.clips])
                          if (
                            selection.includes(clip.id) &&
                            !track.locked &&
                            time > clip.start &&
                            time < clip.start + clip.duration
                          ) {
                            const fraction =
                                (time - clip.start) / clip.duration,
                              boundary =
                                clip.curveStart +
                                (clip.curveEnd - clip.curveStart) * fraction,
                              after = {
                                ...structuredClone(clip),
                                id: crypto.randomUUID(),
                                start: time,
                                duration: clip.duration * (1 - fraction),
                                curveStart: boundary,
                              };
                            clip.duration *= fraction;
                            clip.curveEnd = boundary;
                            track.clips.push(after);
                          }
                    })
                  }
                >
                  按播放头拆分
                </button>
                <button
                  onClick={() =>
                    mutate("组合片段", (s) => {
                      const group = crypto.randomUUID();
                      for (const t of s.tracks)
                        for (const c of t.clips)
                          if (selection.includes(c.id) && !t.locked)
                            c.groupId = group;
                    })
                  }
                >
                  成组
                </button>
              </div>
              <div
                className="timeline"
                data-focus-scope="timeline"
                tabIndex={0}
                aria-label="故事板时间线"
                onScroll={(event) =>
                  setTimelineView({
                    left: event.currentTarget.scrollLeft,
                    width: event.currentTarget.clientWidth,
                  })
                }
                onKeyDown={(event) => {
                  if (event.key === "Escape" && drag.current) {
                    drag.current.node.style.left = drag.current.left;
                    drag.current.node.style.width = drag.current.width;
                    drag.current = null;
                    event.preventDefault();
                  }
                }}
              >
                <div
                  className="timeline-content"
                  style={{ minWidth: 180 + data.duration * zoom }}
                >
                  <div className="timeline-ruler">
                    {data.markers.map((marker) => (
                      <button
                        key={marker.id}
                        className="timeline-marker"
                        title={marker.name}
                        style={{ left: 180 + marker.time * zoom }}
                        onClick={() => run("Seek", { time: marker.time })}
                      >
                        ◆ {marker.name}
                      </button>
                    ))}
                    {Array.from(
                      { length: Math.ceil(data.duration) + 1 },
                      (_, i) => (
                        <button
                          key={i}
                          style={{ left: 180 + i * zoom }}
                          onClick={() => run("Seek", { time: i })}
                        >
                          {i}s
                        </button>
                      ),
                    )}
                  </div>
                  <div
                    className="playhead"
                    style={{ left: 180 + time * zoom }}
                  />
                  {data.tracks.map((track) => (
                    <div key={track.id} className="timeline-track">
                      <div className="track-header">
                        <button
                          aria-label="折叠轨道"
                          onClick={() =>
                            setCollapsed(
                              collapsed.includes(track.id)
                                ? collapsed.filter((id) => id !== track.id)
                                : [...collapsed, track.id],
                            )
                          }
                        >
                          {collapsed.includes(track.id) ? "▸" : "▾"}
                        </button>
                        <button
                          onClick={() =>
                            track.targetId && props.select([track.targetId])
                          }
                        >
                          {track.name}
                        </button>
                        <button
                          aria-label="轨道锁定"
                          onClick={() =>
                            mutate("锁定轨道", (s) => {
                              s.tracks.find((t) => t.id === track.id)!.locked =
                                !track.locked;
                            })
                          }
                        >
                          {track.locked ? "🔒" : "○"}
                        </button>
                        <button
                          onClick={() =>
                            mutate("静音轨道", (s) => {
                              s.tracks.find((t) => t.id === track.id)!.muted =
                                !track.muted;
                            })
                          }
                        >
                          {track.muted ? "静音" : "开"}
                        </button>
                      </div>
                      {!collapsed.includes(track.id) &&
                        track.clips
                          .filter(
                            (clip) =>
                              clip.start * zoom + clip.duration * zoom + 180 >=
                                timelineView.left &&
                              clip.start * zoom + 180 <=
                                timelineView.left + timelineView.width,
                          )
                          .map((clip) => (
                            <div
                              role="button"
                              tabIndex={0}
                              aria-label={clip.name}
                              key={clip.id}
                              className={
                                "timeline-clip " +
                                track.channel +
                                (selection.includes(clip.id) ? " selected" : "")
                              }
                              style={{
                                left: 180 + clip.start * zoom,
                                width: clip.duration * zoom,
                              }}
                              onClick={(e) => {
                                const ids = clip.groupId
                                  ? data.tracks.flatMap((t) =>
                                      t.clips
                                        .filter(
                                          (c) => c.groupId === clip.groupId,
                                        )
                                        .map((c) => c.id),
                                    )
                                  : [clip.id];
                                setSelection(
                                  e.shiftKey
                                    ? [...new Set([...selection, ...ids])]
                                    : ids,
                                );
                                if (track.targetId)
                                  props.select([track.targetId]);
                              }}
                              onPointerDown={(e) =>
                                dragStart(e, track.id, clip, "move")
                              }
                              onPointerMove={dragMove}
                              onPointerUp={(e) => dragEnd(e)}
                              onPointerCancel={(e) => dragEnd(e, true)}
                            >
                              <span
                                className="clip-handle start"
                                onPointerDown={(e) =>
                                  dragStart(e, track.id, clip, "start")
                                }
                              />
                              <span>{clip.name}</span>
                              {clip.waveform && (
                                <svg
                                  className="clip-waveform"
                                  viewBox={`0 0 ${clip.waveform.length} 24`}
                                  preserveAspectRatio="none"
                                >
                                  <path
                                    d={clip.waveform
                                      .map(
                                        (peak, i) =>
                                          `M${i} ${12 - peak * 11}v${peak * 22}`,
                                      )
                                      .join(" ")}
                                    stroke="#b3e5e0"
                                    strokeWidth={0.6}
                                  />
                                </svg>
                              )}
                              {clip.keyframes
                                ?.filter(
                                  (frame) =>
                                    frame.time >= clip.curveStart &&
                                    frame.time <= clip.curveEnd,
                                )
                                .map((frame) => (
                                  <button
                                    key={frame.id}
                                    className="timeline-keyframe"
                                    title={`关键帧 ${frame.time.toFixed(3)}`}
                                    style={{
                                      left:
                                        ((frame.time - clip.curveStart) /
                                          (clip.curveEnd - clip.curveStart)) *
                                          100 +
                                        "%",
                                    }}
                                    onPointerDown={(event) =>
                                      event.stopPropagation()
                                    }
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setSelection([clip.id]);
                                      run("Seek", {
                                        time:
                                          clip.start +
                                          (clip.duration *
                                            (frame.time - clip.curveStart)) /
                                            (clip.curveEnd - clip.curveStart),
                                      });
                                    }}
                                  >
                                    ◆
                                  </button>
                                ))}
                              <span
                                className="clip-handle end"
                                onPointerDown={(e) =>
                                  dragStart(e, track.id, clip, "end")
                                }
                              />
                            </div>
                          ))}
                    </div>
                  ))}
                </div>
              </div>
              {activeClip && (
                <fieldset>
                  <legend>选中片段关键帧与缓动 · {activeClip.name}</legend>
                  <label>
                    Bezier 缓动
                    <input
                      type="checkbox"
                      checked={Boolean(activeClip.bezier)}
                      onChange={(event) =>
                        mutate("切换 Bezier 缓动", (story) => {
                          const clip = story.tracks
                            .flatMap((t) => t.clips)
                            .find((c) => c.id === activeClip.id)!;
                          if (event.target.checked)
                            clip.bezier = [0.25, 0.1, 0.25, 1];
                          else delete clip.bezier;
                        })
                      }
                    />
                  </label>
                  {activeClip.bezier?.map((value, index) => (
                    <label key={index}>
                      {["x₁", "y₁", "x₂", "y₂"][index]}
                      <input
                        type="number"
                        step={0.05}
                        min={index % 2 === 0 ? 0 : undefined}
                        max={index % 2 === 0 ? 1 : undefined}
                        value={value}
                        onChange={(event) => {
                          const next = event.currentTarget.valueAsNumber;
                          if (Number.isFinite(next))
                            mutate("调整 Bezier 控制点", (story) => {
                              story.tracks
                                .flatMap((t) => t.clips)
                                .find((c) => c.id === activeClip.id)!.bezier![
                                index
                              ] = next;
                            });
                        }}
                      />
                    </label>
                  ))}
                  <svg
                    className="timing-curve"
                    viewBox="0 0 120 80"
                    aria-label="Bezier 缓动曲线"
                  >
                    <path
                      d={
                        activeClip.bezier
                          ? `M10 70 C${10 + activeClip.bezier[0] * 100} ${70 - activeClip.bezier[1] * 60} ${10 + activeClip.bezier[2] * 100} ${70 - activeClip.bezier[3] * 60} 110 10`
                          : "M10 70 L110 10"
                      }
                      fill="none"
                      stroke="#64d6b7"
                      strokeWidth={2}
                    />
                  </svg>
                  {activeClip.keyframes?.map((frame) => (
                    <div className="button-group" key={frame.id}>
                      <span>◆</span>
                      <label>
                        归一化时间
                        <input
                          type="number"
                          min={0}
                          max={1}
                          step={0.001}
                          value={frame.time}
                          onChange={(event) => {
                            const next = event.currentTarget.valueAsNumber;
                            if (Number.isFinite(next))
                              mutate("调整关键帧时间", (story) => {
                                story.tracks
                                  .flatMap((t) => t.clips)
                                  .find((c) => c.id === activeClip.id)!
                                  .keyframes!.find(
                                    (f) => f.id === frame.id,
                                  )!.time = next;
                              });
                          }}
                        />
                      </label>
                      <label>
                        数值
                        <input
                          type="number"
                          step={0.01}
                          value={frame.value}
                          onChange={(event) => {
                            const next = event.currentTarget.valueAsNumber;
                            if (Number.isFinite(next))
                              mutate("调整关键帧数值", (story) => {
                                story.tracks
                                  .flatMap((t) => t.clips)
                                  .find((c) => c.id === activeClip.id)!
                                  .keyframes!.find(
                                    (f) => f.id === frame.id,
                                  )!.value = next;
                              });
                          }}
                        />
                      </label>
                      <button
                        onClick={() =>
                          mutate("删除关键帧", (story) => {
                            const clip = story.tracks
                              .flatMap((t) => t.clips)
                              .find((c) => c.id === activeClip.id)!;
                            clip.keyframes = clip.keyframes?.filter(
                              (f) => f.id !== frame.id,
                            );
                          })
                        }
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </fieldset>
              )}
            </>
          )}
          {tab === "properties" &&
            domain.fields([
              "name",
              "duration",
              "fps",
              "loop",
              "tracks",
              "markers",
            ])}
          {tab === "snapshots" && (
            <section>
              <button
                onClick={() =>
                  void props.services.run("记录镜头快照", async () => {
                    if (!props.runtime) return;
                    const runtime = props.runtime;
                    const asset = await captureThumbnail(props, "故事板镜头");
                    props.command({
                      label: "保存镜头快照",
                      mutate(doc) {
                        doc.assets.push(asset);
                        const c = doc.entities
                          .find((e) => e.id === entity.id)!
                          .components.find(
                            (c) => c.type === "studio.storyboard.Sequence",
                          )!;
                        const s = c.data as unknown as Storyboard;
                        s.snapshots.push({
                          id: crypto.randomUUID(),
                          name: "镜头 " + (s.snapshots.length + 1),
                          pose: runtime.getCameraPose(),
                          thumbnailAssetId: asset.id,
                          bound: true,
                          time,
                        });
                      },
                    });
                  })
                }
              >
                记录镜头及缩略图
              </button>
              {data.snapshots.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    if (s.bound) run("Seek", { time: s.time });
                    props.runtime?.applyCameraPose(s.pose);
                  }}
                >
                  <AssetThumbnail
                    id={s.thumbnailAssetId}
                    assets={props.document.assets}
                    services={props.services}
                    alt={s.name}
                  />
                  {s.name} · {s.bound ? s.time + "s" : "独立镜头"}
                </button>
              ))}
              {domain.fields(["snapshots"])}
            </section>
          )}
          {tab === "scratch" && (
            <section>
              <p>
                试摆只作用于临时会话。录制才会把变化写入故事板，退出后恢复作者基线。
              </p>
              <button
                disabled={props.services.scratchActive}
                onClick={() =>
                  void props.services.run(
                    "进入试摆",
                    props.services.beginScratch,
                  )
                }
              >
                进入试摆
              </button>
              <button
                disabled={!props.services.scratchActive}
                onClick={() =>
                  void props.services.run("退出试摆", async () => {
                    await props.services.cancelScratch();
                  })
                }
              >
                放弃并恢复
              </button>
              <button
                disabled={!props.services.scratchActive}
                onClick={() =>
                  void props.services.run("录制试摆", async () => {
                    const targetId = props.selectedIds[0],
                      target = props.document.entities.find(
                        (e) => e.id === targetId,
                      );
                    if (!target) throw Error("选择一个试摆对象");
                    const to = structuredClone(target.transform),
                      baseline = await props.services.cancelScratch();
                    const from = baseline.entities.find(
                      (e) => e.id === targetId,
                    )?.transform;
                    if (!from) throw Error("试摆目标不在作者基线");
                    const clip = newClip(time);
                    clip.fromTransform = from as Transform;
                    clip.toTransform = to;
                    props.command({
                      label: "录制试摆为时间线片段",
                      mutate(doc) {
                        const story = doc.entities
                          .find((e) => e.id === entity.id)!
                          .components.find(
                            (c) => c.type === "studio.storyboard.Sequence",
                          )!.data as unknown as Storyboard;
                        story.tracks.push({
                          id: crypto.randomUUID(),
                          name: "试摆录制",
                          channel: "transform",
                          targetId,
                          contentId: "",
                          muted: false,
                          locked: false,
                          priority: 0,
                          clips: [clip],
                        });
                      },
                    });
                  })
                }
              >
                录制当前变化
              </button>
            </section>
          )}
          {system && (
            <small>
              播放使用绝对时间求值。停止只释放当前故事板的视觉态与相机控制权。
            </small>
          )}
        </>
      )}
    </div>
  );
}
