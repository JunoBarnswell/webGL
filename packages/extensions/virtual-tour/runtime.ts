import * as THREE from "three";
import {
  getComponent,
  type SceneDocument,
  type ChangeSet,
  type BehaviorAction,
} from "../../scene-schema/src/index";
import type { SceneRuntime } from "../../scene-runtime/src/SceneRuntime";
import type { RuntimeSystem } from "../../scene-runtime/src/systems/RuntimeSystem";
import type { ProjectNavigation } from "./navigation";
import { sphericalDirection, type TourHotspot } from "./core";
export default class VirtualTourSystem implements RuntimeSystem {
  readonly id = "studio.virtualTour";
  private sphere: THREE.Mesh | null = null;
  private video: HTMLVideoElement | null = null;
  private resources = new Set<
    THREE.BufferGeometry | THREE.Material | THREE.Texture
  >();
  private generation = 0;
  private signature = "";
  private overlay = document.createElement("div");
  private buttons = new Map<string, HTMLButtonElement>();
  private polygons = new Map<string, SVGPolygonElement>();
  private navCleanup: (() => void) | null = null;
  constructor(private runtime: SceneRuntime) {
    this.overlay.className = "project-hotspots";
  }
  private nav(): ProjectNavigation | undefined {
    return this.runtime.capabilities.get("studio.virtualTour.navigation") as
      | ProjectNavigation
      | undefined;
  }
  attach(doc: SceneDocument): void {
    this.runtime.engine.container.append(this.overlay);
    const nav = this.nav();
    if (nav) this.navCleanup = nav.subscribe(() => this.buildHotspots());
    this.buildHotspots();
    const entity = doc.entities.find((e) =>
        getComponent(e, "studio.virtualTour.Panorama"),
      ),
      component = entity && getComponent(entity, "studio.virtualTour.Panorama");
    this.signature = JSON.stringify(component);
    if (!component || !this.runtime.store) return;
    const serial = ++this.generation,
      store = this.runtime.store;
    this.runtime.track(
      (async () => {
        const geometry = new THREE.SphereGeometry(12000, 64, 32);
        let texture: THREE.Texture;
        if (component.data.video) {
          const video = document.createElement("video");
          video.crossOrigin = "anonymous";
          video.playsInline = true;
          video.loop = true;
          video.src = await store.blobUrl(String(component.data.assetId));
          if (serial !== this.generation) {
            geometry.dispose();
            video.removeAttribute("src");
            return;
          }
          this.video = video;
          texture = new THREE.VideoTexture(video);
          this.resources.add(texture);
          this.runtime.engine.resourceRegistry.retain(texture);
        } else texture = await store.texture(String(component.data.assetId));
        if (serial !== this.generation) {
          geometry.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        const material = new THREE.MeshBasicMaterial({
          map: texture,
          side: THREE.BackSide,
          depthWrite: false,
        });
        const sphere = new THREE.Mesh(geometry, material);
        sphere.rotation.y = Math.PI / 2;
        sphere.userData.runtimeOwned = true;
        sphere.userData.collider = false;
        this.sphere = sphere;
        for (const resource of [geometry, material]) {
          this.resources.add(resource);
          this.runtime.engine.resourceRegistry.retain(resource);
        }
        this.runtime.engine.scene.add(sphere);
        this.runtime.engine.requestRender();
      })().catch((error) => this.runtime.issue(entity!.id, error)),
    );
  }
  private async activate(hotspot: TourHotspot): Promise<void> {
    await this.nav()?.activateHotspot(hotspot.id);
  }
  private buildHotspots(): void {
    this.overlay.replaceChildren();
    this.buttons.clear();
    this.polygons.clear();
    const nav = this.nav(),
      node = nav?.graph.nodes.find((n) => n.id === nav.getSnapshot().nodeId);
    if (!node) return;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("panorama-polygons");
    this.overlay.append(svg);
    for (const h of node.hotspots) {
      if (h.kind === "polygon") {
        const polygon = document.createElementNS(
          svg.namespaceURI,
          "polygon",
        ) as SVGPolygonElement;
        polygon.setAttribute("fill", h.color + "55");
        polygon.setAttribute("stroke", h.color);
        polygon.setAttribute("tabindex", "0");
        polygon.setAttribute("role", "button");
        polygon.setAttribute("aria-label", h.alt || h.name);
        polygon.addEventListener("click", (event) => {
          event.stopPropagation();
          void this.activate(h).catch((error) =>
            this.runtime.issue(h.id, error),
          );
        });
        polygon.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void this.activate(h);
          }
        });
        svg.append(polygon);
        this.polygons.set(h.id, polygon);
      } else {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("aria-label", h.alt || h.name);
        button.textContent = h.text || h.name;
        button.style.borderColor = h.color;
        button.addEventListener("pointerdown", (event) =>
          event.stopPropagation(),
        );
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          void this.activate(h).catch((error) =>
            this.runtime.issue(h.id, error),
          );
        });
        if (h.kind === "image" && h.assetId && this.runtime.store)
          void this.runtime.store.blobUrl(h.assetId).then((url) => {
            if (!button.isConnected) return;
            const image = document.createElement("img");
            image.src = url;
            image.alt = h.alt || h.name;
            button.prepend(image);
          });
        this.overlay.append(button);
        this.buttons.set(h.id, button);
      }
    }
    this.runtime.engine.requestRender();
  }
  render(): void {
    const node = this.nav()?.graph.nodes.find(
      (n) => n.id === this.nav()?.getSnapshot().nodeId,
    );
    if (!node) return;
    const camera = this.runtime.engine.camera,
      width = this.runtime.engine.container.clientWidth,
      height = this.runtime.engine.container.clientHeight,
      center = this.sphere ? new THREE.Vector3() : camera.position.clone();
    const project = (yaw: number, pitch: number) => {
      const world = new THREE.Vector3()
        .fromArray(sphericalDirection(yaw, pitch))
        .multiplyScalar(10000)
        .add(center);
      const projected = world.project(camera);
      return {
        x: (projected.x * 0.5 + 0.5) * width,
        y: (-0.5 * projected.y + 0.5) * height,
        visible: projected.z > -1 && projected.z < 1,
      };
    };
    for (const hotspot of node.hotspots) {
      const button = this.buttons.get(hotspot.id);
      if (button) {
        const p = project(hotspot.yaw, hotspot.pitch);
        button.hidden = !p.visible;
        button.style.transform = `translate(${p.x}px,${p.y}px) translate(-50%,-50%)`;
      }
      const polygon = this.polygons.get(hotspot.id);
      if (polygon) {
        const points = hotspot.points.map((p) => project(p.yaw, p.pitch));
        polygon.style.display =
          points.length >= 3 && points.every((p) => p.visible) ? "" : "none";
        polygon.setAttribute(
          "points",
          points.map((p) => p.x + "," + p.y).join(" "),
        );
      }
    }
  }
  update(): boolean {
    if (!this.sphere) return false;
    this.runtime.navigation.eye.set(0, 0, 0);
    if (this.runtime.mode === "play") this.runtime.navigation.pose();
    return Boolean(this.video && !this.video.paused);
  }
  change(change: ChangeSet): void {
    const entity = change.after.entities.find((e) =>
        getComponent(e, "studio.virtualTour.Panorama"),
      ),
      signature = JSON.stringify(
        entity && getComponent(entity, "studio.virtualTour.Panorama"),
      );
    if (signature !== this.signature) {
      this.detach();
      this.attach(change.after);
    }
  }
  mode(mode: "edit" | "play"): void {
    this.overlay.hidden = mode !== "play";
    if (this.video) {
      if (mode === "play")
        void this.video
          .play()
          .catch(() => this.runtime.issue(this.id, "全景视频需要用户点击播放"));
      else this.video.pause();
    }
  }
  actions = {
    "studio.virtualTour.Navigate": async (action: BehaviorAction) => {
      const navigation = this.nav();
      if (!navigation) throw Error("当前不是项目漫游");
      await navigation.navigate(String(action.data.nodeId));
    },
  };
  detach(): void {
    this.generation++;
    this.navCleanup?.();
    this.navCleanup = null;
    this.overlay.replaceChildren();
    this.overlay.remove();
    this.buttons.clear();
    this.polygons.clear();
    this.sphere?.removeFromParent();
    this.sphere = null;
    this.video?.pause();
    if (this.video) {
      this.video.removeAttribute("src");
      this.video.load();
      this.video = null;
    }
    for (const resource of this.resources)
      this.runtime.engine.resourceRegistry.release(resource);
    this.resources.clear();
    this.signature = "";
  }
}
