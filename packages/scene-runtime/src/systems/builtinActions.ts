import {
  getComponent,
  type BehaviorAction,
  type JsonValue,
} from "@studio/scene-schema";
import type { SceneRuntime } from "../SceneRuntime";
import { abortError } from "../RuleExecutor";
const string = (v: JsonValue | undefined) => String(v ?? "");
const number = (v: JsonValue | undefined) => Number(v ?? 0);
export function builtinActions(
  runtime: SceneRuntime,
): Record<
  string,
  (action: BehaviorAction, signal: AbortSignal) => Promise<void>
> {
  return {
    Show: async (action, _signal) => {
      const instance = runtime.objects.get(action.targetId);
      instance!.root.visible = true;
      return;
    },
    Hide: async (action, _signal) => {
      const instance = runtime.objects.get(action.targetId);
      instance!.root.visible = false;
      return;
    },
    Toggle: async (action, _signal) => {
      const instance = runtime.objects.get(action.targetId);
      instance!.root.visible = !instance!.root.visible;
      return;
    },
    DisplayMode: async (action, _signal) => {
      runtime.displayMode = action.data.mode === "xray" ? "xray" : "solid";
      runtime.applyDisplay();
      runtime.state.patch({ displayMode: runtime.displayMode });
      return;
    },
    ViewMode: async (action, _signal) => {
      const doc = runtime.document!;
      runtime.navigation.viewMode =
        action.data.mode === "third" ? "third" : "first";
      runtime.state.patch({ viewMode: runtime.navigation.viewMode });
      if (runtime.navigation.viewMode === "third")
        for (const e of doc.entities)
          if (getComponent(e, "Avatar"))
            await runtime.graph.ensureAvatar(e, runtime.objects.get(e.id)!);
      runtime.navigation.pose();
      return;
    },
    PlayAnimation: async (action, signal) => {
      const entity = runtime.entity(action.targetId);
      const instance = runtime.objects.get(action.targetId);
      {
        if (entity && instance && getComponent(entity, "Avatar"))
          await runtime.graph.ensureAvatar(entity, instance);
        const modelId =
          string(
            entity && getComponent(entity, "Animation")?.data.modelEntityId,
          ) || action.targetId;
        const model = runtime.objects.get(modelId);
        if (!model?.mixer) throw new Error("动画模型尚未就绪");
        if (action.wait && action.data.loop)
          throw new Error("循环动画不能等待自然完成");
        const clipName =
          string(action.data.clip) ||
          string(entity && getComponent(entity, "Animation")?.data.clip) ||
          string(entity && getComponent(entity, "Avatar")?.data.idleClip);
        const clip = model.clips.find((c) => c.name === clipName);
        if (!clip) throw new Error("动画片段不存在：" + clipName);
        const resumeAt =
          model.mixer.timeScale === 0 ? model.mixer.clipAction(clip).time : 0;
        const scope = runtime.actionScope(
          "animation:" + modelId,
          signal,
          () => {
            model.mixer!.stopAllAction();
            delete model.root.userData.activeAvatarClip;
          },
        );
        model.mixer.stopAllAction();
        const ended = () => {
          scope.complete();
          delete model.root.userData.activeAvatarClip;
          model.mixer!.removeEventListener("finished", ended);
        };
        scope.signal.addEventListener(
          "abort",
          () => model.mixer!.removeEventListener("finished", ended),
          { once: true },
        );
        model.mixer.addEventListener("finished", ended);
        try {
          runtime.playAnimation(
            action.targetId,
            clipName,
            Boolean(action.data.loop),
            resumeAt,
          );
        } catch (error) {
          scope.complete();
          model.mixer.removeEventListener("finished", ended);
          throw error;
        }
        if (action.wait) await runtime.waitMixer(model.mixer, scope.signal);
        return;
      }
    },
    PauseAnimation: async (action, _signal) => {
      const entity = runtime.entity(action.targetId);
      {
        const modelId =
          string(
            entity && getComponent(entity, "Animation")?.data.modelEntityId,
          ) || action.targetId;
        const model = runtime.objects.get(modelId);
        if (!model?.mixer) throw new Error("动画模型尚未就绪");
        model.mixer.timeScale = 0;
        runtime.state.patch({
          animations: {
            ...runtime.state.getSnapshot().animations,
            [action.targetId]: "paused",
          },
        });
        return;
      }
    },
    PlayAudio: async (action, signal) => {
      const instance = runtime.objects.get(action.targetId);
      {
        if (!instance?.audio) throw new Error("音频尚未就绪");
        const audio = instance.audio;
        if (action.wait && audio.loop)
          throw new Error("循环音频不能等待自然完成");
        const scope = runtime.actionScope(
          "audio:" + action.targetId,
          signal,
          () => audio.pause(),
        );
        const ended = () => {
          scope.complete();
          audio.removeEventListener("ended", ended);
        };
        audio.addEventListener("ended", ended, { once: true });
        scope.signal.addEventListener(
          "abort",
          () => audio.removeEventListener("ended", ended),
          { once: true },
        );
        try {
          await runtime.playAudio(action.targetId);
          if (scope.signal.aborted) {
            audio.pause();
            throw abortError();
          }
          if (action.wait && !audio.ended)
            await runtime.waitMedia(audio, scope.signal);
        } catch (error) {
          scope.complete();
          audio.removeEventListener("ended", ended);
          throw error;
        }
        return;
      }
    },
    StopAudio: async (action, _signal) => {
      const instance = runtime.objects.get(action.targetId);
      if (!instance?.audio) throw new Error("音频尚未就绪");
      runtime.actionScopes.get("audio:" + action.targetId)?.controller.abort();
      instance.audio.pause();
      instance.audio.currentTime = 0;
      return;
    },
    SetVolume: async (action, _signal) => {
      const instance = runtime.objects.get(action.targetId);
      if (!instance?.audio) throw new Error("音频尚未就绪");
      instance.audio.volume = number(action.data.volume);
      return;
    },
    FlyTo: async (action, signal) => {
      {
        const completion = runtime.flyToViewpoint(
          action.targetId,
          number(action.data.duration),
          signal,
        );
        if (action.wait) await completion;
        else
          void completion.catch((error) => {
            if (error instanceof DOMException && error.name === "AbortError")
              return;
            runtime.issue(action.id, error);
          });
        return;
      }
    },
    OpenContent: async (action, _signal) => {
      {
        if (runtime.tour.state.status === "playing") {
          runtime.tour.pause();
          runtime.contentPausedTour = true;
        }
        runtime.navigation.pause();
        runtime.state.patch({ contentId: action.targetId });
        return;
      }
    },
    CloseContent: async (_action, _signal) => {
      runtime.state.patch({ contentId: "" });
      runtime.navigation.enabled = true;
      if (runtime.contentPausedTour && runtime.tour.state.status === "paused") {
        runtime.cameraOwnership.acquire("tour", () => runtime.tour.pause());
        runtime.tour.resume();
      }
      runtime.contentPausedTour = false;
      return;
    },
    StartCruise: async (action, signal) => {
      const doc = runtime.document!;
      {
        const tour = doc.tours.find((t) => t.id === action.targetId)!;
        if (action.wait && tour.loop)
          throw new Error("循环巡航不能等待自然完成");
        runtime.cancelFlight();
        const scope = runtime.actionScope("tour", signal, () =>
          runtime.tour.stop(),
        );
        runtime.cameraOwnership.acquire("tour", () => runtime.tour.pause());
        runtime.tour.start(tour);
        if (action.wait) await runtime.waitTour(tour.id, scope.signal);
        return;
      }
    },
    ReplayCruise: async (action, signal) => {
      const doc = runtime.document!;
      {
        const tour = doc.tours.find((t) => t.id === action.targetId)!;
        if (action.wait && tour.loop)
          throw new Error("循环巡航不能等待自然完成");
        runtime.cancelFlight();
        const scope = runtime.actionScope("tour", signal, () =>
          runtime.tour.stop(),
        );
        runtime.cameraOwnership.acquire("tour", () => runtime.tour.pause());
        runtime.tour.start(tour);
        if (action.wait) await runtime.waitTour(tour.id, scope.signal);
        return;
      }
    },
    PauseCruise: async (action, _signal) => {
      if (runtime.tour.id !== action.targetId)
        throw new Error("该巡航未在播放");
      runtime.tour.pause();
      return;
    },
    ResumeCruise: async (action, _signal) => {
      if (runtime.tour.id !== action.targetId)
        throw new Error("该巡航未在播放");
      {
        runtime.cameraOwnership.acquire("tour", () => runtime.tour.pause());
        runtime.tour.resume();
      }
      return;
    },
    StopCruise: async (action, _signal) => {
      if (runtime.tour.id !== action.targetId)
        throw new Error("该巡航未在播放");
      runtime.actionScopes.get("tour")?.controller.abort();
      runtime.tour.stop();
      runtime.contentPausedTour = false;
      return;
    },
    SeekCruise: async (action, _signal) => {
      const doc = runtime.document!;
      if (runtime.tour.id !== action.targetId)
        runtime.tour.start(doc.tours.find((t) => t.id === action.targetId)!);
      runtime.tour.seek(number(action.data.progress));
      return;
    },
    EnterPanorama: async (action, _signal) => {
      const entity = runtime.entity(action.targetId);
      {
        const component = getComponent(entity!, "Panorama")!;
        runtime.applyCameraPose(
          runtime.resolveViewpoint(string(component.data.viewpointId)),
        );
        return;
      }
    },
    CapturePanorama: async (action, signal) => {
      {
        const blob = await runtime.snapshot(action.targetId);
        if (signal.aborted) throw abortError();
        const url = URL.createObjectURL(blob),
          anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "panorama.png";
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
      }
    },
    SetVariable: async (action, signal) => {
      const doc = runtime.document!;
      {
        const variable = doc.variables.find((v) => v.id === action.targetId)!;
        const value = action.data.value;
        if (typeof value !== variable.type) throw new Error("变量值类型不匹配");
        if (runtime.state.getSnapshot().variables[variable.id] !== value) {
          runtime.state.patch({
            variables: {
              ...runtime.state.getSnapshot().variables,
              [variable.id]: value as string | number | boolean,
            },
          });
          await runtime.rules.emit(
            "variableChange",
            variable.id,
            "variable",
            signal,
          );
        }
        return;
      }
    },
    ToggleUi: async (action, _signal) => {
      const doc = runtime.document!;
      {
        const previous = runtime.state.getSnapshot().uiVisibility;
        const node = doc.ui.nodes.find((n) => n.id === action.targetId)!;
        runtime.state.patch({
          uiVisibility: {
            ...previous,
            [node.id]: !(previous[node.id] ?? !node.style.hidden),
          },
        });
        return;
      }
    },
  };
}
