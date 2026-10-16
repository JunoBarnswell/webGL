import * as THREE from "three";
import {
  getComponent,
  type SceneDocument,
  type ChangeSet,
  type BehaviorAction,
} from "../../scene-schema/src/index";
import type { SceneRuntime } from "../../scene-runtime/src/SceneRuntime";
import type { RuntimeSystem } from "../../scene-runtime/src/systems/RuntimeSystem";
import type { VisualOverride } from "../../scene-runtime/src/systems/VisualStateSystem";
import { AnnotationLayoutEngine } from "../annotation/layout";
import {
  measure,
  type IndustrialReview,
  type SemanticPage,
  type Section,
  type SavedView,
  type Measurement,
} from "./core";
export function sectionPlanes(sections: Section[]): THREE.Plane[] {
  return sections
    .filter((s) => s.enabled)
    .flatMap((s) => {
      const matrix = new THREE.Matrix4().fromArray(s.matrix);
      if (s.kind === "plane") {
        const p = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0).applyMatrix4(
          matrix,
        );
        if (s.flipped) p.negate();
        return [p];
      }
      return [
        new THREE.Plane(new THREE.Vector3(1, 0, 0), s.size[0] / 2),
        new THREE.Plane(new THREE.Vector3(-1, 0, 0), s.size[0] / 2),
        new THREE.Plane(new THREE.Vector3(0, 1, 0), s.size[1] / 2),
        new THREE.Plane(new THREE.Vector3(0, -1, 0), s.size[1] / 2),
        new THREE.Plane(new THREE.Vector3(0, 0, 1), s.size[2] / 2),
        new THREE.Plane(new THREE.Vector3(0, 0, -1), s.size[2] / 2),
      ].map((p) => p.applyMatrix4(matrix));
    });
}
export default class IndustrialSystem implements RuntimeSystem {
  readonly id = "studio.industrial";
  private reviews = new Map<string, IndustrialReview>();
  private nonce = 0;
  private active = new Set<string>();
  private clips = new Map<
    string,
    { planes: THREE.Plane[]; view?: SavedView }
  >();
  private filterCache = new Map<string, SemanticPage>();
  private marks = new THREE.Group();
  private owned = new Set<THREE.BufferGeometry | THREE.Material>();
  private labels = document.createElement("div");
  private sectionHelpers: THREE.LineSegments[] = [];
  private labelNodes = new Map<string, HTMLSpanElement>();
  private labelPoints: { id: string; point: THREE.Vector3; text: string }[] =
    [];
  private measurementLines = new Map<
    string,
    {
      measurement: Measurement;
      line: THREE.Line;
      label: { id: string; point: THREE.Vector3; text: string };
    }
  >();
  private layout = new AnnotationLayoutEngine();
  constructor(private runtime: SceneRuntime) {
    this.labels.className = "measurement-labels";
  }
  attach(doc: SceneDocument): void {
    for (const e of doc.entities) {
      const c = getComponent(e, "studio.industrial.Review");
      if (c) this.reviews.set(e.id, c.data as unknown as IndustrialReview);
    }
    this.runtime.engine.scene.add(this.marks);
    this.runtime.engine.container.append(this.labels);
    this.drawMeasurements();
  }
  private review(id: string): IndustrialReview {
    const review = this.reviews.get(id);
    if (!review) throw Error("工业审阅定义不存在");
    return review;
  }
  async query(
    id: string,
    parameters: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<SemanticPage> {
    const review = this.review(id),
      source = this.runtime.getAssetSource(),
      cacheKey = review.semanticAssetId + JSON.stringify(parameters);
    if (parameters.idsOnly === "1" && this.filterCache.has(cacheKey))
      return this.filterCache.get(cacheKey)!;
    if (!review.semanticAssetId) throw Error("请选择已索引的属性资产");
    if (!source.recordsUrl) throw Error("当前资源源未提供属性索引查询");
    const response = await fetch(
      source.recordsUrl(
        review.semanticAssetId,
        new URLSearchParams(parameters),
      ),
      { headers: source.headers?.(), signal },
    );
    if (!response.ok) throw Error("属性查询失败 HTTP " + response.status);
    const result = (await response.json()) as SemanticPage;
    if (parameters.idsOnly === "1") {
      this.filterCache.set(cacheKey, result);
      if (this.filterCache.size > 8)
        this.filterCache.delete(this.filterCache.keys().next().value!);
    }
    return result;
  }
  async apply(id: string, view?: SavedView): Promise<void> {
    const review = this.review(id),
      serial = ++this.nonce,
      filters = view?.filters ?? review.filters,
      colors = view?.colors ?? review.colors,
      overrides: VisualOverride[] = [],
      bySource = new Map<string, string[]>();
    for (const entity of this.runtime.document?.entities ?? []) {
      const binding = getComponent(entity, "ModelNode");
      const key = String(binding?.data.sourceElementId ?? entity.id);
      const ids = bySource.get(key) ?? [];
      ids.push(entity.id);
      bySource.set(key, ids);
    }
    if (review.semanticAssetId) {
      const result = await this.query(id, {
        filters: JSON.stringify(filters),
        idsOnly: "1",
      });
      if (serial !== this.nonce) return;
      const revisions = new Set(result.modelRevisions ?? []);
      for (const [source, ids] of bySource)
        bySource.set(
          source,
          ids.filter((id) => {
            const binding = getComponent(this.runtime.entity(id)!, "ModelNode");
            return (
              binding &&
              (!revisions.size ||
                revisions.has(String(binding.data.meshRevision)))
            );
          }),
        );
      if (
        revisions.size &&
        this.runtime.document?.entities.some((e) =>
          getComponent(e, "ModelNode"),
        ) &&
        ![...bySource.values()].some((ids) => ids.length)
      )
        throw Error(
          "属性索引与当前模型修订不匹配，请绑定同一导入作业的模型和语义资产",
        );
      const selected = new Set(
        result.sourceIds.flatMap((source) => bySource.get(source) ?? []),
      );
      for (const ids of bySource.values())
        for (const targetId of ids)
          if (getComponent(this.runtime.entity(targetId)!, "ModelNode"))
            overrides.push({
              targetId,
              channel: "visibility",
              composition: "and",
              value: selected.has(targetId),
            });
      for (const color of [...colors].sort(
        (a, b) => a.priority - b.priority || a.id.localeCompare(b.id),
      )) {
        const extra =
          color.mode === "missing"
            ? [
                {
                  field: color.field,
                  operator: "empty",
                  value: "",
                  join: "and",
                },
              ]
            : color.mode === "category"
              ? [
                  {
                    field: color.field,
                    operator: "eq",
                    value: color.value,
                    join: "and",
                  },
                ]
              : [
                  {
                    field: color.field,
                    operator: "gte",
                    value: String(color.min),
                    join: "and",
                  },
                  {
                    field: color.field,
                    operator: "lte",
                    value: String(color.max),
                    join: "and",
                  },
                ];
        const matching = await this.query(id, {
          filters: JSON.stringify([...filters, ...extra]),
          idsOnly: "1",
          ...(color.mode === "range" ? { valueField: color.field } : {}),
        });
        if (serial !== this.nonce) return;
        for (const sourceId of matching.sourceIds) {
          const value = matching.values?.[sourceId];
          if (color.mode === "range" && (value === null || value === undefined))
            continue;
          const hex =
            color.mode === "range"
              ? "#" +
                new THREE.Color(color.color)
                  .lerp(
                    new THREE.Color(color.colorEnd ?? color.color),
                    THREE.MathUtils.clamp(
                      (value! - color.min) / (color.max - color.min),
                      0,
                      1,
                    ),
                  )
                  .getHexString()
              : color.color;
          for (const targetId of bySource.get(sourceId) ?? [])
            overrides.push({
              targetId,
              channel: "color",
              composition: "replace",
              value: hex,
            });
        }
      }
      this.runtime.state.patch({
        extensions: {
          ...this.runtime.getSnapshot().extensions,
          [this.id + ":" + id]: {
            matched: result.total,
            sourceIds: result.sourceIds,
          },
        },
      });
    }
    const planes = sectionPlanes(view?.sections ?? this.captureSections(id));
    if (planes.length)
      for (const entity of this.runtime.document?.entities ?? [])
        if (
          entity.components.some(
            (c) => c.enabled && ["Model", "Mesh"].includes(c.type),
          )
        )
          overrides.push({
            targetId: entity.id,
            channel: "clipping",
            composition: "replace",
            value: planes,
          });
    for (const targetId of view?.hiddenIds ?? [])
      overrides.push({
        targetId,
        channel: "visibility",
        composition: "and",
        value: false,
      });
    if (serial !== this.nonce) return;
    this.runtime.visual.setScope("industrial:" + id, overrides, 60);
    this.active.add(id);
    this.clips.set(id, { planes, view });
    if (view) {
      const lease = this.runtime.cameraOwnership.acquire(
        "review:" + id,
        () => {},
      );
      this.runtime.applyCameraPose(view.camera);
      this.runtime.cameraOwnership.release(lease);
    }
    this.drawMeasurements();
  }
  reset(id: string): void {
    this.nonce++;
    this.active.delete(id);
    this.clips.delete(id);
    this.runtime.visual.reset("industrial:" + id);
  }
  captureSections(id: string): Section[] {
    return this.review(id).sections.map((ref) => {
      const entity = this.runtime.entity(ref.entityId),
        component = entity && getComponent(entity, "studio.industrial.Section");
      if (!entity || !component) throw Error("剖切体积引用失效");
      const matrix = this.runtime.getEntityFrame(entity.id).toArray();
      return {
        id: entity.id,
        entityId: entity.id,
        enabled: ref.enabled && Boolean(component.data.active),
        kind: String(component.data.kind) as "plane" | "box",
        size: component.data.size as [number, number, number],
        flipped: Boolean(component.data.flipped),
        matrix,
      };
    });
  }
  measurementPoints(measurement: Measurement): THREE.Vector3[] {
    if (measurement.anchorRefs?.length)
      return measurement.anchorRefs.map((a) => {
        const entity = this.runtime.entity(a.entityId),
          binding = entity && getComponent(entity, "ModelNode");
        if (
          !entity ||
          (a.sourceRevision &&
            binding?.data.meshRevision !== a.sourceRevision) ||
          (a.sourceElementId &&
            binding?.data.sourceElementId !== a.sourceElementId)
        )
          throw Error("测量来源已变化，请重新拾取 " + measurement.name);
        return new THREE.Vector3()
          .fromArray(a.position)
          .applyMatrix4(this.runtime.getEntityFrame(a.entityId));
      });
    return measurement.points.map((p) => new THREE.Vector3().fromArray(p));
  }
  private measurementWorldPoints(measurement: Measurement): THREE.Vector3[] {
    if (measurement.kind !== "bounds")
      return this.measurementPoints(measurement);
    const object = this.runtime.getObject(measurement.entityId);
    if (!object) throw Error("测量对象不存在");
    const box = new THREE.Box3().setFromObject(object);
    return [box.min, box.max];
  }
  private releaseMarks(): void {
    for (const resource of this.owned)
      this.runtime.engine.resourceRegistry.release(resource);
    this.owned.clear();
    for (const helper of this.sectionHelpers) helper.removeFromParent();
    this.sectionHelpers = [];
    this.marks.clear();
    this.labels.replaceChildren();
    this.labelNodes.clear();
    this.labelPoints = [];
    this.measurementLines.clear();
  }
  private drawMeasurements(): void {
    this.releaseMarks();
    for (const entity of this.runtime.document?.entities ?? []) {
      const section = getComponent(entity, "studio.industrial.Section"),
        root = this.runtime.getObject(entity.id);
      if (!section || !root) continue;
      const size = section.data.size as [number, number, number],
        geometry = new THREE.EdgesGeometry(
          section.data.kind === "box"
            ? new THREE.BoxGeometry(...size)
            : new THREE.PlaneGeometry(size[1], size[2]).rotateY(Math.PI / 2),
        ),
        material = new THREE.LineBasicMaterial({
          color: 0x72e6c2,
          depthTest: false,
        }),
        helper = new THREE.LineSegments(geometry, material);
      helper.userData.editorHelper = true;
      helper.userData.collider = true;
      helper.visible = this.runtime.mode === "edit";
      root.add(helper);
      for (const resource of [geometry, material]) {
        this.owned.add(resource);
        this.runtime.engine.resourceRegistry.retain(resource);
      }
      this.sectionHelpers.push(helper);
    }
    for (const review of this.reviews.values())
      for (const measurement of review.measurements) {
        try {
          const points = this.measurementWorldPoints(measurement);
          const value = measure(
              measurement.kind,
              points.map((p) => p.toArray()),
              measurement.unit,
            ),
            geometry = new THREE.BufferGeometry().setFromPoints(points),
            material = new THREE.LineBasicMaterial({
              color: "#ffc564",
              depthTest: false,
            });
          const line = new THREE.Line(geometry, material);
          line.userData.runtimeOwned = true;
          this.marks.add(line);
          for (const resource of [geometry, material]) {
            this.owned.add(resource);
            this.runtime.engine.resourceRegistry.retain(resource);
          }
          const label = {
            id: measurement.id,
            point: points.at(-1)!,
            text:
              measurement.name +
              " " +
              value.toFixed(2) +
              (measurement.kind === "angle" ? "°" : measurement.unit) +
              " · 网格测量",
          };
          this.labelPoints.push(label);
          this.measurementLines.set(measurement.id, {
            measurement,
            line,
            label,
          });
        } catch (error) {
          this.runtime.state.patch({
            extensions: {
              ...this.runtime.getSnapshot().extensions,
              [this.id + ":measurement:" + measurement.id]: {
                error: String(error),
              },
            },
          });
        }
      }
  }
  render(): void {
    for (const { measurement, line, label } of this.measurementLines.values())
      try {
        const points = this.measurementWorldPoints(measurement),
          position = line.geometry.getAttribute("position");
        let changed = false;
        for (let i = 0; i < points.length; i++) {
          const p = points[i];
          if (
            position.getX(i) !== p.x ||
            position.getY(i) !== p.y ||
            position.getZ(i) !== p.z
          ) {
            position.setXYZ(i, p.x, p.y, p.z);
            changed = true;
          }
        }
        if (changed) {
          position.needsUpdate = true;
          line.geometry.computeBoundingSphere();
        }
        label.point.copy(points.at(-1)!);
        label.text =
          measurement.name +
          " " +
          measure(
            measurement.kind,
            points.map((p) => p.toArray()),
            measurement.unit,
          ).toFixed(2) +
          (measurement.kind === "angle" ? "°" : measurement.unit) +
          " · 网格测量";
        line.visible = true;
      } catch {
        line.visible = false;
        label.point.setScalar(1e30);
      }

    for (const helper of this.sectionHelpers)
      helper.visible = this.runtime.mode === "edit";
    for (const [id, state] of this.clips)
      if (!state.view) {
        const next = sectionPlanes(this.captureSections(id));
        if (next.length === state.planes.length)
          next.forEach((plane, index) => state.planes[index].copy(plane));
      }
    const width = this.runtime.engine.container.clientWidth,
      height = this.runtime.engine.container.clientHeight,
      labels = this.layout.layout(
        this.labelPoints.flatMap((label) => {
          const p = label.point.clone().project(this.runtime.engine.camera);
          if (p.z > 1 || p.z < -1) return [];
          return [
            {
              id: label.id,
              text: label.text,
              x: (p.x * 0.5 + 0.5) * width,
              y: (-0.5 * p.y + 0.5) * height,
              anchorX: 0,
              anchorY: 0,
              color: "#ffc564",
              size: 12,
              cluster: true,
              distance: this.runtime.engine.camera.position.distanceTo(
                label.point,
              ),
            },
          ];
        }),
      );
    const visible = new Set(labels.map((label) => label.id));
    for (const [id, node] of this.labelNodes)
      if (!visible.has(id)) {
        node.remove();
        this.labelNodes.delete(id);
      }
    for (const label of labels) {
      let div = this.labelNodes.get(label.id);
      if (!div) {
        div = document.createElement("span");
        this.labelNodes.set(label.id, div);
        this.labels.append(div);
      }
      div.textContent = label.text;
      div.style.transform = `translate(${label.x}px,${label.y}px)`;
    }
  }
  beforeChange(): void {
    this.nonce++;
    for (const id of this.reviews.keys())
      this.runtime.visual.reset("industrial:" + id);
    this.clips.clear();
  }
  change(change: ChangeSet): void {
    this.reviews.clear();
    for (const e of change.after.entities) {
      const c = getComponent(e, "studio.industrial.Review");
      if (c) this.reviews.set(e.id, c.data as unknown as IndustrialReview);
    }
    this.drawMeasurements();
    for (const id of this.active)
      if (this.reviews.has(id))
        this.runtime.track(
          this.apply(id).catch((error) => this.runtime.issue(id, error)),
        );
  }
  mode(mode: "edit" | "play"): void {
    for (const id of this.reviews.keys()) {
      this.reset(id);
      if (mode === "play")
        this.runtime.track(
          this.apply(id).catch((error) => this.runtime.issue(id, error)),
        );
    }
  }
  actions: Record<string, (a: BehaviorAction) => void | Promise<void>> = {
    "studio.industrial.Apply": (a) => this.apply(a.targetId),
    "studio.industrial.Reset": (a) => this.reset(a.targetId),
    "studio.industrial.RestoreView": (a) => {
      const view = this.review(a.targetId).views.find(
        (v) => v.id === a.data.viewId,
      );
      if (!view) throw Error("保存视图不存在");
      return this.apply(a.targetId, view);
    },
  };
  detach(): void {
    this.nonce++;
    for (const id of this.reviews.keys()) this.reset(id);
    this.reviews.clear();
    this.active.clear();
    this.clips.clear();
    this.filterCache.clear();
    this.releaseMarks();
    this.marks.removeFromParent();
    this.labels.remove();
  }
}
