import type {
  ExtensionPanel,
  ExtensionEditorCommand,
  ExtensionPanelProps,
} from "../editor-contract";
import { StoryboardPanel } from "./panel";
export const tools = [];
export const panels: ExtensionPanel[] = [
  {
    id: "storyboard",
    title: "多轨故事板",
    workspace: {
      id: "storyboard",
      title: "演示故事板",
      description: "轨道、镜头快照与绝对时间回放",
      icon: "▤",
    },
    Component: StoryboardPanel,
  },
];

function playback(props: ExtensionPanelProps) {
  const runtime = props.runtime;
  if (!runtime) throw Error("视口未就绪");
  const id = String(
    runtime.capabilities.get("studio.storyboard.active") ??
      props.document.entities.find((e) =>
        e.components.some((c) => c.type === "studio.storyboard.Sequence"),
      )?.id ??
      "",
  );
  const system = runtime.systems.find((s) => s.id === "studio.storyboard") as
    | import("./runtime").default
    | undefined;
  if (!system || !id) throw Error("先创建故事板");
  const state = runtime.getSnapshot().extensions["studio.storyboard:" + id];
  return {
    system,
    id,
    time: Number(state?.time ?? 0),
    playing: Boolean(state?.playing),
  };
}
export const commands: ExtensionEditorCommand[] = [
  {
    id: "storyboard.play",
    title: "故事板播放 / 暂停",
    workspace: "storyboard",
    scope: "timeline",
    shortcuts: ["Space"],
    execute: (props) => {
      const p = playback(props);
      if (p.playing) p.system.pause(p.id);
      else p.system.play(p.id, 1, p.time);
    },
  },
  {
    id: "storyboard.reverse",
    title: "故事板倒放",
    workspace: "storyboard",
    scope: "timeline",
    shortcuts: ["J"],
    execute: (props) => {
      const p = playback(props);
      p.system.play(p.id, -1, p.time);
    },
  },
  {
    id: "storyboard.pause",
    title: "故事板暂停",
    workspace: "storyboard",
    scope: "timeline",
    shortcuts: ["K"],
    execute: (props) => {
      const p = playback(props);
      p.system.pause(p.id);
    },
  },
  {
    id: "storyboard.forward",
    title: "故事板正放",
    workspace: "storyboard",
    scope: "timeline",
    shortcuts: ["L"],
    execute: (props) => {
      const p = playback(props);
      p.system.play(p.id, 1, p.time);
    },
  },
  ...([-1, 1] as const).map((direction) => ({
    id: "storyboard.frame." + direction,
    title: direction < 0 ? "上一帧" : "下一帧",
    workspace: "storyboard",
    scope: "timeline" as const,
    shortcuts: [direction < 0 ? "ArrowLeft" : "ArrowRight"],
    execute: (props: ExtensionPanelProps) => {
      const p = playback(props),
        data = props.document.entities
          .find((e) => e.id === p.id)
          ?.components.find(
            (c) => c.type === "studio.storyboard.Sequence",
          )?.data;
      p.system.pause(p.id);
      p.system.seek(p.id, p.time + direction / Number(data?.fps ?? 30));
    },
  })),
];
