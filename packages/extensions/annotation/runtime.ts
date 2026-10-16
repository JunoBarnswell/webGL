import { framePoint } from "../../scene-runtime/src/Navigation";
import * as THREE from "three";
import {
  createAction,
  getComponent,
  entityReferences,
  type ChangeSet,
  type SceneDocument,
  type SceneComponent,
  type Vec3,
  type BehaviorAction,
} from "../../scene-schema/src/index";
import type { SceneRuntime } from "../../scene-runtime/src/SceneRuntime";
import type { RuntimeSystem } from "../../scene-runtime/src/systems/RuntimeSystem";
import { resolveAnchor } from "./anchors";
import {
  AnnotationLayoutEngine,
  type LabelGroup,
  type ProjectedLabel,
} from "./layout";
interface Label {
  component: SceneComponent;
  text: string;
  sources: Set<string>;
  button?: HTMLButtonElement;
}
export class AnnotationSystem implements RuntimeSystem {
  readonly id = "studio.annotation";
  readonly labels = new Map<string, Label>();
  readonly unresolved = new Map<string, string>();
  private bySource = new Map<string, Set<string>>();
  private canvas = document.createElement("canvas");
  private context = this.canvas.getContext("2d");
  private layout = new AnnotationLayoutEngine();
  private groups: LabelGroup[] = [];
  private input?: AbortController;
  private clusterPanel?: HTMLDivElement;
  private drag?: {
    pointerId: number;
    id: string;
    startX: number;
    startY: number;
    offset: Vec3;
    next: Vec3;
    moved: boolean;
  };
  private preview = new Map<string, Vec3>();
  private batched = false;
  private accessible?: HTMLDetailsElement;
  private selection = new Set<string>();
  private selectedLabels = new Set<string>();
  private cancelledPointers = new Set<number>();
  constructor(private runtime: SceneRuntime) {
    this.canvas.className = "annotation-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
  }
  attach(document: SceneDocument): void {
    this.batched =
      document.entities.filter(
        (e) =>
          getComponent(e, "studio.annotation.Label") ||
          getComponent(e, "Hotspot"),
      ).length > 500;
    this.runtime.engine.container.appendChild(this.canvas);
    this.input = new AbortController();
    const signal = this.input.signal;
    this.runtime.engine.container.addEventListener(
      "pointerdown",
      (event: PointerEvent) => this.down(event),
      { capture: true, signal },
    );
    this.runtime.engine.container.addEventListener(
      "pointermove",
      (event: PointerEvent) => this.move(event),
      { capture: true, signal },
    );
    this.runtime.engine.container.addEventListener(
      "pointerup",
      (event: PointerEvent) => this.up(event),
      { capture: true, signal },
    );
    this.runtime.engine.container.addEventListener(
      "pointercancel",
      (event: PointerEvent) => {
        this.cancelInteraction();
        this.cancelledPointers.delete(event.pointerId);
      },
      { signal },
    );
    for (const entity of document.entities) this.sync(entity.id);
    this.syncAccessible();
  }
  change(change: ChangeSet): void {
    const dirty = new Set(change.entityIds);
    for (const id of change.entityIds)
      for (const labelId of this.bySource.get(id) ?? []) dirty.add(labelId);
    for (const id of dirty) this.sync(id);
    if (change.contentChanged)
      for (const id of this.labels.keys()) this.sync(id);
    const batched = this.labels.size > 500;
    if (batched !== this.batched) {
      this.batched = batched;
      for (const id of this.labels.keys()) this.sync(id);
    }
    this.syncAccessible();
    this.selectionChanged([...this.selection]);
  }
  private sync(id: string): void {
    const entity = this.runtime.index.entities.get(id),
      component =
        entity &&
        (getComponent(entity, "studio.annotation.Label") ??
          getComponent(entity, "Hotspot"));
    const previous = this.labels.get(id);
    for (const source of previous?.sources ?? []) {
      const ids = this.bySource.get(source);
      ids?.delete(id);
      if (!ids?.size) this.bySource.delete(source);
    }
    if (!component) {
      previous?.button?.remove();
      this.labels.delete(id);
      this.unresolved.delete(id);
      const key = this.id + ":" + id;
      if (this.runtime.getSnapshot().extensions[key]) {
        const extensions = { ...this.runtime.getSnapshot().extensions };
        delete extensions[key];
        this.runtime.state.patch({ extensions });
      }
      return;
    }
    let text = String(
      component.data.label ||
        this.runtime.document?.contents.find(
          (c) => c.id === component.data.contentId,
        )?.title ||
        entity!.name,
    );
    const property = String(component.data.bindProperty ?? ""),
      sources = new Set<string>();
    const targetId = String(component.data.entityId || id);
    sources.add(targetId);
    if (property) {
      const bound = this.boundProperty(
        targetId,
        property,
        sources,
        new Set(),
        0,
      );
      if (bound !== undefined)
        text =
          bound &&
          typeof bound === "object" &&
          !Array.isArray(bound) &&
          "value" in bound
            ? String(bound.value) + (bound.unit ? " " + String(bound.unit) : "")
            : typeof bound === "object"
              ? JSON.stringify(bound)
              : String(bound);
    }
    for (const source of sources) {
      let ids = this.bySource.get(source);
      if (!ids) this.bySource.set(source, (ids = new Set()));
      ids.add(id);
    }
    if (component.data.icon) text = String(component.data.icon) + " " + text;
    if (component.data.style === "measurement") text = "↔ " + text;
    let button = previous?.button;
    if (this.batched) {
      button?.remove();
      button = undefined;
    } else if (!button) {
      button = document.createElement("button");
      button.className = "runtime-hotspot";
      button.type = "button";
      button.dataset.annotationId = id;
      button.addEventListener("click", (event) => {
        if (event.detail === 0) {
          const group = this.groups.find((group) => group.id === id);
          if (group) this.activate(group);
        }
      });
      this.runtime.engine.container.appendChild(button);
    }
    this.labels.set(id, { component, text, button, sources });
  }
  private boundProperty(
    id: string,
    path: string,
    sources: Set<string>,
    visited: Set<string>,
    depth: number,
  ): import("../../scene-schema/src/types").JsonValue | undefined {
    if (visited.has(id) || depth > 3) return;
    visited.add(id);
    sources.add(id);
    const entity = this.runtime.index.entities.get(id);
    if (!entity) return;
    if (path === "name") return entity.name;
    if (path === "id") return entity.id;
    const keys = path.split(".");
    for (const component of entity.components) {
      let value: import("../../scene-schema/src/types").JsonValue | undefined =
        component.data[keys[0]];
      if (
        value === undefined &&
        component.data.properties &&
        typeof component.data.properties === "object" &&
        !Array.isArray(component.data.properties)
      )
        value = component.data.properties[keys[0]];
      for (const key of keys.slice(1))
        value =
          value && typeof value === "object" && !Array.isArray(value)
            ? value[key]
            : undefined;
      if (value !== undefined) return value;
    }
    for (const reference of entityReferences(entity))
      if (reference.kind === "entity") {
        const value = this.boundProperty(
          reference.id,
          path,
          sources,
          visited,
          depth + 1,
        );
        if (value !== undefined) return value;
      }
  }
  private syncAccessible(): void {
    this.accessible?.remove();
    this.accessible = undefined;
    if (!this.batched) return;
    const details = document.createElement("details");
    details.className = "annotation-accessible";
    const summary = document.createElement("summary");
    summary.textContent = "标注列表 · " + this.labels.size;
    details.append(summary);
    const input = document.createElement("input");
    input.type = "search";
    input.setAttribute("aria-label", "查找标注");
    input.placeholder = "搜索标注";
    details.append(input);
    const list = document.createElement("nav");
    details.append(list);
    const update = () => {
      list.replaceChildren();
      const matches = [...this.labels].filter(([, entry]) =>
        entry.text.toLowerCase().includes(input.value.toLowerCase()),
      );
      for (const [id, entry] of matches.slice(0, 50)) {
        const row = document.createElement("div"),
          button = document.createElement("button"),
          focus = document.createElement("button");
        button.textContent = entry.text;
        button.type = "button";
        button.onclick = () =>
          this.activate({
            id,
            ids: [id],
            text: entry.text,
            texts: [entry.text],
            x: 0,
            y: 0,
            anchorX: 0,
            anchorY: 0,
            color: "#66d7b9",
            size: 14,
            cluster: false,
            distance: 0,
          });
        focus.textContent = "定位";
        focus.type = "button";
        focus.onclick = () => {
          const action = createAction("studio.annotation.Focus");
          action.targetId = id;
          void this.runtime
            .dispatch(action)
            .catch((error) => this.runtime.issue(id, error));
        };
        row.append(button, focus);
        list.append(row);
      }
      const hint = document.createElement("p");
      hint.textContent =
        matches.length > 50
          ? "显示前 50 项，请输入名称缩小范围"
          : "共 " + matches.length + " 项";
      list.append(hint);
    };
    input.addEventListener("input", update);
    update();
    this.runtime.engine.container.appendChild(details);
    this.accessible = details;
  }
  selectionChanged(ids: readonly string[]): void {
    this.selection = new Set(ids);
    this.selectedLabels.clear();
    const targets = new Set<string>();
    if (this.runtime.mode === "edit")
      for (const [id, entry] of this.labels) {
        const target = String(entry.component.data.entityId || id);
        if (this.selection.has(id) || this.selection.has(target)) {
          this.selectedLabels.add(id);
          if (this.selection.has(id)) targets.add(target);
        }
      }
    if (targets.size)
      this.runtime.visual.highlight("annotation-selection", targets, "#66d7b9");
    else this.runtime.visual.reset("annotation-selection");
  }
  actions: Record<
    string,
    (action: BehaviorAction, signal: AbortSignal) => Promise<void>
  > = {
    "studio.annotation.Focus": async (action, signal) => {
      const entry = this.labels.get(action.targetId);
      if (!entry) throw Error("标注不存在");
      const anchor = resolveAnchor(
        this.runtime,
        action.targetId,
        entry.component,
      );
      if (!anchor.world) throw Error(anchor.reason ?? "锚点需要修复");
      const task = this.runtime.flyToPose(
        framePoint(this.runtime.engine.camera, anchor.world),
        Number(action.data.duration),
        signal,
      );
      if (action.wait) await task;
      else
        void task.catch((error) => {
          if (!(error instanceof DOMException && error.name === "AbortError"))
            this.runtime.issue(action.targetId, error);
        });
    },
  };
  private activate(group: LabelGroup): void {
    if (group.ids.length > 1) {
      this.showCluster(group);
      return;
    }
    const id = group.ids[0],
      entry = this.labels.get(id);
    if (!entry) return;
    this.runtime.click(id);
    if (
      this.runtime.mode === "play" &&
      entry.component.data.contentId &&
      !this.runtime.document?.behaviors.some(
        (b) =>
          b.enabled &&
          b.sourceKind === "entity" &&
          b.sourceId === id &&
          b.event === "click",
      )
    ) {
      const action = createAction("OpenContent");
      action.targetId = String(entry.component.data.contentId);
      void this.runtime
        .dispatch(action)
        .catch((error) => this.runtime.issue(id, error));
    }
  }
  private showCluster(group: LabelGroup): void {
    this.clusterPanel?.remove();
    const panel = document.createElement("div");
    panel.className = "annotation-cluster-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "聚合标签列表");
    for (const [index, id] of group.ids.entries()) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = group.texts[index];
      button.addEventListener("click", () => {
        this.clusterPanel?.remove();
        this.clusterPanel = undefined;
        this.activate({ ...group, id, ids: [id], texts: [group.texts[index]] });
      });
      panel.append(button);
    }
    const close = document.createElement("button");
    close.textContent = "关闭标签列表";
    close.onclick = () => {
      panel.remove();
      this.clusterPanel = undefined;
    };
    panel.append(close);
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.cancelInteraction();
        this.runtime.engine.renderer.domElement.focus();
      }
    });
    this.runtime.engine.container.appendChild(panel);
    this.clusterPanel = panel;
    (panel.firstElementChild as HTMLButtonElement)?.focus();
  }
  private hit(event: PointerEvent): LabelGroup | undefined {
    const target = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-annotation-id]",
    );
    if (target) {
      const id = target.dataset.annotationId;
      return this.groups.find((group) => group.ids[0] === id);
    }
    if (
      !this.batched ||
      (event.target instanceof HTMLElement &&
        event.target.closest(
          "button,input,select,textarea,summary,[role=dialog]",
        ))
    )
      return;
    const rect = this.runtime.engine.container.getBoundingClientRect(),
      x = event.clientX - rect.left,
      y = event.clientY - rect.top;
    return [...this.groups]
      .reverse()
      .find(
        (group) =>
          Math.abs(x - group.x) <=
            Math.max(
              35,
              Math.min(150, group.text.length * group.size * 0.3 + 20),
            ) && Math.abs(y - group.y) <= group.size + 9,
      );
  }
  private down(event: PointerEvent): void {
    if (event.button !== 0 || this.runtime.isToolActive) return;
    this.cancelledPointers.delete(event.pointerId);
    const group = this.hit(event);
    if (!group) return;
    this.runtime.engine.renderer.domElement.focus();
    event.preventDefault();
    event.stopImmediatePropagation();
    if (
      this.runtime.mode === "edit" &&
      group.ids.length === 1 &&
      this.labels.get(group.id)?.component.type !== "Hotspot"
    ) {
      const offset = (this.labels.get(group.id)!.component.data
        .offset as Vec3) ?? [0, 0, 0];
      this.drag = {
        pointerId: event.pointerId,
        id: group.id,
        startX: event.clientX,
        startY: event.clientY,
        offset: [...offset],
        next: [...offset],
        moved: false,
      };
      this.runtime.engine.container.setPointerCapture(event.pointerId);
    }
  }
  private move(event: PointerEvent): void {
    if (!this.drag) return;
    const dx = event.clientX - this.drag.startX,
      dy = event.clientY - this.drag.startY;
    this.drag.moved = this.drag.moved || Math.hypot(dx, dy) > 4;
    this.drag.next = [
      this.drag.offset[0] + dx,
      this.drag.offset[1] + dy,
      this.drag.offset[2],
    ];
    this.preview.set(this.drag.id, this.drag.next);
    event.stopImmediatePropagation();
    this.runtime.engine.requestRender();
  }
  private up(event: PointerEvent): void {
    if (event.button !== 0 || this.runtime.isToolActive) return;
    if (this.cancelledPointers.delete(event.pointerId)) {
      event.stopImmediatePropagation();
      return;
    }
    const drag = this.drag,
      group = this.hit(event);
    if (drag) {
      this.drag = undefined;
      this.preview.delete(drag.id);
      if (this.runtime.engine.container.hasPointerCapture(event.pointerId))
        this.runtime.engine.container.releasePointerCapture(event.pointerId);
      event.preventDefault();
      event.stopImmediatePropagation();
      if (drag.moved) this.runtime.annotationOffset(drag.id, drag.next);
      else {
        const found = this.groups.find((g) => g.id === drag.id);
        if (found) this.activate(found);
      }
      this.runtime.engine.requestRender();
    } else if (group) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.activate(group);
    }
  }
  interacting(): boolean {
    return Boolean(this.drag);
  }
  cancelInteraction(): boolean {
    if (this.clusterPanel) {
      this.clusterPanel.remove();
      this.clusterPanel = undefined;
      return true;
    }
    if (!this.drag) return false;
    if (this.runtime.engine.container.hasPointerCapture(this.drag.pointerId))
      this.runtime.engine.container.releasePointerCapture(this.drag.pointerId);
    this.cancelledPointers.add(this.drag.pointerId);
    this.preview.delete(this.drag.id);
    this.drag = undefined;
    this.runtime.engine.requestRender();
    return true;
  }
  mode(): void {
    this.cancelInteraction();
    this.selectionChanged([...this.selection]);
    this.render();
  }
  render(): void {
    const { runtime } = this,
      context = this.context;
    if (!context) return;
    const width = Math.max(1, runtime.engine.container.clientWidth),
      height = Math.max(1, runtime.engine.container.clientHeight),
      dpr = Math.min(devicePixelRatio, 2);
    if (
      this.canvas.width !== Math.round(width * dpr) ||
      this.canvas.height !== Math.round(height * dpr)
    ) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this.canvas.style.width = width + "px";
      this.canvas.style.height = height + "px";
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    const labels: ProjectedLabel[] = [];
    this.unresolved.clear();
    for (const [id, entry] of this.labels) {
      const resolution = resolveAnchor(runtime, id, entry.component);
      if (!resolution.world) {
        this.unresolved.set(id, resolution.reason ?? "未解析的锚点");
        continue;
      }
      const object = runtime.getObject(resolution.entityId),
        world = resolution.world,
        d = entry.component.data;
      if (!object || !runtime.visible(object)) continue;
      const distance = world.distanceTo(runtime.engine.camera.position),
        projected = world.clone().project(runtime.engine.camera);
      if (
        projected.z < -1 ||
        projected.z > 1 ||
        Math.abs(projected.x) > 1 ||
        Math.abs(projected.y) > 1 ||
        distance > Number(d.maxDistance ?? Infinity)
      )
        continue;
      if (d.occlusion) {
        const direction = world
          .clone()
          .sub(runtime.engine.camera.position)
          .normalize();
        if (
          runtime.spatial.pick(
            new THREE.Raycaster(
              runtime.engine.camera.position,
              direction,
              0,
              Math.max(0, distance - 5),
            ),
          ).length
        )
          continue;
      }
      const anchorX = (projected.x * 0.5 + 0.5) * width,
        anchorY = (-projected.y * 0.5 + 0.5) * height;
      const offset =
        entry.component.type === "Hotspot"
          ? [0, 0, 0]
          : (this.preview.get(id) ?? (d.offset as Vec3) ?? [0, 0, 0]);
      labels.push({
        id,
        text: entry.text,
        x: anchorX + Number(offset[0]),
        y: anchorY + Number(offset[1]),
        anchorX,
        anchorY,
        color: String(d.color ?? "#56d6bd"),
        size: Number(d.size) || 14,
        cluster: entry.component.type !== "Hotspot" && d.cluster !== false,
        selected: this.selectedLabels.has(id),
        distance,
      });
    }
    this.groups = this.layout.layout(labels);
    const shown = new Set(this.groups.map((group) => group.id));
    for (const [id, entry] of this.labels)
      if (entry.button && entry.button.hidden === shown.has(id))
        entry.button.hidden = !shown.has(id);
    for (const group of this.groups) {
      const text =
        group.text +
        (group.ids.length > 1 ? " +" + (group.ids.length - 1) : "");
      context.strokeStyle = group.color;
      context.lineWidth = group.selected ? 3 : 1;
      if (this.labels.get(group.id)?.component.data.style !== "badge") {
        context.beginPath();
        context.moveTo(group.anchorX, group.anchorY);
        context.lineTo(group.x, group.y);
        context.stroke();
      }
      const button = this.labels.get(group.id)?.button;
      if (button) {
        button.hidden = false;
        button.dataset.selected = String(Boolean(group.selected));
        if (button.textContent !== text) button.textContent = text;
        button.style.left = group.x + "px";
        button.style.top = group.y + "px";
        button.style.fontSize = group.size + "px";
        button.style.setProperty("--hotspot-color", group.color);
        button.setAttribute(
          "aria-label",
          group.ids.length > 1 ? text + "，展开聚合标签" : text,
        );
      } else {
        context.font = group.size + "px sans-serif";
        const boxWidth = Math.min(300, context.measureText(text).width + 18);
        context.fillStyle = "#18262fe8";
        context.fillRect(
          group.x - boxWidth / 2,
          group.y - group.size,
          boxWidth,
          group.size * 2,
        );
        context.strokeRect(
          group.x - boxWidth / 2,
          group.y - group.size,
          boxWidth,
          group.size * 2,
        );
        context.fillStyle = group.color;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(text, group.x, group.y, 280);
      }
    }
    const changed: Record<
      string,
      Record<string, import("../../scene-schema/src/types").JsonValue>
    > = {};
    for (const id of this.labels.keys()) {
      const key = this.id + ":" + id,
        reason = this.unresolved.get(id) ?? "",
        anchorState = reason ? "unresolved" : "resolved";
      const before = runtime.getSnapshot().extensions[key];
      if (before?.anchorState !== anchorState || before?.reason !== reason)
        changed[key] = { anchorState, reason };
    }
    if (Object.keys(changed).length)
      runtime.state.patch({
        extensions: { ...runtime.getSnapshot().extensions, ...changed },
      });
    this.canvas.dataset.visibleLabels = String(this.groups.length);
    this.canvas.dataset.totalLabels = String(this.labels.size);
    this.canvas.dataset.unresolved = String(this.unresolved.size);
  }
  detach(): void {
    this.input?.abort();
    this.input = undefined;
    this.cancelInteraction();
    this.clusterPanel?.remove();
    this.clusterPanel = undefined;
    for (const entry of this.labels.values()) entry.button?.remove();
    this.labels.clear();
    this.bySource.clear();
    this.unresolved.clear();
    this.accessible?.remove();
    this.accessible = undefined;
    this.selection.clear();
    this.selectedLabels.clear();
    this.canvas.remove();
    this.groups = [];
    this.preview.clear();
    this.cancelledPointers.clear();
  }
}
export default AnnotationSystem;
