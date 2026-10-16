import * as THREE from "three";
import {
  getComponent,
  type Entity,
  type SceneComponent,
  type JsonValue,
} from "@studio/scene-schema";
import type { SceneRuntime, Instance } from "../SceneRuntime";
const string = (v: JsonValue | undefined) => String(v ?? "");
const number = (v: JsonValue | undefined) => Number(v ?? 0);
export class PresentationSystem {
  constructor(readonly runtime: SceneRuntime) {}
  stopMedia(instance: Instance): void {
    if (instance.audio) {
      instance.audio.pause();
      instance.audio.removeAttribute("src");
      instance.audio.load();
    }
    instance.media?.disconnect();
    instance.panner?.disconnect();
    instance.audio = undefined;
    instance.media = undefined;
    instance.panner = undefined;
    instance.audioSignature = undefined;
  }
  async material(entity: Entity): Promise<void> {
    const instance = this.runtime.objects.get(entity.id);
    if (!instance || !this.runtime.store || !this.runtime.document) return;
    const component =
      getComponent(entity, "Mesh") ??
      getComponent(entity, "Model") ??
      getComponent(entity, "ModelNode");
    const materialId = string(component?.data.materialId);
    const definition = this.runtime.document.materials.find(
      (m) => m.id === materialId,
    );
    const nonce = ++instance.materialTask;
    const generation = this.runtime.generation;
    const store = this.runtime.store;
    if (!definition) return;
    try {
      const material = await store.material(definition);
      if (
        generation !== this.runtime.generation ||
        this.runtime.objects.get(entity.id) !== instance ||
        nonce !== instance.materialTask
      ) {
        store.disposeUnowned(material);
        return;
      }
      const target = getComponent(entity, "ModelNode")
        ? instance.root
        : instance.visual;
      const meshes: THREE.Mesh[] = [];
      target.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        let cursor: THREE.Object3D | null = node;
        while (cursor && cursor !== instance.root) {
          const nested = this.runtime.entity(
            String(cursor.userData.entityId ?? ""),
          );
          const component =
            nested &&
            (getComponent(nested, "ModelNode") ??
              getComponent(nested, "Model"));
          if (nested && nested.id !== entity.id && component?.data.materialId)
            return;
          cursor = cursor.parent;
        }
        meshes.push(node);
      });
      this.runtime.visual.rebase(() => {
        for (const mesh of meshes) mesh.material = material;
        if (meshes.length === 0) store.disposeUnowned(material);
        this.runtime.graph.scope(
          this.runtime.graph.modelOwner(entity) ?? instance,
        );
      });
      const artwork = getComponent(entity, "Artwork");
      if (artwork) await this.artwork(entity, artwork);
      this.runtime.applyDisplay();
      this.runtime.engine.requestRender();
    } catch (error) {
      if (generation === this.runtime.generation)
        this.runtime.issue(entity.id, error);
    }
  }
  async artwork(entity: Entity, component: SceneComponent): Promise<void> {
    const instance = this.runtime.objects.get(entity.id);
    if (!instance || !this.runtime.store) return;
    const generation = this.runtime.generation;
    const store = this.runtime.store;
    const task = (instance.artworkTask = (instance.artworkTask ?? 0) + 1);
    const content = this.runtime.document?.contents.find(
      (c) => c.id === component.data.contentId,
    );
    if (!content?.imageAssetId) return;
    const texture = await store.texture(content.imageAssetId);
    if (
      generation !== this.runtime.generation ||
      this.runtime.objects.get(entity.id) !== instance ||
      instance.artworkTask !== task ||
      this.runtime.document?.contents.find(
        (c) =>
          c.id ===
          getComponent(this.runtime.entity(entity.id)!, "Artwork")?.data
            .contentId,
      )?.imageAssetId !== content.imageAssetId
    )
      return;
    const target = getComponent(entity, "ModelNode")
      ? instance.root
      : instance.visual;
    target.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const materials = Array.isArray(node.material)
        ? node.material
        : [node.material];
      for (const material of materials)
        if ("map" in material) {
          const ownTexture = texture.clone();
          ownTexture.colorSpace = THREE.SRGBColorSpace;
          ownTexture.flipY = true;
          ownTexture.needsUpdate = true;
          Object.assign(material, { map: ownTexture });
          material.needsUpdate = true;
        }
    });
    this.runtime.graph.scope(this.runtime.graph.modelOwner(entity) ?? instance);
    this.runtime.engine.requestRender();
  }
  async business(entity: Entity, refreshArtwork = true): Promise<void> {
    const instance = this.runtime.objects.get(entity.id);
    if (!instance) return;
    const businessTask = (instance.businessTask =
      (instance.businessTask ?? 0) + 1);
    const artwork = getComponent(entity, "Artwork");
    if (artwork && refreshArtwork)
      try {
        await this.artwork(entity, artwork);
      } catch (error) {
        if (
          this.runtime.objects.get(entity.id) === instance &&
          instance.businessTask === businessTask
        )
          this.runtime.issue(entity.id, error);
      }
    const audio = getComponent(entity, "Audio");
    if (!audio || instance.audioSignature !== JSON.stringify(audio.data)) {
      this.stopMedia(instance);
      if (audio && audio.data.assetId && this.runtime.store) {
        const generation = this.runtime.generation;
        const url = await this.runtime.store.blobUrl(
          string(audio.data.assetId),
        );
        if (
          generation !== this.runtime.generation ||
          this.runtime.objects.get(entity.id) !== instance ||
          instance.businessTask !== businessTask
        )
          return;
        const element = new Audio(url);
        element.preload = "metadata";
        element.volume = number(audio.data.volume);
        element.loop = Boolean(audio.data.loop);
        instance.audio = element;
        instance.audioSignature = JSON.stringify(audio.data);
        const update = () => {
          if (
            this.runtime.objects.get(entity.id) !== instance ||
            instance.audio !== element
          )
            return;
          const previous = this.runtime.state.getSnapshot().media;
          this.runtime.state.patch({
            media: {
              ...previous,
              [entity.id]: {
                status: element.ended
                  ? "ended"
                  : element.paused
                    ? element.currentTime > 0
                      ? "paused"
                      : "stopped"
                    : "playing",
                time: element.currentTime,
                duration: Number.isFinite(element.duration)
                  ? element.duration
                  : 0,
                volume: element.volume,
              },
            },
          });
        };
        for (const event of [
          "play",
          "pause",
          "ended",
          "timeupdate",
          "loadedmetadata",
          "volumechange",
        ])
          element.addEventListener(event, update);
        element.addEventListener("ended", () => {
          void this.runtime.emit("mediaEnd", entity.id, "entity");
        });
        update();
      }
    }
    if (audio?.data.autoplay && this.runtime.mode === "play")
      void this.runtime
        .playAudio(entity.id)
        .catch((error) => this.runtime.issue(entity.id, error));
  }
}
