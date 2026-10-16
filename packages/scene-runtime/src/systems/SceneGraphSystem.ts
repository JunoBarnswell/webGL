import * as THREE from "three";
import {
  getComponent,
  type Entity,
  type SceneComponent,
  type JsonValue,
} from "@studio/scene-schema";
import type { SceneRuntime, Instance } from "../SceneRuntime";
import type { GpuResource } from "../AssetStore";
const string = (v: JsonValue | undefined) => String(v ?? "");
const number = (v: JsonValue | undefined) => Number(v ?? 0);
export class SceneGraphSystem {
  constructor(readonly runtime: SceneRuntime) {}
  allocate(entity: Entity): Instance {
    const root = new THREE.Group();
    const visual = new THREE.Group();
    root.add(visual);
    root.userData.entityId = entity.id;
    const instance: Instance = {
      id: entity.id,
      root,
      visual,
      owned: new Set(),
      signature: "",
      task: 0,
      materialTask: 0,
      clips: [],
    };
    this.runtime.objects.set(entity.id, instance);
    this.runtime.root.add(root);
    return instance;
  }
  scope(instance: Instance): void {
    const next = this.runtime.engine.resourceRegistry.collect(
      instance.visual,
      (node: THREE.Object3D) =>
        !instance.nativeObjects || node.userData.ownerEntityId === instance.id,
    ) as Set<GpuResource>;
    if (instance.nativeObjects)
      for (const node of instance.nativeObjects)
        for (const resource of this.runtime.engine.resourceRegistry.collectObject(
          node,
        ))
          next.add(resource as GpuResource);
    for (const resource of next)
      if (!instance.owned.has(resource))
        this.runtime.engine.resourceRegistry.retain(resource);
    for (const resource of instance.owned)
      if (!next.has(resource))
        this.runtime.engine.resourceRegistry.release(resource);
    instance.owned = next;
  }
  release(instance: Instance): void {
    this.scope(instance);
    instance.task++;
    instance.materialTask++;
    instance.mixer?.stopAllAction();
    if (instance.model) instance.mixer?.uncacheRoot(instance.model);
    this.runtime.presentation.stopMedia(instance);
    for (const resource of instance.owned)
      this.runtime.engine.resourceRegistry.release(resource);
    instance.owned.clear();
  }
  signature(entity: Entity): string {
    return JSON.stringify(
      entity.components
        .filter(
          (c) =>
            c.enabled && ["Mesh", "Model", "Avatar", "Light"].includes(c.type),
        )
        .map((c) =>
          c.type === "Light"
            ? c
            : {
                type: c.type,
                assetId: c.data.assetId,
                unitScale: c.data.unitScale,
                height: c.data.height,
              },
        ),
    );
  }
  alive(
    id: string,
    instance: Instance,
    generation: number,
    task: number,
  ): boolean {
    return (
      this.runtime.generation === generation &&
      this.runtime.objects.get(id) === instance &&
      instance.task === task
    );
  }
  async build(entity: Entity): Promise<void> {
    const instance = this.runtime.objects.get(entity.id)!;
    const store = this.runtime.store!;
    const generation = this.runtime.generation;
    this.release(instance);
    instance.visual.clear();
    instance.modelPromise = undefined;
    instance.model = undefined;
    instance.nativeNodes = undefined;
    instance.nativeObjects = undefined;
    instance.mixer = undefined;
    instance.clips = [];
    instance.signature = this.signature(entity);
    const task = instance.task;
    try {
      const mesh = getComponent(entity, "Mesh");
      const model = getComponent(entity, "Model");
      const avatar = getComponent(entity, "Avatar");
      if (mesh && string(mesh.data.assetId)) {
        const geometry = await store.geometry(string(mesh.data.assetId));
        if (!this.alive(entity.id, instance, generation, task)) return;
        const object = new THREE.Mesh(
          geometry,
          new THREE.MeshPhongMaterial({ color: "#cccccc" }),
        );
        object.userData.ownerEntityId = entity.id;
        instance.visual.add(object);
      }
      const modelComponent = model ?? avatar;
      if (
        modelComponent?.data.assetId &&
        (!avatar || this.runtime.navigation.viewMode === "third")
      )
        await this.attachModel(
          entity,
          instance,
          modelComponent,
          generation,
          task,
        );
      const light = getComponent(entity, "Light");
      if (light) {
        const intensity = number(light.data.intensity);
        const color = string(light.data.color);
        const distance = number(light.data.distance);
        const object =
          light.data.kind === "ambient"
            ? new THREE.AmbientLight(color, intensity)
            : light.data.kind === "point"
              ? new THREE.PointLight(color, intensity, distance)
              : light.data.kind === "spot"
                ? new THREE.SpotLight(
                    color,
                    intensity,
                    distance,
                    THREE.MathUtils.degToRad(number(light.data.angle)),
                  )
                : new THREE.DirectionalLight(color, intensity);
        if (
          object instanceof THREE.DirectionalLight ||
          object instanceof THREE.SpotLight
        ) {
          object.target.position.set(0, 0, -1);
          instance.visual.add(object.target);
        }
        instance.visual.add(object);
      }
      this.scope(instance);
      const current = this.runtime.entity(entity.id);
      if (current) {
        await this.runtime.presentation.material(current);
        await this.runtime.presentation.business(current);
      }
      if (this.alive(entity.id, instance, generation, task)) {
        if (!this.runtime.loading) {
          this.bindModelNodes();
          this.hierarchy();
          this.runtime.spatial.refresh();
        }
        this.runtime.engine.requestRender();
      }
    } catch (error) {
      if (this.alive(entity.id, instance, generation, task))
        this.runtime.issue(entity.id, error);
    }
  }
  async attachModel(
    entity: Entity,
    instance: Instance,
    component: SceneComponent,
    generation: number,
    task: number,
  ): Promise<void> {
    const loaded = await this.runtime.store!.instance(
      string(component.data.assetId),
    );
    if (!this.alive(entity.id, instance, generation, task)) {
      loaded.root.traverse((node) => {
        if (node instanceof THREE.Mesh)
          for (const material of Array.isArray(node.material)
            ? node.material
            : [node.material])
            material.dispose();
      });
      return;
    }
    instance.model = loaded.root;
    instance.clips = loaded.clips;
    instance.nativeObjects = new Set();
    loaded.root.traverse((node) => instance.nativeObjects!.add(node));
    if (component.type === "Model") {
      instance.nativeNodes = new Map();
      loaded.root.traverse((node) => {
        if (typeof node.userData.gltfNodeIndex === "number")
          instance.nativeNodes!.set(node.userData.gltfNodeIndex, node);
      });
    }
    loaded.root.scale.multiplyScalar(number(component.data.unitScale));
    if (component.type === "Avatar") {
      const height = new THREE.Box3()
        .setFromObject(loaded.root)
        .getSize(new THREE.Vector3()).y;
      if (height > 0)
        loaded.root.scale.multiplyScalar(
          number(component.data.height) / height,
        );
      loaded.root.visible = this.runtime.navigation.viewMode === "third";
    }
    instance.visual.add(loaded.root);
    instance.mixer = new THREE.AnimationMixer(loaded.root);
    instance.mixer.addEventListener("finished", () => {
      if (this.runtime.mode !== "play" || !this.runtime.document) return;
      const sources = this.runtime.document.entities
        .filter(
          (e) => getComponent(e, "Animation")?.data.modelEntityId === entity.id,
        )
        .map((e) => e.id);
      for (const id of new Set([entity.id, ...sources])) {
        this.runtime.state.patch({
          animations: {
            ...this.runtime.state.getSnapshot().animations,
            [id]: "stopped",
          },
        });
        void this.runtime.emit("animationEnd", id);
      }
    });
    this.scope(instance);
    this.runtime.engine.requestRender();
  }
  ensureAvatar(entity: Entity, instance: Instance): Promise<void> {
    const component = getComponent(entity, "Avatar");
    if (instance.model || !component) return Promise.resolve();
    if (instance.modelPromise) return instance.modelPromise;
    const generation = this.runtime.generation,
      task = instance.task;
    const promise = this.attachModel(
      entity,
      instance,
      component,
      generation,
      task,
    ).catch((error) => {
      if (this.alive(entity.id, instance, generation, task))
        this.runtime.issue(entity.id, error);
      throw error;
    });
    instance.modelPromise = promise;
    void promise.then(
      () => {
        if (instance.modelPromise === promise)
          instance.modelPromise = undefined;
      },
      () => {
        if (instance.modelPromise === promise)
          instance.modelPromise = undefined;
      },
    );
    return promise;
  }
  modelOwner(entity: Entity): Instance | undefined {
    const node = getComponent(entity, "ModelNode");
    return node
      ? this.runtime.objects.get(string(node.data.modelEntityId))
      : undefined;
  }
  bindModelNodes(): void {
    if (!this.runtime.document) return;
    for (const [ownerId, owner] of this.runtime.objects)
      if (owner.nativeNodes) {
        const present = new Set(
          this.runtime.document.entities.flatMap((e) => {
            const b = getComponent(e, "ModelNode");
            return b &&
              b.data.sourceStatus !== "unresolved" &&
              string(b.data.modelEntityId) === ownerId
              ? [number(b.data.nodeIndex)]
              : [];
          }),
        );
        for (const [index, node] of owner.nativeNodes)
          if (!present.has(index)) node.removeFromParent();
      }
    for (const entity of this.runtime.document.entities) {
      const binding = getComponent(entity, "ModelNode");
      if (!binding) continue;
      if (binding.data.sourceStatus === "unresolved") {
        const instance = this.runtime.objects.get(entity.id)!;
        if (instance.root.userData.nativeBound) {
          this.release(instance);
          instance.root.removeFromParent();
          instance.root = new THREE.Group();
          instance.root.userData.entityId = entity.id;
          instance.visual = new THREE.Group();
          instance.visual.scale.setScalar(1 / this.runtime.sourceUnits(entity));
          instance.root.add(instance.visual);
          this.runtime.track(this.runtime.presentation.business(entity));
        }
        continue;
      }
      const owner = this.runtime.objects.get(
        string(binding.data.modelEntityId),
      );
      const instance = this.runtime.objects.get(entity.id)!;
      const native = owner?.nativeNodes?.get(number(binding.data.nodeIndex));
      if (native && instance.root !== native) {
        instance.root.removeFromParent();
        instance.root = native;
        native.userData.entityId = entity.id;
        native.userData.nativeBound = true;
        instance.visual = new THREE.Group();
        instance.visual.scale.setScalar(1 / this.runtime.sourceUnits(entity));
        native.add(instance.visual);
        this.runtime.track(this.runtime.presentation.material(entity));
        this.runtime.track(
          this.runtime.presentation
            .business(entity)
            .catch((error) => this.runtime.issue(entity.id, error)),
        );
      }
    }
  }
  hierarchy(ids?: readonly string[]): void {
    if (!this.runtime.document) return;
    for (const entity of ids
      ? ids
          .map((id) => this.runtime.index.entities.get(id))
          .filter((e): e is Entity => Boolean(e))
      : this.runtime.document.entities) {
      const instance = this.runtime.objects.get(entity.id);
      if (!instance) continue;
      const node = getComponent(entity, "ModelNode");
      const parent = entity.parentId
        ? this.runtime.objects.get(entity.parentId)
        : undefined;
      let target = parent?.root ?? this.runtime.root;
      let divisor = 1;
      let scaleDivisor = 1;
      if (node) {
        const ownerEntity = this.runtime.entity(
          string(node.data.modelEntityId),
        );
        const unit = ownerEntity && getComponent(ownerEntity, "Model");
        divisor = unit ? number(unit.data.unitScale) : 1;
        if (entity.parentId === ownerEntity?.id)
          target = this.runtime.objects.get(ownerEntity.id)?.model ?? target;
      } else if (entity.parentId) {
        const parentEntity = this.runtime.entity(entity.parentId);
        const parentBinding =
          parentEntity && getComponent(parentEntity, "ModelNode");
        const model =
          parentBinding &&
          this.runtime.entity(string(parentBinding.data.modelEntityId));
        const units = model && getComponent(model, "Model");
        if (units) divisor = scaleDivisor = number(units.data.unitScale);
      }
      if (instance.root !== target && instance.root.parent !== target)
        target.add(instance.root);
      instance.root.name = entity.name;
      instance.root.position
        .fromArray(entity.transform.position)
        .divideScalar(divisor);
      instance.root.quaternion.fromArray(entity.transform.rotation);
      instance.root.scale
        .fromArray(entity.transform.scale)
        .divideScalar(scaleDivisor);
      instance.root.visible = entity.visible;
    }
    if (!ids) this.runtime.root.updateMatrixWorld(true);
    else
      for (const id of ids)
        this.runtime.getObject(id)?.updateWorldMatrix(true, true);
  }
}
