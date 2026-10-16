import * as THREE from "three";
import {
  getComponent,
  type ChangeSet,
  type SceneDocument,
  type SceneComponent,
} from "@studio/scene-schema";
import type { SceneRuntime } from "../../scene-runtime/src/SceneRuntime";
import type { RuntimeSystem } from "../../scene-runtime/src/systems/RuntimeSystem";
export class AnnotationSystem implements RuntimeSystem {
  readonly id = "studio.annotation";
  readonly labels = new Map<
    string,
    { button: HTMLButtonElement; component: SceneComponent }
  >();
  constructor(readonly runtime: SceneRuntime) {}
  attach(document: SceneDocument): void {
    for (const entity of document.entities) this.sync(entity.id);
  }
  change(change: ChangeSet): void {
    for (const id of change.entityIds) this.sync(id);
    if (change.contentChanged)
      for (const id of this.labels.keys()) this.sync(id);
  }
  sync(id: string): void {
    const entity = this.runtime.index.entities.get(id),
      component =
        entity &&
        (getComponent(entity, "studio.annotation.Label") ??
          getComponent(entity, "Hotspot"));
    let entry = this.labels.get(id);
    if (!component) {
      entry?.button.remove();
      this.labels.delete(id);
      return;
    }
    if (!entry) {
      const button = document.createElement("button");
      button.className = "runtime-hotspot";
      button.type = "button";
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        this.runtime.click(id);
      });
      this.runtime.engine.container.appendChild(button);
      entry = { button, component };
      this.labels.set(id, entry);
    }
    entry.component = component;
    entry.button.textContent =
      String(component.data.icon ?? "") +
      " " +
      String(
        component.data.label ||
          this.runtime.document?.contents.find(
            (c) => c.id === component.data.contentId,
          )?.title ||
          entity!.name,
      );
    entry.button.style.fontSize = Number(component.data.size) + "px";
    entry.button.style.setProperty(
      "--hotspot-color",
      String(component.data.color),
    );
  }
  mode(): void {
    this.render();
  }
  render(): void {
    const { runtime } = this;
    const occupied = new Map<
      string,
      { button: HTMLButtonElement; count: number }
    >();
    const camera = runtime.engine.camera;
    const width = runtime.engine.container.clientWidth,
      height = runtime.engine.container.clientHeight;
    for (const [id, entry] of this.labels) {
      const { component, button } = entry;
      const d = component.data;
      let frameId = String(d.entityId || id);
      let world: THREE.Vector3 | undefined;
      if (d.anchorKind === "world")
        world = new THREE.Vector3().fromArray(d.position as number[]);
      else if (d.anchorKind === "surface") {
        const entity = runtime.index.entities.get(frameId);
        const binding = entity && getComponent(entity, "ModelNode");
        if (
          !binding ||
          String(binding.data.sourceElementId ?? "") !==
            String(d.sourceElementId) ||
          String(d.meshRevision) !== String(binding.data.meshRevision ?? "")
        ) {
          button.dataset.anchorState = "unresolved";
          button.hidden = true;
          continue;
        }
        const root = runtime.getObject(frameId);
        let mesh: THREE.Mesh | undefined;
        root?.traverse((n) => {
          if (!mesh && n instanceof THREE.Mesh) mesh = n;
        });
        const positions = mesh?.geometry.getAttribute("position"),
          indices = mesh?.geometry.index;
        const triangle = Number(d.triangleIndex) * 3;
        const bary = d.barycentric as number[];
        if (
          !mesh ||
          !positions ||
          triangle + 2 >= (indices?.count ?? positions.count)
        ) {
          button.dataset.anchorState = "unresolved";
          button.hidden = true;
          continue;
        }
        world = new THREE.Vector3();
        for (let i = 0; i < 3; i++)
          world.addScaledVector(
            new THREE.Vector3().fromBufferAttribute(
              positions,
              indices ? indices.getX(triangle + i) : triangle + i,
            ),
            bary[i],
          );
        mesh.updateWorldMatrix(true, false);
        world.applyMatrix4(mesh.matrixWorld);
      } else if (d.anchorKind === "path-station") {
        frameId = String(d.routeId);
        const entity = runtime.index.entities.get(frameId),
          segment = entity && getComponent(entity, "studio.piping.Segment");
        if (segment)
          world = new THREE.Vector3()
            .fromArray(segment.data.start as number[])
            .lerp(
              new THREE.Vector3().fromArray(segment.data.end as number[]),
              Number(d.station),
            )
            .applyMatrix4(runtime.getEntityFrame(frameId));
      } else
        world = new THREE.Vector3()
          .fromArray((d.position ?? d.offset ?? [0, 0, 0]) as number[])
          .applyMatrix4(runtime.getEntityFrame(frameId));
      const object = runtime.getObject(frameId);
      if (!world || !object) {
        button.hidden = true;
        button.dataset.anchorState = "unresolved";
        continue;
      }
      button.dataset.anchorState = "resolved";
      const distance = world.distanceTo(camera.position),
        projected = world.clone().project(camera);
      const x = (projected.x * 0.5 + 0.5) * width,
        y = (-projected.y * 0.5 + 0.5) * height;
      let hidden =
        !runtime.visible(object) ||
        projected.z < -1 ||
        projected.z > 1 ||
        Math.abs(projected.x) > 1 ||
        Math.abs(projected.y) > 1 ||
        distance > Number(d.maxDistance ?? Infinity);
      if (!hidden && d.occlusion) {
        const direction = world.clone().sub(camera.position);
        const ray = new THREE.Raycaster(
          camera.position,
          direction.normalize(),
          0,
          Math.max(0, distance - 5),
        );
        hidden = runtime.spatial.pick(ray).length > 0;
      }
      const cell = Math.floor(x / 100) + ":" + Math.floor(y / 35);
      const cluster = occupied.get(cell);
      if (!hidden && component.type !== "Hotspot" && cluster) {
        hidden = true;
        button.dataset.clustered = "true";
        cluster.count++;
        cluster.button.textContent =
          String(cluster.button.dataset.label) + " +" + (cluster.count - 1);
        cluster.button.setAttribute(
          "aria-label",
          String(cluster.button.dataset.label) +
            "（共 " +
            cluster.count +
            " 个标签）",
        );
      } else if (!hidden) {
        button.dataset.label = String(
          component.data.label || button.textContent?.split(" +")[0] || "",
        );
        button.textContent = button.dataset.label;
        button.removeAttribute("aria-label");
        occupied.set(cell, { button, count: 1 });
        delete button.dataset.clustered;
      }
      const offset = d.anchorKind
        ? ((d.offset as number[]) ?? [0, 0, 0])
        : [0, 0, 0];
      button.hidden = hidden;
      if (!hidden) {
        button.style.left = x + offset[0] + "px";
        button.style.top = y + offset[1] + "px";
        button.style.setProperty("--leader-x", -offset[0] + "px");
        button.style.setProperty("--leader-y", -offset[1] + "px");
      }
    }
  }
  detach(): void {
    for (const entry of this.labels.values()) entry.button.remove();
    this.labels.clear();
  }
}

export default AnnotationSystem;
