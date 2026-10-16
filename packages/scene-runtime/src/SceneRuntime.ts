import * as THREE from "three";
import { ShowroomEngine } from "@o2vr/engine";
import {
  assertDocument,
  actionDefinitions,
  createAction,
  getComponent,
  type BehaviorAction,
  type ChangeSet,
  type Entity,
  type JsonValue,
  type SceneDocument,
  type Vec3,
} from "@studio/scene-schema";
import { AssetStore, type AssetSource, type GpuResource } from "./AssetStore";
import { Navigation } from "./Navigation";
import { capturePanorama } from "./PanoramaCapture";
import {
  RuntimeState,
  emptySnapshot,
  type CameraPose,
  type LoadProgress,
} from "./RuntimeState";
import { RuleExecutor, abortError, delay } from "./RuleExecutor";
import { SceneGraphSystem } from "./systems/SceneGraphSystem";
import { PresentationSystem } from "./systems/PresentationSystem";
import { SpatialSystem } from "./systems/SpatialSystem";
import { builtinActions } from "./systems/builtinActions";
import { EntityIndex, type RuntimeSystem } from "./systems/RuntimeSystem";
import { createRuntimeSystems } from "./systems/catalog";
import { TourPlayback } from "./TourPlayback";

export type Instance = {
  id: string;
  modelPromise?: Promise<void>;
  nativeObjects?: Set<THREE.Object3D>;
  root: THREE.Object3D;
  visual: THREE.Group;
  owned: Set<GpuResource>;
  signature: string;
  task: number;
  materialTask: number;
  model?: THREE.Group;
  nativeNodes?: Map<number, THREE.Object3D>;
  clips: THREE.AnimationClip[];
  mixer?: THREE.AnimationMixer;
  audio?: HTMLAudioElement;
  panner?: PannerNode;
  media?: MediaElementAudioSourceNode;
  audioSignature?: string;
  businessTask?: number;
  artworkTask?: number;
};
type Flight = {
  time: number;
  duration: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  start: THREE.Quaternion;
  end: THREE.Quaternion;
  fromFov: number;
  toFov: number;
  resolve: () => void;
  reject: (error: Error) => void;
  cleanup: () => void;
};
export interface RuntimeCallbacks {
  disabledExtensions?: readonly string[];
  onIssue?: (id: string, error: string) => void;
  onSelect?: (id: string) => void;
  onReady?: () => void;
}
export interface LoadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: LoadProgress) => void;
}
const vector = (value: JsonValue | number[] | undefined): THREE.Vector3 =>
  new THREE.Vector3().fromArray((value as number[]) ?? [0, 0, 0]);
const string = (value: JsonValue | undefined): string => String(value ?? "");
const number = (value: JsonValue | undefined): number => Number(value ?? 0);

export class SceneRuntime {
  readonly index = new EntityIndex();
  readonly spatial: SpatialSystem;
  readonly graph: SceneGraphSystem;
  readonly presentation: PresentationSystem;
  readonly systems: RuntimeSystem[];
  readonly systemMetrics = new Map<
    string,
    { calls: number; milliseconds: number }
  >();
  readonly actionHandlers = new Map<
    string,
    (action: BehaviorAction, signal: AbortSignal) => void | Promise<void>
  >();
  changeQueue = Promise.resolve();
  document: SceneDocument | null = null;
  mode: "edit" | "play" = "edit";
  readonly objects = new Map<string, Instance>();
  readonly navigation: Navigation;
  readonly issues = new Map<string, string>();
  displayMode: "solid" | "xray" = "solid";
  store: AssetStore | null = null;
  root = new THREE.Group();
  ambient = new THREE.AmbientLight();
  sun = new THREE.DirectionalLight();
  generation = 0;
  environmentTask = 0;
  cleanup: (() => void)[] = [];
  input = new AbortController();
  entered = new Set<string>();
  state = new RuntimeState();
  readonly getSnapshot = this.state.getSnapshot;
  readonly subscribe = this.state.subscribe;
  rules: RuleExecutor;
  tour: TourPlayback;
  playAbort = new AbortController();
  loadAbort: AbortController | null = null;
  onLoadProgress: LoadOptions["onProgress"];
  editCamera: CameraPose | null = null;
  loading = false;
  disposed = false;
  contentPausedTour = false;
  lastTourPublish = 0;
  flight: Flight | null = null;
  actionScopes = new Map<
    string,
    { controller: AbortController; complete: () => void }
  >();
  audioContext?: AudioContext;
  pending = new Set<Promise<unknown>>();
  pointerStart: [number, number] = [0, 0];

  constructor(
    readonly engine: ShowroomEngine,
    private source: AssetSource,
    private callbacks: RuntimeCallbacks = {},
  ) {
    this.graph = new SceneGraphSystem(this);
    this.presentation = new PresentationSystem(this);
    this.spatial = new SpatialSystem(this);
    this.systems = [
      this.spatial,
      ...createRuntimeSystems(this).filter(
        (system) => !callbacks.disabledExtensions?.includes(system.id),
      ),
    ];
    for (const [type, handler] of Object.entries(builtinActions(this)))
      this.actionHandlers.set(type, handler);
    for (const system of this.systems)
      for (const [type, handler] of Object.entries(system.actions ?? {})) {
        if (this.actionHandlers.has(type))
          throw Error("动作执行器冲突 " + type);
        this.actionHandlers.set(type, handler);
      }
    engine.scene.add(this.root, this.ambient, this.sun);
    this.navigation = new Navigation(
      engine.camera,
      engine.renderer.domElement,
      () => engine.requestRender(),
    );
    this.rules = new RuleExecutor(
      this.state,
      () => this.document,
      (action, signal) => this.performAction(action, signal),
    );
    this.tour = new TourPlayback(
      (id) => this.resolveViewpoint(id),
      (pose) => this.applyCameraPose(pose),
      (tour) => {
        const previous = this.state.getSnapshot().tour;
        const now = performance.now();
        if (
          tour.status !== previous.status ||
          tour.stopId !== previous.stopId ||
          now - this.lastTourPublish >= 80
        ) {
          this.lastTourPublish = now;
          this.state.patch({ tour });
        }
      },
      (id) => {
        void this.emit("viewpointArrive", id, "viewpoint");
      },
      (id) => {
        this.actionScopes.get("tour")?.complete();
        void this.emit("tourEnd", id, "tour");
      },
    );
    this.navigation.onInterrupt = () => {
      this.tour.pause();
      this.cancelFlight();
    };
    this.cleanup.push(
      engine.onUpdate((dt: number) => this.update(dt)),
      engine.onRender(() => {
        for (const system of this.systems)
          if (system.render) {
            const started = performance.now();
            system.render();
            const key = system.id + ".render",
              metric = this.systemMetrics.get(key) ?? {
                calls: 0,
                milliseconds: 0,
              };
            metric.calls++;
            metric.milliseconds += performance.now() - started;
            this.systemMetrics.set(key, metric);
          }
      }),
    );
    const canvas = engine.renderer.domElement;
    canvas.addEventListener(
      "pointerdown",
      (event) => {
        this.pointerStart = [event.clientX, event.clientY];
      },
      { signal: this.input.signal },
    );
    canvas.addEventListener(
      "pointerup",
      (event) => {
        if (event.shiftKey || event.altKey || event.button !== 0) return;
        if (
          Math.hypot(
            event.clientX - this.pointerStart[0],
            event.clientY - this.pointerStart[1],
          ) > 4
        )
          return;
        const rect = canvas.getBoundingClientRect();
        const ray = new THREE.Raycaster();
        ray.setFromCamera(
          new THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            (-(event.clientY - rect.top) / rect.height) * 2 + 1,
          ),
          engine.camera,
        );
        const hit = this.spatial.pick(ray)[0];
        if (!hit) return;
        let object: THREE.Object3D | null = hit.object;
        while (object && !object.userData.entityId) object = object.parent;
        if (object) this.click(String(object.userData.entityId));
      },
      { signal: this.input.signal },
    );
    canvas.addEventListener(
      "keydown",
      (event) => {
        if (this.mode === "play") void this.emit("key", event.code, "key");
      },
      { signal: this.input.signal },
    );
    let hovered = "";
    canvas.addEventListener(
      "pointermove",
      (event) => {
        if (this.mode !== "play" || event.buttons) return;
        const rect = canvas.getBoundingClientRect(),
          ray = new THREE.Raycaster();
        ray.setFromCamera(
          new THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            (-(event.clientY - rect.top) / rect.height) * 2 + 1,
          ),
          engine.camera,
        );
        const hit = this.spatial.pick(ray)[0];
        let object: THREE.Object3D | undefined = hit?.object;
        while (object && !object.userData.entityId)
          object = object.parent ?? undefined;
        const id = String(object?.userData.entityId ?? "");
        if (id && id !== hovered) void this.emit("hover", id, "entity");
        hovered = id;
      },
      { signal: this.input.signal },
    );
  }
  visible(object: THREE.Object3D): boolean {
    let cursor: THREE.Object3D | null = object;
    while (cursor) {
      if (!cursor.visible) return false;
      cursor = cursor.parent;
    }
    return !object.userData.collider;
  }
  issue(id: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.issues.set(id, message);
    this.state.patch({
      errors: { ...this.state.getSnapshot().errors, [id]: message },
    });
    this.callbacks.onIssue?.(id, message);
  }
  track(task: Promise<unknown>): void {
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task)).catch(() => {});
  }
  entity(id: string): Entity | undefined {
    return this.index.entities.get(id);
  }
  getObject(id: string): THREE.Object3D | undefined {
    return this.objects.get(id)?.root;
  }
  pickSurface(x: number, y: number): { entityId: string; point: Vec3 } | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(x, y), this.engine.camera);
    const hit = this.spatial.pick(ray)[0];
    if (!hit) return null;
    let object: THREE.Object3D | null = hit.object;
    while (object && !object.userData.entityId) object = object.parent;
    return {
      entityId: String(object?.userData.entityId ?? ""),
      point: hit.point.toArray(),
    };
  }
  getAssetSource(): AssetSource {
    return this.source;
  }
  sourceUnits(entity: Entity): number {
    const node = getComponent(entity, "ModelNode");
    if (!node) return 1;
    const model = this.entity(string(node.data.modelEntityId));
    return Number(model && getComponent(model, "Model")?.data.unitScale) || 1;
  }
  getEntityFrame(id: string): THREE.Matrix4 {
    const entity = this.entity(id),
      object = this.getObject(id);
    if (!entity || !object) return new THREE.Matrix4();
    object.updateWorldMatrix(true, false);
    const unit = this.sourceUnits(entity);
    return object.matrixWorld
      .clone()
      .multiply(new THREE.Matrix4().makeScale(1 / unit, 1 / unit, 1 / unit));
  }

  async loadDocument(
    document: SceneDocument,
    options: LoadOptions = {},
  ): Promise<void> {
    assertDocument(document);
    this.unloadScene();
    const generation = this.generation,
      controller = new AbortController();
    this.loadAbort = controller;
    this.onLoadProgress = options.onProgress;
    this.loading = true;
    const externalAbort = () => {
      controller.abort();
      if (this.loadAbort === controller) this.cancelLoad();
    };
    options.signal?.addEventListener("abort", externalAbort, { once: true });
    if (options.signal?.aborted) controller.abort();
    const started = performance.now(),
      stages: Record<string, number> = {};
    const progress = (
      phase: LoadProgress["phase"],
      completed: number,
      total: number,
      message: string,
    ) => {
      if (generation !== this.generation || controller.signal.aborted) return;
      const load = { phase, completed, total, message, stages: { ...stages } };
      this.state.patch({ load });
      options.onProgress?.(load);
    };
    this.document = document;
    this.index.reset(document);
    this.store = new AssetStore(
      document,
      this.source,
      this.engine.resourceRegistry,
    );
    this.engine.frameScheduler.stop();
    try {
      progress("structure", 0, document.entities.length, "准备场景结构");
      for (const entity of document.entities) this.graph.allocate(entity);
      this.graph.hierarchy();
      this.settings(true);
      stages.structure = performance.now() - started;
      const buildStarted = performance.now(),
        entities = document.entities.filter(
          (entity) => !getComponent(entity, "ModelNode"),
        );
      let cursor = 0,
        completed = 0;
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          while (cursor < entities.length) {
            if (controller.signal.aborted || generation !== this.generation)
              throw abortError();
            const entity = entities[cursor++];
            await this.graph.build(entity);
            completed++;
            progress(
              "assets",
              completed,
              entities.length,
              "准备资源 " + completed + " / " + entities.length,
            );
            await delay(0, controller.signal);
          }
        }),
      );
      this.graph.bindModelNodes();
      this.graph.hierarchy();
      this.spatial.refresh();
      while (this.pending.size) {
        if (controller.signal.aborted) throw abortError();
        await Promise.allSettled([...this.pending]);
      }
      if (generation !== this.generation || controller.signal.aborted)
        throw abortError();
      for (const system of this.systems) system.attach(document);
      stages.assets = performance.now() - buildStarted;
      const gpuStarted = performance.now();
      progress("gpu", 0, 1, "准备材质与纹理");
      if (!this.issues.size) {
        await this.engine.renderer.compileAsync(
          this.engine.scene,
          this.engine.camera,
        );
        const textures = [
          ...this.engine.resourceRegistry.collect(this.root),
        ].filter(
          (item: unknown) => item instanceof THREE.Texture,
        ) as THREE.Texture[];
        if (this.engine.scene.environment)
          textures.push(this.engine.scene.environment);
        for (let i = 0; i < textures.length; i++) {
          if (controller.signal.aborted) throw abortError();
          this.engine.renderer.initTexture(textures[i]);
          if (i % 2 === 0) {
            progress(
              "gpu",
              i + 1,
              textures.length,
              "准备纹理 " + (i + 1) + " / " + textures.length,
            );
            await delay(0, controller.signal);
          }
        }
      }
      stages.gpu = performance.now() - gpuStarted;
      stages.total = performance.now() - started;
      this.loading = false;
      progress(
        this.issues.size ? "error" : "ready",
        document.entities.length,
        document.entities.length,
        this.issues.size ? "存在资源加载问题" : "场景已就绪",
      );
      this.engine.frameScheduler.start();
      this.engine.requestRender();
      this.callbacks.onReady?.();
    } catch (error) {
      if (generation === this.generation) {
        this.loading = false;
        if (controller.signal.aborted) {
          this.unloadScene();
          const load: LoadProgress = {
            phase: "cancelled",
            completed: 0,
            total: 0,
            message: "加载已取消",
            stages: { ...stages },
          };
          this.state.patch({ load });
          options.onProgress?.(load);
        } else {
          this.issue("load", error);
          progress(
            "error",
            0,
            0,
            error instanceof Error ? error.message : String(error),
          );
        }
        if (!this.disposed) this.engine.frameScheduler.start();
      }
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", externalAbort);
      if (this.loadAbort === controller) {
        this.loadAbort = null;
        this.onLoadProgress = undefined;
      }
    }
  }
  cancelLoad(): void {
    if (!this.loadAbort) return;
    const callback = this.onLoadProgress;
    this.unloadScene();
    this.state.patch({
      load: {
        phase: "cancelled",
        completed: 0,
        total: 0,
        message: "加载已取消",
        stages: {},
      },
    });
    callback?.(this.state.getSnapshot().load);
    if (!this.disposed) this.engine.frameScheduler.start();
  }
  async assetUrl(id: string): Promise<string> {
    if (!this.store) throw new Error("资源存储尚未就绪");
    return this.store.blobUrl(id);
  }
  getCameraPose(): CameraPose {
    const position = this.engine.camera.position.clone(),
      target = this.engine.camera
        .getWorldDirection(new THREE.Vector3())
        .multiplyScalar(1000)
        .add(position);
    return {
      position: position.toArray(),
      target: target.toArray(),
      fov: this.engine.camera.fov,
    };
  }
  applyCameraPose(pose: CameraPose): void {
    this.navigation.eye.fromArray(pose.position);
    this.navigation.lookAt(new THREE.Vector3().fromArray(pose.target));
    this.engine.camera.fov = pose.fov;
    this.engine.camera.updateProjectionMatrix();
    if (this.mode === "play") this.navigation.pose();
    else {
      this.engine.camera.position.fromArray(pose.position);
      this.engine.camera.lookAt(new THREE.Vector3().fromArray(pose.target));
    }
    this.engine.requestRender();
  }
  resolveViewpoint(id: string): CameraPose {
    const view = this.document?.viewpoints.find((v) => v.id === id);
    if (!view) throw new Error("视点不存在：" + id);
    const frame = view.anchorId
      ? this.getEntityFrame(view.anchorId)
      : new THREE.Matrix4();
    return {
      position: new THREE.Vector3()
        .fromArray(view.position)
        .applyMatrix4(frame)
        .toArray(),
      target: new THREE.Vector3()
        .fromArray(view.target)
        .applyMatrix4(frame)
        .toArray(),
      fov: view.fov,
    };
  }
  setMovement(forward: number, right: number): void {
    if (this.mode === "play" && !this.state.getSnapshot().contentId)
      this.navigation.setMovement(forward, right);
  }
  async enter(): Promise<void> {
    if (this.mode !== "play") await this.setMode("play");
    this.state.patch({ entered: true });
  }
  cancelRule(id?: string): void {
    this.rules.cancel(id);
  }
  async tryRule(id: string): Promise<void> {
    const rule = this.document?.behaviors.find((r) => r.id === id);
    if (!rule) throw new Error("交互规则不存在");
    if (this.mode !== "play") throw new Error("请先进入预览");
    await this.rules.run(rule);
  }
  applyChangeSet(change: ChangeSet): Promise<void> {
    const generation = this.generation;
    const task = this.changeQueue
      .catch(() => {})
      .then(async () => {
        if (generation !== this.generation) return;
        await this.synchronize(change);
      });
    this.changeQueue = task;
    return task;
  }
  async synchronize(change: ChangeSet): Promise<void> {
    if (change.sceneReplaced) {
      await this.loadDocument(change.after);
      return;
    }
    if (!this.document) return;
    for (const system of this.systems) system.beforeChange?.(change);
    this.document = change.after;
    this.index.change(change);
    this.store?.update(change.after);
    if (change.contentChanged) {
      const old = new Map(change.before.contents.map((c) => [c.id, c]));
      for (const entity of this.document.entities) {
        const binding =
          getComponent(entity, "Artwork") ?? getComponent(entity, "Hotspot");
        const content =
          binding &&
          this.document.contents.find((c) => c.id === binding.data.contentId);
        if (content && content !== old.get(content.id))
          this.track(
            this.presentation.business(
              entity,
              old.get(content.id)?.imageAssetId !== content.imageAssetId,
            ),
          );
      }
    }
    for (const id of change.entityIds) {
      const entity = this.entity(id);
      const instance = this.objects.get(id);
      const beforeEntity = change.before.entities.find((e) => e.id === id);
      if (!entity && instance) {
        // Child roots are independent owners; detach them before removing their former parent.
        for (const child of this.document.entities.filter(
          (e) => e.parentId === id,
        ))
          this.getObject(child.id)?.removeFromParent();
        this.graph.release(instance);
        instance.root.removeFromParent();
        this.objects.delete(id);
      } else if (entity) {
        const target = instance ?? this.graph.allocate(entity);
        if (
          !getComponent(entity, "ModelNode") &&
          target.signature !== this.graph.signature(entity)
        )
          this.track(this.graph.build(entity));
        else if (
          !beforeEntity ||
          JSON.stringify(beforeEntity.components) !==
            JSON.stringify(entity.components)
        ) {
          this.track(this.presentation.material(entity));
          this.track(this.presentation.business(entity));
        }
      }
    }
    for (const materialId of change.materialIds)
      for (const id of this.index.materialUsers.get(materialId) ?? []) {
        const entity = this.entity(id);
        if (entity && !change.entityIds.includes(id))
          this.track(this.presentation.material(entity));
      }
    const structural = change.entityIds.some((id) => {
      const before = change.before.entities.find((e) => e.id === id),
        after = this.index.entities.get(id);
      return (
        !before ||
        !after ||
        before.parentId !== after.parentId ||
        JSON.stringify(
          before.components.find((c) => c.type === "ModelNode"),
        ) !==
          JSON.stringify(after.components.find((c) => c.type === "ModelNode"))
      );
    });
    if (structural) this.graph.bindModelNodes();
    this.graph.hierarchy(change.entityIds);
    if (
      structural ||
      change.entityIds.some(
        (id) =>
          this.index.entities
            .get(id)
            ?.components.some((c) => ["Ground", "Collider"].includes(c.type)) ||
          change.before.entities
            .find((e) => e.id === id)
            ?.components.some((c) => ["Ground", "Collider"].includes(c.type)),
      )
    )
      this.spatial.refresh();
    while (this.pending.size) await Promise.allSettled([...this.pending]);
    for (const system of this.systems) system.change(change);
    if (change.settingsChanged) this.settings(false);
    this.engine.requestRender();
  }
  settings(reset: boolean): void {
    if (!this.document) return;
    const settings = this.document.settings;
    const environmentTask = ++this.environmentTask;
    this.engine.scene.background = new THREE.Color(settings.background);
    this.engine.renderer.toneMappingExposure = settings.exposure;
    Object.assign(this.engine.camera, {
      fov: settings.fov,
      near: settings.near,
      far: settings.far,
    });
    this.engine.camera.updateProjectionMatrix();
    this.ambient.color.set(settings.ambientColor);
    this.ambient.intensity = settings.ambientIntensity;
    this.sun.color.set(settings.sunColor);
    this.sun.intensity = settings.sunIntensity;
    this.sun.position.fromArray(settings.sunPosition);
    this.engine.frameScheduler.onDemand = settings.onDemand;
    this.engine.adaptiveQuality.enabled = settings.adaptiveQuality;
    this.navigation.settings = settings;
    this.engine.perfMonitor.visible = settings.showStats;
    if (this.engine.perfMonitor.domElement)
      this.engine.perfMonitor.domElement.style.display = settings.showStats
        ? "block"
        : "none";
    if (reset) this.navigation.reset(settings);
    if (settings.environmentAssetIds.length === 6 && this.store) {
      const generation = this.generation;
      const store = this.store;
      this.track(
        Promise.all(settings.environmentAssetIds.map((id) => store.texture(id)))
          .then((textures) => {
            if (
              this.generation !== generation ||
              environmentTask !== this.environmentTask
            )
              return;
            this.engine.scene.environment?.dispose();
            const cube = new THREE.CubeTexture(textures.map((t) => t.image));
            cube.colorSpace = THREE.SRGBColorSpace;
            cube.needsUpdate = true;
            this.engine.scene.environment = cube;
            this.engine.requestRender();
          })
          .catch((error) => {
            if (
              generation === this.generation &&
              environmentTask === this.environmentTask
            )
              this.issue("environment", error);
          }),
      );
    } else {
      this.engine.scene.environment?.dispose();
      this.engine.scene.environment = null;
    }
  }
  async setMode(mode: "edit" | "play"): Promise<void> {
    if (mode === "play") {
      const available = new Set(this.systems.map((system) => system.id));
      for (const requirement of this.document?.requiredExtensions ?? [])
        if (!available.has(requirement.id))
          throw Error("缺失必需扩展 " + requirement.id);
      if (this.loading) throw new Error("场景仍在加载");
      if (this.issues.size)
        throw new Error(
          "存在资源问题，无法预览：" + [...this.issues.values()].join("；"),
        );
      while (this.pending.size) await Promise.allSettled([...this.pending]);
      this.editCamera = this.getCameraPose();
    }
    for (const scope of [...this.actionScopes.values()])
      scope.controller.abort();
    this.actionScopes.clear();
    this.playAbort.abort();
    this.playAbort = new AbortController();
    this.rules.reset();
    this.navigation.pause();
    this.tour.stop();
    this.cancelFlight();
    this.mode = mode;
    this.contentPausedTour = false;
    this.entered.clear();
    this.displayMode = "solid";
    for (const [id, instance] of this.objects) {
      instance.mixer?.stopAllAction();
      if (instance.mixer) instance.mixer.timeScale = 1;
      instance.audio?.pause();
      if (instance.audio) {
        instance.audio.currentTime = 0;
        const entity = this.entity(id),
          audio = entity && getComponent(entity, "Audio");
        if (audio) {
          instance.audio.volume = number(audio.data.volume);
          instance.audio.loop = Boolean(audio.data.loop);
        }
      }
    }
    this.graph.hierarchy();
    this.settings(mode === "play");
    if (this.document)
      this.navigation.viewMode = this.document.settings.viewMode;
    const baseline = emptySnapshot();
    this.state.patch({
      ...baseline,
      load: this.state.getSnapshot().load,
      errors: Object.fromEntries(this.issues),
      mode,
      entered: mode === "play",
      viewMode: this.navigation.viewMode,
      variables: Object.fromEntries(
        this.document?.variables.map((v) => [v.id, v.initial]) ?? [],
      ),
    });
    if (this.document)
      for (const entity of this.document.entities)
        if (getComponent(entity, "Avatar")) {
          const instance = this.objects.get(entity.id);
          if (instance?.model) {
            instance.model.position.set(0, 0, 0);
            instance.model.rotation.set(0, 0, 0);
            instance.model.visible =
              mode === "play" &&
              this.navigation.viewMode === "third" &&
              entity.visible;
            delete instance.root.userData.activeAvatarClip;
          }
        }
    for (const system of this.systems) system.mode(mode);
    this.applyDisplay();
    if (mode === "play" && this.document) {
      this.navigation.enabled = true;
      for (const entity of this.document.entities) {
        const animation = getComponent(entity, "Animation");
        if (animation?.data.autoplay) this.playAnimation(entity.id);
        const audio = getComponent(entity, "Audio");
        if (audio?.data.autoplay)
          void this.playAudio(entity.id).catch((error) =>
            this.issue(entity.id, error),
          );
        const cruise = getComponent(entity, "Cruise");
        if (cruise?.data.autoplay) {
          const action = createAction("StartCruise");
          action.targetId = string(cruise.data.tourId);
          void this.dispatch(action).catch((error) =>
            this.issue(entity.id, error),
          );
        }
      }
      void this.emit("ready", "", "scene");
      this.engine.renderer.domElement.focus();
    } else if (this.editCamera) {
      this.applyCameraPose(this.editCamera);
      this.editCamera = null;
    }
    this.engine.requestRender();
  }
  click(id: string): void {
    if (this.mode === "edit") this.callbacks.onSelect?.(id);
    else void this.emit("click", id, "entity");
  }
  async emit(
    event: string,
    sourceId: string,
    sourceKind = "entity",
  ): Promise<void> {
    try {
      await this.rules.emit(event, sourceId, sourceKind);
    } catch (error) {
      const id = sourceId || "rule",
        message = error instanceof Error ? error.message : String(error);
      this.state.patch({
        errors: { ...this.state.getSnapshot().errors, [id]: message },
      });
    }
  }
  async dispatch(
    action: BehaviorAction,
    signal = this.playAbort.signal,
  ): Promise<void> {
    if (this.mode !== "play")
      throw new Error("业务操作需要先进入预览或 Player");
    await this.rules.sequence([action], "ui", signal);
  }
  actionScope(
    key: string,
    parent: AbortSignal,
    stop: () => void,
  ): { signal: AbortSignal; complete: () => void } {
    this.actionScopes.get(key)?.controller.abort();
    const controller = new AbortController();
    const abort = () => controller.abort();
    const complete = () => {
      parent.removeEventListener("abort", abort);
      controller.signal.removeEventListener("abort", cancel);
      if (this.actionScopes.get(key)?.controller === controller)
        this.actionScopes.delete(key);
    };
    const cancel = () => {
      complete();
      stop();
    };
    parent.addEventListener("abort", abort, { once: true });
    controller.signal.addEventListener("abort", cancel, { once: true });
    this.actionScopes.set(key, { controller, complete });
    if (parent.aborted) controller.abort();
    return { signal: controller.signal, complete };
  }
  async performAction(
    action: BehaviorAction,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) throw abortError();
    const definition = actionDefinitions.find((d) => d.type === action.type);
    if (!definition) throw new Error("未注册动作 " + action.type);
    const doc = this.document;
    if (!doc) throw new Error("场景尚未加载");
    const groups: Record<string, { id: string }[]> = {
      entity: doc.entities,
      content: doc.contents,
      viewpoint: doc.viewpoints,
      tour: doc.tours,
      variable: doc.variables,
      ui: doc.ui.nodes,
    };
    if (
      definition.target &&
      !groups[definition.target]?.some((item) => item.id === action.targetId)
    )
      throw new Error(definition.title + " 的目标不存在：" + action.targetId);
    const entity = this.entity(action.targetId);
    if (
      definition.components.length &&
      !entity?.components.some(
        (c) => c.enabled && definition.components.includes(c.type),
      )
    )
      throw new Error(definition.title + " 目标能力不匹配");
    const handler = this.actionHandlers.get(action.type);
    if (!handler) throw Error("未注册动作执行器 " + action.type);
    await handler(action, signal);
    this.engine.requestRender();
  }
  waitMedia(media: HTMLAudioElement, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        media.removeEventListener("ended", done);
        media.removeEventListener("error", failed);
        signal.removeEventListener("abort", cancel);
      };
      const done = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(new Error("媒体播放失败"));
      };
      const cancel = () => {
        cleanup();
        media.pause();
        reject(abortError());
      };
      media.addEventListener("ended", done, { once: true });
      media.addEventListener("error", failed, { once: true });
      signal.addEventListener("abort", cancel, { once: true });
    });
  }
  waitMixer(mixer: THREE.AnimationMixer, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        mixer.removeEventListener("finished", done);
        signal.removeEventListener("abort", cancel);
      };
      const done = () => {
        cleanup();
        resolve();
      };
      const cancel = () => {
        cleanup();
        mixer.stopAllAction();
        reject(abortError());
      };
      mixer.addEventListener("finished", done);
      signal.addEventListener("abort", cancel, { once: true });
    });
  }
  waitTour(id: string, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        unsubscribe();
        signal.removeEventListener("abort", cancel);
      };
      const cancel = () => {
        cleanup();
        if (this.tour.id === id) this.tour.stop();
        reject(abortError());
      };
      const unsubscribe = this.state.subscribe(() => {
        const current = this.state.getSnapshot().tour;
        if (current.id === id && current.status === "completed") {
          cleanup();
          resolve();
        } else if (current.id === id && current.status === "stopped") {
          cleanup();
          reject(abortError());
        }
      });
      signal.addEventListener("abort", cancel, { once: true });
    });
  }
  cancelFlight(): void {
    if (this.flight) {
      const flight = this.flight;
      this.flight = null;
      flight.cleanup();
      flight.reject(abortError());
    }
  }
  flyToViewpoint(
    id: string,
    duration: number,
    signal: AbortSignal,
  ): Promise<void> {
    const pose = this.resolveViewpoint(id);
    this.tour.pause();
    this.cancelFlight();
    const camera = this.engine.camera.clone();
    camera.position.fromArray(pose.position);
    camera.lookAt(new THREE.Vector3().fromArray(pose.target));
    return new Promise((resolve, reject) => {
      const cancel = () => this.cancelFlight();
      signal.addEventListener("abort", cancel, { once: true });
      this.flight = {
        time: 0,
        duration: Math.max(0.1, duration),
        from: this.navigation.eye.clone(),
        to: new THREE.Vector3().fromArray(pose.position),
        start: this.engine.camera.quaternion.clone(),
        end: camera.quaternion.clone(),
        fromFov: this.engine.camera.fov,
        toFov: pose.fov,
        resolve: () => {
          resolve();
          void this.emit("viewpointArrive", id, "viewpoint");
        },
        reject,
        cleanup: () => signal.removeEventListener("abort", cancel),
      };
      this.engine.requestRender();
    });
  }
  playAnimation(
    id: string,
    clipName?: string,
    loop?: boolean,
    resumeAt = 0,
  ): void {
    const entity = this.entity(id);
    const animation = entity && getComponent(entity, "Animation");
    const modelId = string(animation?.data.modelEntityId) || id;
    const instance = this.objects.get(modelId);
    if (!instance?.mixer) throw new Error("动画模型尚未就绪");
    const name =
      clipName ||
      string(animation?.data.clip) ||
      string(entity && getComponent(entity, "Avatar")?.data.idleClip);
    const clip = instance.clips.find((clip) => clip.name === name);
    if (!clip) throw new Error("动画片段不存在: " + name);
    instance.mixer.timeScale = number(animation?.data.speed) || 1;
    const action = instance.mixer.clipAction(clip);
    action.reset();
    action.time = resumeAt;
    action.setLoop(
      (loop ?? Boolean(animation?.data.loop))
        ? THREE.LoopRepeat
        : THREE.LoopOnce,
      Infinity,
    );
    action.clampWhenFinished = true;
    action.play();
    this.state.patch({
      animations: { ...this.state.getSnapshot().animations, [id]: "playing" },
    });
  }
  async playAudio(id: string): Promise<void> {
    const instance = this.objects.get(id);
    const entity = this.entity(id);
    const component = entity && getComponent(entity, "Audio");
    if (!instance?.audio || !component) throw new Error("音频尚未就绪");
    if (component.data.spatial && !instance.media) {
      this.audioContext ??= new AudioContext();
      instance.media = this.audioContext.createMediaElementSource(
        instance.audio,
      );
      instance.panner = this.audioContext.createPanner();
      instance.panner.refDistance = number(component.data.distance) / 1000;
      instance.media.connect(instance.panner);
      instance.panner.connect(this.audioContext.destination);
    }
    await this.audioContext?.resume();
    try {
      await instance.audio.play();
    } catch {
      throw new Error(
        "浏览器需要用户操作后播放声音，请再次点击对应音频的播放按钮",
      );
    }
  }
  applyDisplay(): void {
    if (!this.document) return;
    for (const entity of this.document.entities) {
      const component = getComponent(entity, "DisplayLayer");
      const instance = this.objects.get(entity.id);
      if (!component || !instance) continue;
      const xray =
        this.displayMode === "xray" && component.data.layer === "shell";
      const target = getComponent(entity, "ModelNode")
        ? instance.root
        : instance.visual;
      target.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(node.material)
          ? node.material
          : [node.material]) {
          if (!material.userData.baseDisplay)
            material.userData.baseDisplay = {
              opacity: material.opacity,
              transparent: material.transparent,
              depthWrite: material.depthWrite,
            };
          const base = material.userData.baseDisplay as {
            opacity: number;
            transparent: boolean;
            depthWrite: boolean;
          };
          material.opacity = xray
            ? number(component.data.xrayOpacity)
            : base.opacity;
          material.transparent = xray || base.transparent;
          material.depthWrite = xray ? false : base.depthWrite;
          material.needsUpdate = true;
        }
      });
    }
  }
  update(dt: number): boolean {
    let active = false;
    for (const system of this.systems) {
      if (!system.update) continue;
      const start = performance.now();
      active = system.update(dt) || active;
      const metric = this.systemMetrics.get(system.id) ?? {
        calls: 0,
        milliseconds: 0,
      };
      metric.calls++;
      metric.milliseconds += performance.now() - start;
      this.systemMetrics.set(system.id, metric);
    }
    if (active) this.spatial.invalidate();
    if (this.mode !== "play" || !this.document) return active;
    if (this.flight) {
      const flight = this.flight;
      flight.time = Math.min(flight.duration, flight.time + dt);
      const t = flight.time / flight.duration;
      const smooth = t * t * (3 - 2 * t);
      this.navigation.eye.lerpVectors(flight.from, flight.to, smooth);
      const quaternion = flight.start.clone().slerp(flight.end, smooth);
      const euler = new THREE.Euler().setFromQuaternion(quaternion, "YXZ");
      this.navigation.yaw = euler.y;
      this.navigation.pitch = euler.x;
      this.navigation.pose();
      this.engine.camera.fov = THREE.MathUtils.lerp(
        flight.fromFov,
        flight.toFov,
        smooth,
      );
      this.engine.camera.updateProjectionMatrix();
      if (t === 1) {
        this.flight = null;
        flight.cleanup();
        flight.resolve();
      }
      active = true;
    } else if (this.tour.state.status === "playing")
      active = this.tour.update(dt);
    else if (!this.state.getSnapshot().contentId)
      active = this.navigation.update(dt);
    for (const id of new Set(
      ["Model", "Avatar", "Trigger", "Audio"].flatMap((type) =>
        this.index.query(type),
      ),
    )) {
      const entity = this.index.entities.get(id)!;
      const instance = this.objects.get(entity.id);
      if (!instance) continue;
      const avatar = getComponent(entity, "Avatar");
      if (instance.mixer && (!avatar || this.navigation.viewMode === "third")) {
        instance.mixer.update(dt);
        if (
          instance.mixer.timeScale !== 0 &&
          this.visible(instance.root) &&
          instance.clips.some((clip) =>
            instance.mixer!.existingAction(clip)?.isRunning(),
          )
        ) {
          active = true;
          this.spatial.invalidate();
        }
      }
      if (avatar) {
        if (
          this.navigation.viewMode === "third" &&
          !instance.model &&
          !instance.modelPromise
        )
          this.track(this.graph.ensureAvatar(entity, instance));
        if (instance.model)
          instance.model.visible =
            this.navigation.viewMode === "third" && entity.visible;
        const position = this.navigation.eye.clone();
        position.y -= this.document.settings.eyeHeight;
        instance.root.worldToLocal(position);
        if (instance.model) {
          this.spatial.invalidate();
          instance.model.position.copy(position);
          instance.model.rotation.set(0, this.navigation.yaw, 0);
        }
        const clipName = string(
          this.navigation.speed
            ? this.navigation.sprint
              ? avatar.data.runClip
              : avatar.data.walkClip
            : avatar.data.idleClip,
        );
        if (
          instance.mixer &&
          !this.actionScopes.has("animation:" + entity.id) &&
          instance.root.userData.activeAvatarClip !== clipName
        ) {
          instance.mixer.stopAllAction();
          const clip = instance.clips.find(
            (c) => c.name.toLowerCase() === clipName.toLowerCase(),
          );
          if (clip) {
            const action = instance.mixer.clipAction(clip);
            action.reset();
            action.setLoop(THREE.LoopRepeat, Infinity);
            action.clampWhenFinished = false;
            action.play();
          }
          instance.root.userData.activeAvatarClip = clipName;
        }
      }
      const trigger = getComponent(entity, "Trigger");
      if (trigger) {
        const local = this.navigation.eye
          .clone()
          .add(
            new THREE.Vector3(0, -this.document.settings.eyeHeight * 0.5, 0),
          );
        local.applyMatrix4(this.getEntityFrame(entity.id).invert());
        local.sub(vector(trigger.data.offset));
        const half = vector(trigger.data.size).multiplyScalar(0.5);
        const inside =
          Math.abs(local.x) <= half.x &&
          Math.abs(local.y) <= half.y &&
          Math.abs(local.z) <= half.z;
        if (inside !== this.entered.has(entity.id)) {
          if (inside) this.entered.add(entity.id);
          else this.entered.delete(entity.id);
          void this.emit(inside ? "enter" : "leave", entity.id);
        }
      }
      if (instance.panner) {
        const position = instance.root
          .getWorldPosition(new THREE.Vector3())
          .divideScalar(1000);
        instance.panner.positionX.value = position.x;
        instance.panner.positionY.value = position.y;
        instance.panner.positionZ.value = position.z;
      }
    }
    if (this.audioContext) {
      const listener = this.audioContext.listener;
      const position = this.engine.camera.position.clone().divideScalar(1000);
      const direction = this.engine.camera.getWorldDirection(
        new THREE.Vector3(),
      );
      listener.positionX.value = position.x;
      listener.positionY.value = position.y;
      listener.positionZ.value = position.z;
      listener.forwardX.value = direction.x;
      listener.forwardY.value = direction.y;
      listener.forwardZ.value = direction.z;
    }
    return active;
  }
  async snapshot(id: string): Promise<Blob> {
    const entity = this.entity(id);
    const panorama = entity && getComponent(entity, "Panorama");
    const instance = this.objects.get(id);
    if (!panorama || !instance) throw new Error("请选择全景观察点");
    const pose = this.resolveViewpoint(string(panorama.data.viewpointId));
    const extras = this.engine.scene.children.filter(
      (child) =>
        !new Set<THREE.Object3D>([this.root, this.ambient, this.sun]).has(
          child,
        ),
    );
    const visibility = extras.map((child) => child.visible);
    extras.forEach((child) => {
      child.visible = false;
    });
    try {
      return capturePanorama(
        this.engine.renderer,
        this.engine.scene,
        new THREE.Vector3().fromArray(pose.position),
        number(panorama.data.width),
        number(panorama.data.height),
      );
    } finally {
      extras.forEach((child, index) => {
        child.visible = visibility[index];
      });
      this.engine.requestRender();
    }
  }
  async captureViewThumbnail(): Promise<Blob> {
    const extras = this.engine.scene.children.filter(
      (child) =>
        ![this.root, this.ambient, this.sun].includes(child as THREE.Group),
    );
    const visibility = extras.map((child) => child.visible);
    extras.forEach((child) => {
      child.visible = false;
    });
    try {
      this.engine.renderer.render(this.engine.scene, this.engine.camera);
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 144;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("缩略图画布不可用");
      context.drawImage(this.engine.renderer.domElement, 0, 0, 256, 144);
      return new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("视点截图失败"))),
          "image/webp",
          0.78,
        ),
      );
    } finally {
      extras.forEach((child, index) => {
        child.visible = visibility[index];
      });
      this.engine.requestRender();
    }
  }
  snapToGround(position: Vec3): Vec3 {
    const ray = new THREE.Raycaster(
      new THREE.Vector3()
        .fromArray(position)
        .add(new THREE.Vector3(0, 10000, 0)),
      new THREE.Vector3(0, -1, 0),
      0,
      30000,
    );
    const hit = ray.intersectObjects(this.navigation.grounds, true)[0];
    if (!hit) throw new Error("当前位置未找到地面，请先配置地面组件");
    return [
      position[0],
      hit.point.y + (this.document?.settings.eyeHeight ?? 1720),
      position[2],
    ];
  }
  checkTour(id: string): string[] {
    const tour = this.document?.tours.find((t) => t.id === id);
    if (!tour) throw new Error("巡航不存在");
    if (tour.stops.length < 2) return ["至少记录两个视点"];
    const points = tour.stops.map((s) =>
        new THREE.Vector3().fromArray(
          this.resolveViewpoint(s.viewpointId).position,
        ),
      ),
      curve = new THREE.CatmullRomCurve3(points, tour.loop, "centripetal"),
      segments = tour.loop ? points.length : points.length - 1,
      issues: string[] = [];
    for (let index = 0; index < segments; index++) {
      for (let sample = 0; sample < 16; sample++) {
        const from = curve.getPoint((index + sample / 16) / segments),
          to = curve.getPoint((index + (sample + 1) / 16) / segments),
          delta = to.sub(from),
          distance = delta.length();
        if (
          distance &&
          new THREE.Raycaster(
            from,
            delta.normalize(),
            0,
            distance,
          ).intersectObjects(this.navigation.colliders, true).length
        ) {
          issues.push(
            "第 " +
              (index + 1) +
              " → " +
              (((index + 1) % points.length) + 1) +
              " 个视点之间可能穿过碰撞体",
          );
          break;
        }
      }
    }
    return issues;
  }
  stats(): {
    objects: number;
    resources: number;
    textures: number;
    geometries: number;
    pending: number;
    contexts: number;
    listeners: number;
  } {
    const resources = this.engine.resourceRegistry.getStats();
    return {
      objects: this.objects.size,
      resources: resources.totalTracked,
      textures: this.engine.renderer.info.memory.textures,
      geometries: this.engine.renderer.info.memory.geometries,
      pending: this.pending.size,
      contexts: this.engine.renderer.domElement.isConnected ? 1 : 0,
      listeners: this.cleanup.length + (this.input.signal.aborted ? 0 : 4),
    };
  }
  unloadScene(): void {
    for (const system of this.systems) system.detach();
    this.index.entities.clear();
    this.index.components.clear();
    this.index.materialUsers.clear();
    this.generation++;
    this.mode = "edit";
    this.loadAbort?.abort();
    this.loadAbort = null;
    this.onLoadProgress = undefined;
    this.loading = false;
    for (const scope of [...this.actionScopes.values()])
      scope.controller.abort();
    this.actionScopes.clear();
    this.playAbort.abort();
    this.rules.reset();
    this.navigation.pause();
    this.tour.stop();
    this.cancelFlight();
    for (const instance of this.objects.values()) {
      this.graph.release(instance);
      instance.root.removeFromParent();
    }
    this.objects.clear();
    this.store?.close();
    this.store = null;
    this.document = null;
    this.root.clear();
    this.issues.clear();
    this.entered.clear();
    this.state.reset();
    this.engine.scene.environment?.dispose();
    this.engine.scene.environment = null;
    this.engine.renderer.renderLists.dispose();
    this.engine.requestRender();
  }
  dispose(): void {
    this.disposed = true;
    this.unloadScene();
    this.state.dispose();
    this.input.abort();
    this.navigation.dispose();
    for (const cleanup of this.cleanup) cleanup();
    this.cleanup = [];
    this.root.removeFromParent();
    this.ambient.removeFromParent();
    this.sun.removeFromParent();
    void this.audioContext?.close();
  }
}
