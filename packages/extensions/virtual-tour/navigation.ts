import {
  createDocument,
  createComponent,
  createAction,
  declareExtension,
  type SceneDocument,
  type PublishedManifest,
} from "../../scene-schema/src/index";
import type { SceneRuntime } from "../../scene-runtime/src/SceneRuntime";
import { assetBytes } from "../../scene-runtime/src/AssetCache";
import {
  readProjectLocation,
  projectLocationUrl,
  locationPose,
  type ProjectLocation,
} from "./location";
import {
  sphericalDirection,
  directionAngles,
  type ProjectManifest,
  type ProjectGraph,
  type TourNode,
} from "./core";
export interface ProjectNavigationState {
  locale?: string;
  hotspotId?: string;
  nodeId: string;
  status: "idle" | "loading" | "ready" | "error";
  error: string;
  transitionImage: string;
  history: string[];
  routeId: string;
  routeStatus: "stopped" | "playing" | "paused" | "completed";
  routeIndex: number;
}
export class ProjectNavigation {
  private state: ProjectNavigationState = {
    nodeId: "",
    status: "idle",
    error: "",
    transitionImage: "",
    history: [],
    routeId: "",
    routeStatus: "stopped",
    routeIndex: 0,
  };
  private listeners = new Set<() => void>();
  private cancellation = new AbortController();
  private generation = 0;
  private elapsed = 0;
  private routeChanging = false;
  private routeCancellation = new AbortController();
  private pendingStop: number | null = null;
  private cleanup: () => void;
  private audio: HTMLAudioElement | null = null;
  private inputCleanup: () => void;
  private browser: Window | null = null;
  private browserAbort: AbortController | null = null;
  private routeLease = 0;
  private currentLocation(): ProjectLocation {
    const pose = this.runtime.getCameraPose(),
      angles = directionAngles(
        pose.target.map((v, i) => v - pose.position[i]) as [
          number,
          number,
          number,
        ],
      );
    return {
      projectId: this.manifest.projectId,
      versionId: this.manifest.versionId,
      nodeId: this.state.nodeId,
      locale: this.state.locale ?? this.graph.locales?.[0] ?? "zh-CN",
      hotspotId: this.state.hotspotId ?? "",
      ...angles,
      fov: pose.fov,
      position: pose.position,
      target: pose.target,
    };
  }
  shareUrl(): string {
    if (!this.browser || this.state.status !== "ready")
      throw Error("项目尚未进入公开节点");
    return projectLocationUrl(
      new URL(this.browser.location.href),
      this.currentLocation(),
    ).href;
  }
  private writeLocation(mode: "push" | "replace"): void {
    if (!this.browser || this.state.status !== "ready") return;
    this.browser.history[mode === "push" ? "pushState" : "replaceState"](
      { project: this.manifest.projectId, version: this.manifest.versionId },
      "",
      this.shareUrl(),
    );
  }
  async bindBrowserHistory(browser: Window): Promise<void> {
    this.browserAbort?.abort();
    this.browser = browser;
    this.browserAbort = new AbortController();
    const restore = async () => {
      const location = readProjectLocation(
        new URL(browser.location.href),
        this.manifest,
      );
      if (
        this.state.nodeId !== location.nodeId ||
        this.state.status !== "ready"
      )
        await this.navigate(location.nodeId, { fromHistory: true });
      if (this.state.nodeId !== location.nodeId) return;
      this.patch({ locale: location.locale, hotspotId: location.hotspotId });
      this.runtime.navigation.clearInput();
      const lease = this.runtime.cameraOwnership.acquire(
        "project:location",
        "virtualTour",
        () => {},
      );
      if (lease) {
        this.runtime.applyCameraPose(
          locationPose(location, this.runtime.getCameraPose()),
        );
        this.runtime.cameraOwnership.release(lease);
      }
      const hotspot = this.graph.nodes
        .find((n) => n.id === location.nodeId)
        ?.hotspots.find((h) => h.id === location.hotspotId);
      if (hotspot?.contentId)
        this.runtime.state.patch({ contentId: hotspot.contentId });
      this.writeLocation("replace");
    };
    browser.addEventListener(
      "popstate",
      () => {
        void restore().catch((error) => {
          this.patch({ error: String(error) });
        });
      },
      { signal: this.browserAbort.signal },
    );
    await restore();
  }
  async activateHotspot(id: string): Promise<void> {
    const hotspot = this.graph.nodes
      .find((n) => n.id === this.state.nodeId)
      ?.hotspots.find((h) => h.id === id);
    if (!hotspot) throw Error("热点不属于当前节点");
    if (hotspot.toNodeId) {
      await this.navigate(hotspot.toNodeId);
      return;
    }
    this.patch({ hotspotId: id });
    if (hotspot.contentId) {
      const action = createAction("OpenContent");
      action.targetId = hotspot.contentId;
      await this.runtime.dispatch(action);
    }
    this.writeLocation("push");
  }
  async followLink(id: string): Promise<void> {
    const link = this.graph.links.find(
      (l) => l.id === id && l.fromNodeId === this.state.nodeId,
    );
    if (!link) throw Error("连接不属于当前节点");
    await this.navigate(link.toNodeId, { entrance: link.entrance });
  }
  readonly getSnapshot = () => this.state;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  constructor(
    readonly runtime: SceneRuntime,
    readonly manifest: ProjectManifest,
    private loadScene: (
      node: TourNode,
      signal: AbortSignal,
    ) => Promise<SceneDocument>,
  ) {
    runtime.capabilities.set("studio.virtualTour.navigation", this);
    this.cleanup = runtime.engine.onUpdate((dt: number) => this.update(dt));
    this.inputCleanup = runtime.navigation.onInputChanged((active) => {
      if (active && this.state.routeStatus === "playing") this.pauseRoute();
    });
  }
  get graph(): ProjectGraph {
    return this.manifest.document;
  }
  private patch(value: Partial<ProjectNavigationState>): void {
    this.state = { ...this.state, ...value };
    for (const listener of this.listeners) listener();
  }
  private async panorama(
    node: TourNode,
    signal: AbortSignal,
  ): Promise<SceneDocument> {
    const doc = createDocument(node.name);
    doc.assets = this.manifest.assets;
    doc.settings.position = [0, 0, 0];
    doc.settings.target = sphericalDirection(node.heading, node.pitch).map(
      (v) => v * 1000,
    ) as [number, number, number];
    doc.settings.fov = node.fov;
    doc.settings.near = 1;
    doc.settings.far = 30000;
    doc.settings.collision = false;
    const e = {
      id: crypto.randomUUID(),
      name: node.name,
      parentId: null,
      visible: true,
      locked: false,
      transform: {
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0, 1] as [number, number, number, number],
        scale: [1, 1, 1] as [number, number, number],
      },
      components: [createComponent("studio.virtualTour.Panorama")],
      legacyUuid: "",
    };
    Object.assign(e.components[0].data, {
      assetId: node.assetId,
      video: node.kind === "pano-video",
      heading: node.heading,
      pitch: node.pitch,
      fov: node.fov,
    });
    doc.entities.push(e);
    declareExtension(doc, "studio.virtualTour.Panorama");
    const skinId =
      this.graph.skinSceneId ||
      this.graph.nodes.find((n) => n.kind === "scene3d")?.sceneId;
    if (skinId) {
      const skinNode = {
        ...(this.graph.nodes.find((n) => n.sceneId === skinId) ?? {
          ...node,
          kind: "scene3d" as const,
          sceneId: skinId,
        }),
      };
      skinNode.sceneVersionId =
        this.graph.skinSceneVersionId || skinNode.sceneVersionId;
      const source = await this.loadScene(skinNode, signal);
      doc.ui = structuredClone(source.ui);
      doc.contents = structuredClone(source.contents);
      doc.variables = structuredClone(source.variables);
      const audioIds = new Set(
        doc.contents.map((c) => c.audioEntityId).filter(Boolean),
      );
      for (const audio of source.entities.filter((e) => audioIds.has(e.id))) {
        const copy = structuredClone(audio);
        copy.parentId = null;
        copy.components = copy.components.filter((c) => c.type === "Audio");
        doc.entities.push(copy);
      }
      const layout = doc.ui.layouts.find(
        (l) => l.id === this.graph.skinLayoutId,
      );
      if (!layout)
        throw Error("全景皮肤布局不存在：" + this.graph.skinLayoutId);
      doc.ui.layouts = [
        layout,
        ...doc.ui.layouts.filter((l) => l.id !== layout.id),
      ];
      const used = new Set([
        node.assetId,
        ...this.graph.assets.map((a) => a.id),
        ...doc.contents.map((c) => c.imageAssetId),
        ...doc.ui.nodes.map((n) => n.assetId),
        ...doc.entities.flatMap((e) =>
          e.components.map((c) => String(c.data.assetId ?? "")),
        ),
      ]);
      doc.assets = this.manifest.assets.filter((a) => used.has(a.id));
    }
    return doc;
  }
  async navigate(
    nodeId: string,
    options: {
      route?: boolean;
      back?: boolean;
      fromHistory?: boolean;
      entrance?: import("../../scene-runtime/src/RuntimeState").CameraPose;
    } = {},
  ): Promise<void> {
    const node = this.graph.nodes.find((n) => n.id === nodeId);
    if (!node) throw Error("项目节点不存在");
    if (!options.fromHistory) this.writeLocation("replace");
    if (!options.route && this.state.routeStatus === "playing")
      this.pauseRoute();
    const playing = this.runtime.mode === "play";
    const serial = ++this.generation;
    this.cancellation.abort();
    this.cancellation = new AbortController();
    const signal = this.cancellation.signal,
      previous = this.runtime.document,
      pose = previous ? this.runtime.getCameraPose() : null,
      previousId = this.state.nodeId;
    let transitionImage = "";
    try {
      if (previous) {
        this.runtime.engine.renderer.render(
          this.runtime.engine.scene,
          this.runtime.engine.camera,
        );
        transitionImage =
          this.runtime.engine.renderer.domElement.toDataURL("image/png");
      }
    } catch {
      transitionImage = "";
    }
    this.patch({ status: "loading", error: "", transitionImage });
    try {
      const doc =
        node.kind === "scene3d"
          ? await this.loadScene(node, signal)
          : await this.panorama(node, signal);
      for (const asset of this.manifest.assets)
        if (!doc.assets.some((a) => a.id === asset.id)) doc.assets.push(asset);
      if (serial !== this.generation || signal.aborted) return;
      await Promise.all(
        doc.assets.slice(0, 8).map(async (asset) => {
          try {
            await assetBytes(
              this.runtime.getAssetSource(),
              asset,
              asset.entry,
              signal,
            );
          } catch (error) {
            if (signal.aborted) throw error;
          }
        }),
      );
      if (serial !== this.generation || signal.aborted) return;
      await this.runtime.loadDocument(doc, { signal });
      if (serial !== this.generation) return;
      if (playing) await this.runtime.setMode("play");
      const entrance =
        options.entrance ?? (node.kind === "scene3d" ? node.camera : null);
      if (entrance) {
        const lease = this.runtime.cameraOwnership.acquire(
          "project:entrance",
          "virtualTour",
          () => {},
        );
        if (lease) {
          this.runtime.applyCameraPose(entrance);
          this.runtime.cameraOwnership.release(lease);
        }
      }
      this.elapsed = 0;
      this.patch({
        nodeId,
        hotspotId: "",
        status: "ready",
        transitionImage: "",
        history: options.back
          ? this.state.history.slice(0, -1)
          : previousId && previousId !== nodeId
            ? [...this.state.history, previousId].slice(-100)
            : this.state.history,
      });
      this.runtime.engine.requestRender();
      if (!options.fromHistory)
        this.writeLocation(previousId ? "push" : "replace");
      for (const link of this.graph.links.filter(
        (l) => l.fromNodeId === nodeId && l.preload && l.preload !== "none",
      ))
        void this.prefetch(
          link.toNodeId,
          signal,
          link.preload === "media",
        ).catch(() => {});
    } catch (error) {
      if (serial !== this.generation || signal.aborted) return;
      if (previous) {
        await this.runtime.loadDocument(previous);
        if (playing) await this.runtime.setMode("play");
        if (pose) this.runtime.applyCameraPose(pose);
      }
      this.patch({
        status: "error",
        error: String(error),
        transitionImage: "",
        nodeId: previousId,
      });
      throw error;
    }
  }
  async back(): Promise<void> {
    if (this.browser && this.state.history.length) {
      this.browser.history.back();
      return;
    }
    const id = this.state.history.at(-1);
    if (id) await this.navigate(id, { back: true });
  }
  async startRoute(id: string): Promise<void> {
    const route = this.graph.routes.find((r) => r.id === id);
    if (!route?.stops.length) throw Error("路线没有可用站点");
    this.stopRoute();
    this.patch({ routeId: id, routeStatus: "playing", routeIndex: 0 });
    await this.visitRouteStop(0);
  }
  pauseRoute(): void {
    this.runtime.cameraOwnership.release(this.routeLease);
    this.routeLease = 0;
    this.audio?.pause();
    this.patch({ routeStatus: "paused" });
  }
  resumeRoute(): void {
    if (!this.state.routeId) throw Error("尚未选择路线");
    this.routeLease = this.runtime.cameraOwnership.acquire(
      "virtualTour:route",
      "virtualTour",
      () => this.pauseRoute(),
    );
    if (!this.routeLease) throw Error("相机正由更高优先级操作使用");
    this.patch({ routeStatus: "playing" });
    if (this.pendingStop !== null) {
      const index = this.pendingStop;
      this.pendingStop = null;
      void this.visitRouteStop(index).catch((error) =>
        this.patch({ routeStatus: "paused", error: String(error) }),
      );
      return;
    }
    if (this.audio)
      void this.audio
        .play()
        .catch((error) =>
          this.patch({ routeStatus: "paused", error: String(error) }),
        );
    this.runtime.engine.requestRender();
  }
  stopRoute(): void {
    this.runtime.cameraOwnership.release(this.routeLease);
    this.routeLease = 0;
    this.routeCancellation.abort();
    this.routeCancellation = new AbortController();
    this.pendingStop = null;
    this.routeChanging = false;
    this.audio?.pause();
    this.audio = null;
    this.patch({ routeStatus: "stopped", routeIndex: 0 });
    this.elapsed = 0;
  }
  private async visitRouteStop(index: number): Promise<void> {
    const route = this.graph.routes.find((r) => r.id === this.state.routeId),
      stop = route?.stops[index];
    if (!stop) return;
    const controller = this.routeCancellation;
    this.audio?.pause();
    this.audio = null;
    this.routeChanging = true;
    try {
      await this.navigate(stop.nodeId, { route: true });
      if (controller.signal.aborted) return;
      if (this.state.routeStatus === "paused") {
        this.pendingStop = index;
        return;
      }
      this.routeLease = this.runtime.cameraOwnership.acquire(
        "virtualTour:route",
        "virtualTour",
        () => this.pauseRoute(),
      );
      if (!this.routeLease) {
        this.patch({
          routeStatus: "paused",
          error: "相机正由更高优先级操作使用",
        });
        return;
      }
      const node = this.graph.nodes.find((n) => n.id === stop.nodeId);
      if (node?.kind !== "scene3d") {
        const pose = this.runtime.getCameraPose();
        pose.target = sphericalDirection(stop.heading, stop.pitch).map(
          (v, i) => pose.position[i] + v * 1000,
        ) as [number, number, number];
        if (this.runtime.cameraOwnership.isCurrent(this.routeLease))
          this.runtime.applyCameraPose(pose);
      }
      for (const action of stop.actions ?? []) {
        if (controller.signal.aborted) return;
        await this.runtime.dispatch(
          action,
          AbortSignal.any([controller.signal, this.runtime.playAbort.signal]),
        );
      }
      if (stop.audioAssetId) {
        const url = await this.runtime.store!.blobUrl(stop.audioAssetId);
        if (controller.signal.aborted) return;
        this.audio = new Audio(url);
        this.audio.addEventListener(
          "error",
          () =>
            this.patch({ routeStatus: "paused", error: "路线语音无法播放" }),
          { once: true },
        );
        if (this.state.routeStatus === "playing") await this.audio.play();
      }
    } catch (error) {
      if (!controller.signal.aborted && (error as Error).name !== "AbortError")
        throw error;
    } finally {
      if (controller === this.routeCancellation) this.routeChanging = false;
    }
  }
  private update(dt: number): boolean {
    if (
      this.state.routeStatus !== "playing" ||
      this.state.status !== "ready" ||
      this.routeChanging
    )
      return false;
    const route = this.graph.routes.find((r) => r.id === this.state.routeId),
      stop = route?.stops[this.state.routeIndex];
    if (!route || !stop) return false;
    this.elapsed += dt;
    if (stop.waitForMedia && this.audio && !this.audio.ended) {
      if (this.elapsed > 300) {
        this.audio.pause();
        this.patch({ routeStatus: "paused", error: "等待媒体超过 5 分钟" });
        return false;
      }
      return true;
    }
    if (this.elapsed >= stop.hold) {
      const next = this.state.routeIndex + 1;
      if (next >= route.stops.length && !route.loop) {
        this.runtime.cameraOwnership.release(this.routeLease);
        this.routeLease = 0;
        this.patch({ routeStatus: "completed" });
        return false;
      }
      const index = next % route.stops.length;
      this.patch({ routeIndex: index });
      this.routeChanging = true;
      void this.visitRouteStop(index).catch((error) => {
        if ((error as Error).name !== "AbortError")
          this.patch({ error: String(error), routeStatus: "paused" });
      });
    }
    return true;
  }
  async prefetch(
    nodeId: string,
    signal: AbortSignal,
    mediaOnly = false,
  ): Promise<void> {
    const node = this.graph.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const document =
      node.kind === "scene3d"
        ? await this.loadScene(node, signal)
        : await this.panorama(node, signal);
    await Promise.all(
      document.assets
        .filter(
          (a) => !mediaOnly || ["image", "texture", "audio"].includes(a.kind),
        )
        .map((a) =>
          assetBytes(this.runtime.getAssetSource(), a, a.entry, signal),
        ),
    );
  }
  dispose(): void {
    this.runtime.cameraOwnership.release(this.routeLease);
    this.routeLease = 0;
    this.browserAbort?.abort();
    this.browser = null;
    this.routeCancellation.abort();
    this.audio?.pause();
    this.audio = null;
    this.inputCleanup();
    this.generation++;
    this.cancellation.abort();
    this.cleanup();
    this.listeners.clear();
    if (this.runtime.capabilities.get("studio.virtualTour.navigation") === this)
      this.runtime.capabilities.delete("studio.virtualTour.navigation");
  }
}
export async function publishedSceneLoader(
  manifest: ProjectManifest,
  node: TourNode,
  signal: AbortSignal,
): Promise<SceneDocument> {
  const response = await fetch(
    "/api/player/projects/" +
      manifest.projectId +
      "/versions/" +
      manifest.versionId +
      "/scenes/" +
      node.sceneId,
    { signal },
  );
  if (!response.ok) throw Error("目标场景加载失败 HTTP " + response.status);
  return ((await response.json()) as PublishedManifest).document;
}
