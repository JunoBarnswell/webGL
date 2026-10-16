import { useEffect, useRef, useState } from "react";
import { createAction, type Transform } from "../../scene-schema/src/index";
import type { ExtensionPanelProps } from "../editor-contract";
import { useDomainEntity, captureThumbnail, AssetThumbnail } from "../designer";
import {
  newClip,
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
              >
                <div
                  className="timeline-content"
                  style={{ minWidth: 180 + data.duration * zoom }}
                >
                  <div className="timeline-ruler">
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
                        track.clips.map((clip) => (
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
                                      .filter((c) => c.groupId === clip.groupId)
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
