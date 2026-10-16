import { useConsoleLayout } from "../shell/layout";
import { pointWorld, pointValue, pointFrame } from "../shell/DocumentPoint";
import { instantiatePrefab } from "@studio/editor-core";
import { writeDocumentValue } from "@studio/editor-core";
import { surfaceAnchor } from "../../../../packages/extensions/annotation/anchors";
import { usePreferences } from "../shell/preferences";
import { execute } from "../shell/commands";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { ShowroomEngine } from "@o2vr/engine";
import { PlayerUI, useRuntime } from "@studio/player-ui";
import { addHotspot } from "@studio/editor-core";
import { EditorCamera } from "./EditorCamera";
import { SceneRuntime } from "@studio/scene-runtime";
import { getComponent, type Transform } from "@studio/scene-schema";
import { useStudio, type EditingPoint } from "../state/studio";
import { authHeaders } from "../state/api";
import { createOverlays, type EditorOverlays } from "./EditorOverlays";
import { mountModel } from "./Resources";
import {
  Move,
  MousePointer2,
  RotateCcw,
  Scaling,
  LocateFixed,
  Grid2X2,
  Magnet,
} from "lucide-react";

function readTransform(runtime: SceneRuntime, id: string): Transform {
  const object = runtime.getObject(id)!;
  const document = runtime.document!;
  const entity = document.entities.find((e) => e.id === id)!;
  let factor = 1,
    scaleFactor = 1;
  const binding = getComponent(entity, "ModelNode");
  const parent = entity.parentId
    ? document.entities.find((e) => e.id === entity.parentId)
    : undefined;
  const parentBinding = parent && getComponent(parent, "ModelNode");
  const modelId = String(
    binding?.data.modelEntityId ?? parentBinding?.data.modelEntityId ?? "",
  );
  const model = document.entities.find((e) => e.id === modelId);
  const component = model && getComponent(model, "Model");
  if (component) {
    factor = Number(component.data.unitScale);
    if (!binding) scaleFactor = factor;
  }
  return {
    position: object.position.clone().multiplyScalar(factor).toArray(),
    rotation: object.quaternion.clone().normalize().toArray() as [
      number,
      number,
      number,
      number,
    ],
    scale: object.scale.clone().multiplyScalar(scaleFactor).toArray(),
  };
}
export function Viewport() {
  const host = useRef<HTMLDivElement>(null);
  const prefabGhost = useRef<{
    helper: THREE.Box3Helper;
    engine: ShowroomEngine;
    position: THREE.Vector3;
  } | null>(null);
  const clearPrefabGhost = () => {
    const ghost = prefabGhost.current;
    if (!ghost) return;
    ghost.helper.removeFromParent();
    ghost.engine.resourceRegistry.release(ghost.helper.geometry);
    for (const material of Array.isArray(ghost.helper.material)
      ? ghost.helper.material
      : [ghost.helper.material])
      ghost.engine.resourceRegistry.release(material);
    prefabGhost.current = null;
  };
  useEffect(() => () => clearPrefabGhost(), []);

  const controls = useRef<{
    orbit: OrbitControls;
    gizmo: TransformControls;
    engine: ShowroomEngine;
    runtime: SceneRuntime;
    helpers: THREE.Group;
    pivot: THREE.Group;
    overlays?: EditorOverlays;
    view: EditorCamera;
    frame: () => void;
  } | null>(null);
  const runtimeReference = useStudio((s) => s.runtime),
    runtimeState = useRuntime(runtimeReference),
    viewportVisible = useConsoleLayout((s) => s.viewportVisible),
    activeTourId = useStudio((s) => s.activeTourId);
  const mode = useStudio((s) => s.mode),
    tool = useStudio((s) => s.tool),
    space = useStudio((s) => s.space),
    snap = useStudio((s) => s.snap),
    selected = useStudio((s) => s.selected),
    document = useStudio((s) => s.document),
    editingPoint = useStudio((s) => s.editingPoint);
  const [statistics, setStatistics] = useState({
      fps: 0,
      draws: 0,
      triangles: 0,
      resources: {
        objects: 0,
        resources: 0,
        textures: 0,
        geometries: 0,
        pending: 0,
        contexts: 0,
        listeners: 0,
      },
    }),
    [rectangle, setRectangle] = useState<{
      x: number;
      y: number;
      w: number;
      h: number;
    } | null>(null);
  const preferences = usePreferences();
  const grid = preferences.grid;
  useEffect(() => {
    if (!host.current) return;
    const container = host.current;
    const engine = new ShowroomEngine({ container });
    const canvas = engine.renderer.domElement;
    const runtime = new SceneRuntime(
      engine,
      {
        url: (id, path) =>
          "/api/assets/" +
          id +
          "/files/" +
          path.split("/").map(encodeURIComponent).join("/"),
        headers: authHeaders,
        recordsUrl: (id, parameters) =>
          "/api/semantics/" + id + "?" + parameters,
      },
      {
        onSelect: (id) => {
          if (
            !controls.current?.gizmo.dragging &&
            !useStudio.getState().document?.entities.find((e) => e.id === id)
              ?.locked
          )
            useStudio.getState().select([id]);
        },
        onAnnotationOffset: (id, offset) =>
          useStudio.getState().command({
            label: "调整标注引线",
            mutate: (doc) => {
              const component = doc.entities
                .find((e) => e.id === id)
                ?.components.find((c) => c.type === "studio.annotation.Label");
              if (component) component.data.offset = offset;
            },
          }),
        isToolActive: () =>
          Boolean(
            useStudio.getState().domainTool ||
              useStudio.getState().draggingPrefab ||
              useStudio.getState().placingAnnotation ||
              useStudio.getState().placingHotspot,
          ),
        onIssue: (id, error) =>
          useStudio
            .getState()
            .set({ issues: { ...useStudio.getState().issues, [id]: error } }),
      },
    );
    const helpers = new THREE.Group();
    engine.scene.add(helpers);
    const gridObject = new THREE.GridHelper(100000, 100, "#4a5665", "#2b333f");
    gridObject.position.y = -2;
    helpers.add(gridObject);
    const orbit = new OrbitControls(engine.camera, canvas);
    orbit.enableDamping = false;
    orbit.maxDistance = 150000;
    orbit.addEventListener("change", () => engine.requestRender());
    const view = new EditorCamera(engine, runtime, orbit, (x, y) => {
      const rect = canvas.getBoundingClientRect();
      const hit = runtime.pickSurface(
        ((x - rect.left) / rect.width) * 2 - 1,
        (-(y - rect.top) / rect.height) * 2 + 1,
      );
      if (hit?.entityId) useStudio.getState().select([hit.entityId]);
      useStudio.getState().set({ contextMenu: { x, y } });
    });
    const gizmo = new TransformControls(engine.camera, canvas);
    helpers.add(gizmo);
    const pivot = new THREE.Group();
    helpers.add(pivot);
    const boxes: THREE.BoxHelper[] = [];
    let drag: {
      pivot: THREE.Matrix4;
      worlds: Map<string, THREE.Matrix4>;
      point?: EditingPoint;
    } | null = null;
    const activeIds = () => {
      const state = useStudio.getState();
      return state.selected.filter((id) => {
        const entity = state.document?.entities.find((e) => e.id === id);
        if (!entity || entity.locked) return false;
        let parent = entity.parentId;
        while (parent) {
          if (state.selected.includes(parent)) return false;
          parent =
            state.document?.entities.find((e) => e.id === parent)?.parentId ??
            null;
        }
        return true;
      });
    };
    gizmo.addEventListener("mouseDown", () => {
      const point = gizmo.object?.userData.editorHandle as
        | EditingPoint
        | undefined;
      const worlds = new Map<string, THREE.Matrix4>();
      for (const id of point ? [] : activeIds()) {
        const object = runtime.getObject(id);
        if (object) {
          object.updateWorldMatrix(true, false);
          worlds.set(id, object.matrixWorld.clone());
        }
      }
      pivot.updateWorldMatrix(true, false);
      drag = { pivot: pivot.matrixWorld.clone(), worlds, point };
      useStudio.getState().set({ dragging: true });
      orbit.enabled = false;
    });
    gizmo.addEventListener("objectChange", () => {
      if (drag && !drag.point && gizmo.object === pivot) {
        pivot.updateMatrixWorld(true);
        const delta = pivot.matrixWorld
          .clone()
          .multiply(drag.pivot.clone().invert());
        for (const [id, before] of drag.worlds) {
          const object = runtime.getObject(id);
          if (!object) continue;
          object.parent?.updateWorldMatrix(true, false);
          const local = (
            object.parent?.matrixWorld.clone().invert() ?? new THREE.Matrix4()
          ).multiply(delta.clone().multiply(before));
          local.decompose(object.position, object.quaternion, object.scale);
        }
      }
      if (drag?.point && gizmo.object)
        useStudio
          .getState()
          .set({ pointPreview: gizmo.object.position.toArray() });
      if (drag && !drag.point)
        useStudio.getState().set({
          transforms: Object.fromEntries(
            [...drag.worlds.keys()].map((id) => [
              id,
              readTransform(runtime, id),
            ]),
          ),
        });
      engine.requestRender();
    });
    const finish = (cancel: boolean) => {
      if (!drag) return;
      useStudio.getState().set({ dragging: false });
      if (drag.point && gizmo.object) {
        const point = drag.point,
          position = pointValue(
            runtime,
            point,
            gizmo.object.getWorldPosition(new THREE.Vector3()),
          );
        drag = null;
        useStudio.getState().set({ pointPreview: null });
        if (cancel) {
          gizmo.reset();
          gizmo.dragging = false;
        } else
          useStudio.getState().command({
            label: "编辑空间点",
            mutate: (doc) => {
              writeDocumentValue(doc, point.path, position);
            },
          });
        orbit.enabled = useStudio.getState().mode === "edit";
        engine.requestRender();
        return;
      }
      const ids = [...drag.worlds.keys()];
      const transforms = new Map(
        ids.map((id) => [id, readTransform(runtime, id)]),
      );
      drag = null;
      useStudio.getState().set({ transforms: {} });
      if (cancel) {
        gizmo.reset();
        gizmo.dragging = false;
        const current = useStudio.getState().document;
        if (current)
          void runtime.applyChangeSet({
            sceneReplaced: false,
            before: current,
            after: current,
            entityIds: ids,
            materialIds: [],
            settingsChanged: false,
            behaviorsChanged: false,
            assetsChanged: false,
            contentChanged: false,
            uiChanged: false,
            navigationChanged: false,
          });
      } else
        useStudio.getState().command({
          label: "视口变换",
          mutate: (doc) => {
            for (const entity of doc.entities) {
              const transform = transforms.get(entity.id);
              if (transform) entity.transform = transform;
            }
          },
        });
      orbit.enabled = useStudio.getState().mode === "edit";
      engine.requestRender();
    };
    gizmo.addEventListener("mouseUp", () => finish(false));
    const selectionAbort = new AbortController();
    let start: { x: number; y: number } | null = null;
    canvas.addEventListener(
      "pointerup",
      (event) => {
        if (
          event.button !== 0 ||
          event.altKey ||
          event.shiftKey ||
          drag ||
          useStudio.getState().mode !== "edit"
        )
          return;
        const annotationId = useStudio.getState().placingAnnotation;
        if (annotationId) {
          const rect = canvas.getBoundingClientRect(),
            hit = runtime.pickIntersection(
              ((event.clientX - rect.left) / rect.width) * 2 - 1,
              (-(event.clientY - rect.top) / rect.height) * 2 + 1,
            );
          const anchor = hit && surfaceAnchor(runtime, hit);
          if (anchor) {
            useStudio.getState().command({
              label: "重新附着标注",
              mutate: (doc) => {
                const component = doc.entities
                  .find((e) => e.id === annotationId)
                  ?.components.find(
                    (c) => c.type === "studio.annotation.Label",
                  );
                if (component)
                  Object.assign(component.data, {
                    anchorKind: "surface",
                    ...anchor,
                  });
              },
            });
            useStudio.getState().set({ placingAnnotation: "" });
          } else
            useStudio
              .getState()
              .set({ message: "请选择具有稳定来源和网格版本的表面" });
          event.stopImmediatePropagation();
          return;
        }
        if (useStudio.getState().placingHotspot) {
          const rect = canvas.getBoundingClientRect(),
            hit = runtime.pickSurface(
              ((event.clientX - rect.left) / rect.width) * 2 - 1,
              (-(event.clientY - rect.top) / rect.height) * 2 + 1,
            );
          if (hit) {
            const created = addHotspot(hit.point);
            useStudio.getState().command(created.command);
            useStudio.getState().set({
              placingHotspot: false,
              activeContentId: created.content.id,
            });
            useStudio.getState().select([created.entity.id]);
          }
          event.stopImmediatePropagation();
          return;
        }

        const rect = canvas.getBoundingClientRect(),
          ray = new THREE.Raycaster();
        ray.setFromCamera(
          new THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            (-(event.clientY - rect.top) / rect.height) * 2 + 1,
          ),
          engine.camera,
        );
        const hit = ray.intersectObjects(
          controls.current?.overlays?.handles ?? [],
          false,
        )[0];
        if (hit) {
          useStudio.getState().set({
            editingPoint: hit.object.userData.editorHandle as EditingPoint,
            pointPreview: null,
            tool: "translate",
          });
          event.stopImmediatePropagation();
        }
      },
      { capture: true, signal: selectionAbort.signal },
    );
    canvas.addEventListener(
      "pointerdown",
      (event) => {
        if (!event.shiftKey || useStudio.getState().mode !== "edit") return;
        const rect = canvas.getBoundingClientRect();
        start = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        orbit.enabled = false;
        event.stopImmediatePropagation();
      },
      { capture: true, signal: selectionAbort.signal },
    );
    canvas.addEventListener(
      "pointermove",
      (event) => {
        if (!start) return;
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left,
          y = event.clientY - rect.top;
        setRectangle({
          x: Math.min(x, start.x),
          y: Math.min(y, start.y),
          w: Math.abs(x - start.x),
          h: Math.abs(y - start.y),
        });
      },
      { signal: selectionAbort.signal },
    );
    canvas.addEventListener(
      "pointerup",
      (event) => {
        if (!start) return;
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left,
          y = event.clientY - rect.top;
        const ids: string[] = [];
        for (const entity of useStudio.getState().document?.entities ?? []) {
          if (entity.locked || !entity.visible) continue;
          const object = runtime.getObject(entity.id);
          if (!object) continue;
          const projected = new THREE.Box3()
            .setFromObject(object)
            .getCenter(new THREE.Vector3())
            .project(engine.camera);
          const px = (projected.x * 0.5 + 0.5) * rect.width,
            py = (-projected.y * 0.5 + 0.5) * rect.height;
          if (
            projected.z >= -1 &&
            projected.z <= 1 &&
            px >= Math.min(x, start.x) &&
            px <= Math.max(x, start.x) &&
            py >= Math.min(y, start.y) &&
            py <= Math.max(y, start.y)
          )
            ids.push(entity.id);
        }
        start = null;
        setRectangle(null);
        orbit.enabled = true;
        useStudio.getState().select(ids, true);
      },
      { signal: selectionAbort.signal },
    );
    canvas.addEventListener("pointercancel", () => finish(true), {
      signal: selectionAbort.signal,
    });
    useStudio.getState().set({
      cancelTool: () => {
        if (!drag) return false;
        finish(true);
        return true;
      },
    });
    const frame = () => view.focus(useStudio.getState().selected);

    const overlayUpdate = engine.onUpdate(() => {
      controls.current?.overlays?.update(
        drag?.point && gizmo.object
          ? {
              point: drag.point,
              world: gizmo.object.getWorldPosition(new THREE.Vector3()),
            }
          : undefined,
      );
      return false;
    });
    const renderCleanup = engine.onRender(() => {
      const ids =
        useStudio.getState().mode === "edit"
          ? useStudio.getState().selected
          : [];
      for (let i = boxes.length - 1; i >= 0; i--)
        if (!ids.includes(String(boxes[i].userData.entityId))) {
          const box = boxes.splice(i, 1)[0];
          box.removeFromParent();
          box.geometry.dispose();
          (box.material as THREE.Material).dispose();
        }
      for (const id of ids) {
        const object = runtime.getObject(id);
        if (!object) continue;
        let box = boxes.find((b) => b.userData.entityId === id);
        if (!box) {
          box = new THREE.BoxHelper(object, 0x59d8be);
          box.userData.entityId = id;
          helpers.add(box);
          boxes.push(box);
        }
        box.update();
      }
    });
    const timer = setInterval(
      () =>
        setStatistics({
          fps: engine.frameScheduler.fps,
          draws: engine.renderer.info.render.calls,
          triangles: engine.renderer.info.render.triangles,
          resources: runtime.stats(),
        }),
      700,
    );
    controls.current = {
      engine,
      runtime,
      orbit,
      gizmo,
      helpers,
      pivot,
      frame,
      view,
    };
    useStudio.getState().set({ runtime, view });
    const initial = useStudio.getState().document;
    if (initial)
      void runtime.loadDocument(initial).then(() => {
        orbit.target.fromArray(initial.settings.target);
        orbit.update();
      });
    return () => {
      clearInterval(timer);
      selectionAbort.abort();
      renderCleanup();
      overlayUpdate();
      controls.current?.overlays?.dispose();
      gizmo.dispose();
      view.dispose();
      orbit.dispose();
      runtime.dispose();
      for (const box of boxes) {
        box.geometry.dispose();
        (box.material as THREE.Material).dispose();
      }
      gridObject.geometry.dispose();
      (gridObject.material as THREE.Material).dispose();
      engine.dispose();
      controls.current = null;
      useStudio
        .getState()
        .set({ runtime: null, view: null, cancelTool: null, dragging: false });
    };
  }, []);
  useEffect(() => {
    const current = controls.current;
    if (!current) return;
    current.overlays?.dispose();
    if (document && mode === "edit") {
      current.overlays = createOverlays(
        current.runtime,
        document,
        selected,
        activeTourId || document.tours[0]?.id || "",
      );
      current.helpers.add(current.overlays.root);
    } else current.overlays = undefined;
    current.engine.requestRender();
  }, [
    document?.viewpoints.length,
    document?.tours
      .map((t) => t.id + ":" + t.stops.map((s) => s.id).join(","))
      .join("|"),
    selected,
    mode,
    activeTourId,
  ]);
  useEffect(() => {
    const current = controls.current;
    if (!current) return;
    const { gizmo, pivot, engine } = current;
    gizmo.detach();
    const ids = selected.filter(
      (id) => !document?.entities.find((e) => e.id === id)?.locked,
    );
    const handle = editingPoint
      ? current.overlays?.handles.find(
          (object) =>
            JSON.stringify(object.userData.editorHandle) ===
            JSON.stringify(editingPoint),
        )
      : undefined;
    const object = handle ?? (ids.length ? pivot : undefined);
    if (ids.length) {
      const position = new THREE.Vector3();
      let count = 0;
      for (const id of ids) {
        const target = current.runtime.getObject(id);
        if (target) {
          const box = new THREE.Box3().setFromObject(target);
          position.add(
            box.isEmpty()
              ? target.getWorldPosition(new THREE.Vector3())
              : box.getCenter(new THREE.Vector3()),
          );
          count++;
        }
      }
      pivot.position.copy(position.divideScalar(count || 1));
      const primary = current.runtime.getObject(ids[0]);
      if (primary)
        pivot.quaternion.copy(
          primary.getWorldQuaternion(new THREE.Quaternion()),
        );
      else pivot.rotation.set(0, 0, 0);
      pivot.scale.set(1, 1, 1);
    }
    if (editingPoint && mode === "edit") {
      const world = pointWorld(current.runtime, editingPoint);
      if (world) {
        pivot.position.copy(world);
        pivot.quaternion.setFromRotationMatrix(
          new THREE.Matrix4().extractRotation(
            pointFrame(current.runtime, editingPoint),
          ),
        );
        pivot.scale.set(1, 1, 1);
        pivot.userData.editorHandle = editingPoint;
        gizmo.attach(pivot);
      }
    } else {
      delete pivot.userData.editorHandle;
      if (object && mode === "edit" && tool !== "select") gizmo.attach(object);
    }
    gizmo.setMode(
      editingPoint ? "translate" : tool === "select" ? "translate" : tool,
    );
    gizmo.setSpace(space);
    gizmo.setTranslationSnap(snap ? 100 : null);
    gizmo.setRotationSnap(snap ? Math.PI / 12 : null);
    gizmo.setScaleSnap(snap ? 0.1 : null);
    engine.requestRender();
  }, [selected, tool, space, snap, mode, document, editingPoint]);
  useEffect(() => {
    const current = controls.current;
    if (current) {
      current.view.setEnabled(mode === "edit" && viewportVisible);
      current.helpers.visible = mode === "edit" && viewportVisible;
      current.engine.requestRender();
    }
  }, [mode, viewportVisible]);

  useEffect(() => {
    const helper = controls.current?.helpers.children.find(
      (object) => object instanceof THREE.GridHelper,
    );
    if (helper) {
      helper.visible = grid;
      controls.current?.engine.requestRender();
    }
  }, [grid]);
  useEffect(() => {
    controls.current?.runtime.selectionChanged(mode === "edit" ? selected : []);
  }, [selected, mode]);
  return (
    <section
      className="viewport-panel"
      tabIndex={-1}
      data-focus-scope="viewport"
      onPointerDown={(e) => {
        if (!(e.target as HTMLElement).closest("button,input,select,textarea"))
          controls.current?.engine.renderer.domElement.focus();
      }}
      data-runtime-stats={JSON.stringify(statistics.resources)}
      data-render-info={JSON.stringify({
        timings: controls.current?.engine.perfMonitor.getMetrics(),
        fps: statistics.fps,
        draws: statistics.draws,
        triangles: statistics.triangles,
        systems: Object.fromEntries(runtimeReference?.systemMetrics ?? []),
      })}
      data-load-phase={runtimeState.load.phase}
      onDragOver={(event) => {
        event.preventDefault();
        const state = useStudio.getState(),
          current = controls.current;
        if (!state.draggingPrefab || !current || state.mode !== "edit") return;
        const rect = current.engine.renderer.domElement.getBoundingClientRect(),
          x = ((event.clientX - rect.left) / rect.width) * 2 - 1,
          y = (-(event.clientY - rect.top) / rect.height) * 2 + 1;
        const hit = current.runtime.pickIntersection(x, y),
          point = hit?.point.clone() ?? new THREE.Vector3(),
          ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2(x, y), current.engine.camera);
        if (
          !hit &&
          !ray.ray.intersectPlane(
            new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
            point,
          )
        )
          return;
        if (state.snap) {
          point.x = Math.round(point.x / 100) * 100;
          point.y = Math.round(point.y / 100) * 100;
          point.z = Math.round(point.z / 100) * 100;
        }
        if (!prefabGhost.current) {
          const helper = new THREE.Box3Helper(
            new THREE.Box3(
              new THREE.Vector3(-500, 0, -500),
              new THREE.Vector3(500, 1000, 500),
            ),
            0x5de6bd,
          );
          helper.userData.editorHelper = true;
          helper.renderOrder = 100;
          current.engine.resourceRegistry.retain(helper.geometry);
          for (const material of Array.isArray(helper.material)
            ? helper.material
            : [helper.material])
            current.engine.resourceRegistry.retain(material);
          current.engine.scene.add(helper);
          prefabGhost.current = {
            helper,
            engine: current.engine,
            position: point.clone(),
          };
        }
        prefabGhost.current.position.copy(point);
        prefabGhost.current.helper.box.min.set(-500, 0, -500).add(point);
        prefabGhost.current.helper.box.max.set(500, 1000, 500).add(point);
        current.engine.requestRender();
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          clearPrefabGhost();
      }}
      onDrop={(event) => {
        event.preventDefault();
        const prefabData = event.dataTransfer.getData(
          "application/x-studio-prefab",
        );
        if (prefabData) {
          try {
            const revision =
                useStudio.getState().draggingPrefab ?? JSON.parse(prefabData),
              position = prefabGhost.current?.position.toArray() ?? [0, 0, 0],
              result = instantiatePrefab(
                revision,
                position as [number, number, number],
              );
            if (useStudio.getState().command(result.command))
              useStudio
                .getState()
                .select([
                  result.instance.bindings.entity[result.instance.rootLocalId],
                ]);
          } catch (error) {
            useStudio.getState().set({ message: String(error) });
          } finally {
            clearPrefabGhost();
            useStudio.getState().set({ draggingPrefab: null });
          }
          return;
        }
        clearPrefabGhost();
        const materialId = event.dataTransfer.getData("studio/material");
        if (materialId) {
          const current = controls.current;
          if (current) {
            const rect =
                current.engine.renderer.domElement.getBoundingClientRect(),
              ray = new THREE.Raycaster();
            ray.setFromCamera(
              new THREE.Vector2(
                ((event.clientX - rect.left) / rect.width) * 2 - 1,
                (-(event.clientY - rect.top) / rect.height) * 2 + 1,
              ),
              current.engine.camera,
            );
            let object: THREE.Object3D | undefined = ray
              .intersectObjects(
                [...current.runtime.objects.values()].map((i) => i.visual),
                true,
              )
              .find((hit) => {
                let cursor: THREE.Object3D | null = hit.object;
                while (cursor) {
                  if (!cursor.visible || cursor.userData.collider) return false;
                  cursor = cursor.parent;
                }
                return true;
              })?.object;
            while (object && !object.userData.entityId)
              object = object.parent ?? undefined;
            const id = String(object?.userData.entityId ?? selected[0] ?? "");
            useStudio.getState().command({
              label: "拖放材质",
              mutate: (doc) => {
                const component = doc.entities
                  .find((e) => e.id === id)
                  ?.components.find((c) =>
                    ["Mesh", "Model", "ModelNode"].includes(c.type),
                  );
                if (component) component.data.materialId = materialId;
              },
            });
          }
          return;
        }
        const id = event.dataTransfer.getData("studio/asset");
        const asset = document?.assets.find((a) => a.id === id);
        if (asset?.kind === "model")
          void useStudio.getState().run("挂载模型", () => mountModel(asset));
      }}
    >
      <div ref={host} className="viewport-canvas" />
      {mode === "edit" && (
        <div className="viewport-toolbar">
          <div className="tool-strip">
            {[
              ["select", MousePointer2, "选择 Q"],
              ["translate", Move, "移动 W"],
              ["rotate", RotateCcw, "旋转 E"],
              ["scale", Scaling, "缩放 R"],
            ].map(([value, Icon, title]) => {
              const Glyph = Icon as typeof Move;
              return (
                <button
                  key={String(value)}
                  className={tool === value ? "active" : ""}
                  aria-label={String(title)}
                  title={String(title)}
                  onClick={() => execute("tool." + value)}
                >
                  <Glyph />
                </button>
              );
            })}
            <details className="viewport-options">
              <summary aria-label="视口选项">···</summary>
              <select
                aria-label="坐标空间"
                value={space}
                onChange={(event) =>
                  useStudio
                    .getState()
                    .set({ space: event.target.value as typeof space })
                }
              >
                <option value="world">世界</option>
                <option value="local">局部</option>
              </select>
              <button
                className={snap ? "active" : ""}
                title="吸附 100mm / 15° / 0.1"
                aria-label="切换吸附"
                onClick={() => useStudio.getState().set({ snap: !snap })}
              >
                <Magnet />
              </button>
            </details>
          </div>
          <details className="tool-strip viewport-options">
            <summary>导航与视图</summary>
            <select
              aria-label="视口导航模式"
              defaultValue="select"
              onChange={(e) =>
                controls.current?.view.setNavigation(
                  e.target.value as "select" | "orbit" | "walk",
                )
              }
            >
              <option value="select">选择 / 编辑</option>
              <option value="orbit">环绕观察</option>
              <option value="walk">漫游观察</option>
            </select>
            <button
              title="回到初始视角"
              aria-label="初始视角"
              onClick={() => controls.current?.view.reset()}
            >
              ⌂
            </button>
            <button
              title="返回上个视角"
              aria-label="返回视角"
              onClick={() => controls.current?.view.back()}
            >
              ↶
            </button>
            <select
              aria-label="方向视图"
              value=""
              onChange={(e) => {
                if (e.target.value)
                  controls.current?.view.orient(
                    e.target.value as "front" | "top" | "right" | "perspective",
                  );
              }}
            >
              <option value="">视图</option>
              <option value="front">前视</option>
              <option value="top">顶视</option>
              <option value="right">右视</option>
              <option value="perspective">透视</option>
            </select>
            <button
              title="聚焦选中 F"
              aria-label="聚焦选中"
              onClick={() => execute("view.selection")}
            >
              <LocateFixed />
            </button>
            <button
              className={grid ? "active" : ""}
              title="网格"
              aria-label="切换网格"
              onClick={() => execute("view.grid")}
            >
              <Grid2X2 />
            </button>
          </details>
          <button onClick={() => execute("view.focus")}>专注</button>
          <button onClick={() => execute("panel.inspector")}>属性</button>
          <button onClick={() => execute("shortcuts.open")}>?</button>
        </div>
      )}
      {editingPoint && mode === "edit" && (
        <div className="point-edit-tools">
          <span>{editingPoint.label}</span>
          <button
            onClick={() =>
              useStudio
                .getState()
                .set({ editingPoint: null, pointPreview: null })
            }
          >
            完成视点编辑
          </button>
        </div>
      )}
      {preferences.statistics && (
        <div className="viewport-bottom">
          <span>
            {mode === "play"
              ? "预览 · 点击视口后 WASD 漫游，拖动观察"
              : "Alt 环绕 · 中键平移 · 右键+WASD 飞行 · F 聚焦"}
          </span>
          <span>
            {statistics.fps} FPS · {statistics.draws} Draws ·{" "}
            {statistics.triangles.toLocaleString()} △
          </span>
        </div>
      )}
      {preferences.statistics && (
        <details className="performance-panel">
          <summary>资源与系统 CPU</summary>
          <pre>
            {JSON.stringify(
              {
                timings: controls.current?.engine.perfMonitor.getMetrics(),
                resources: statistics.resources,
                systems: Object.fromEntries(
                  runtimeReference?.systemMetrics ?? [],
                ),
              },
              null,
              2,
            )}
          </pre>
        </details>
      )}
      {rectangle && (
        <div
          className="selection-box"
          style={{
            left: rectangle.x,
            top: rectangle.y,
            width: rectangle.w,
            height: rectangle.h,
          }}
        />
      )}
      {mode === "play" && runtimeReference && document && (
        <PlayerUI
          runtime={runtimeReference}
          document={runtimeReference.document ?? document}
        />
      )}
      {mode === "play" && (
        <div className="preview-session-bar">
          <span>预览</span>
          <button onClick={() => execute("view.fullscreen")}>全屏预览</button>
          <button onClick={() => execute("view.preview")}>停止预览 Esc</button>
        </div>
      )}
      {mode === "edit" &&
        ["structure", "assets", "gpu"].includes(runtimeState.load.phase) && (
          <div className="scene-load-card" role="status">
            <strong>{runtimeState.load.message}</strong>
            <progress
              max={runtimeState.load.total || 1}
              value={runtimeState.load.completed}
            />
            <button onClick={() => runtimeReference?.cancelLoad()}>
              取消加载
            </button>
          </div>
        )}
      {mode === "edit" &&
        document &&
        ["error", "cancelled"].includes(runtimeState.load.phase) && (
          <div className="scene-load-card" role="alert">
            <strong>{runtimeState.load.message}</strong>
            <button
              onClick={() =>
                void runtimeReference
                  ?.loadDocument(document)
                  .then(() => controls.current?.view.reset(false))
                  .catch((error) =>
                    useStudio.getState().set({ message: String(error) }),
                  )
              }
            >
              重新加载场景
            </button>
          </div>
        )}
      {useStudio.getState().placingAnnotation && mode === "edit" && (
        <div className="viewport-instruction">
          点击模型表面重新附着标注 · Esc 取消
        </div>
      )}
      {useStudio.getState().placingHotspot && mode === "edit" && (
        <div className="viewport-instruction">
          点击模型表面放置热点 · Esc 取消
        </div>
      )}
      {useStudio.getState().pickEntity && mode === "edit" && (
        <div className="viewport-instruction">
          点击目标对象完成拾取 · Esc 取消
        </div>
      )}
    </section>
  );
}
