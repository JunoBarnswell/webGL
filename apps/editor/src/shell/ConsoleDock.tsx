import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createDockview, themeDark, DockviewGroupPanel, type SerializedDockview, type DockviewIDisposable } from "dockview";
import "dockview/dist/styles/dockview.css";
import { Viewport } from "../panels/Viewport";
import { useStudio } from "../state/studio";
import { WindowContent } from "./ConsolePanels";
import { assertConsoleLayout, compactLayout, presetLayout, useConsoleLayout } from "./layout";
import { windowById } from "./windows";

export function ConsoleDock() {
  const host = useRef<HTMLDivElement>(null), parking = useRef<HTMLDivElement>(null);
  const [targets] = useState(() => new Map<string, HTMLDivElement>());
  const [mounted, setMounted] = useState(["viewport"]);
  const target = (id: string) => {
    let element = targets.get(id);
    if (!element) {
      element = document.createElement("div");
      element.className = "console-window window-" + id.replaceAll(".", "-");
      element.dataset.consoleWindow = id;
      element.tabIndex = -1;
      element.setAttribute("role", "region");
      element.setAttribute("aria-label", windowById.get(id)?.title ?? id);
      targets.set(id, element);
    }
    return element;
  };
  // Portal identity is independent of Dockview's groups and layout deserialization.
  target("viewport");
  useLayoutEffect(() => {
    let disposed = false, applying = false, frame = 0, persistTimer: ReturnType<typeof setTimeout>;
    let wasNarrow = host.current!.clientWidth < 820;
    let desktop: SerializedDockview | null = null;
    let previewReturn = "viewport", immersive = false;
    const immersiveEdges = new Map<"left" | "right" | "bottom", { visible: boolean; collapsed: boolean }>();
    const events: DockviewIDisposable[] = [];
    const edgeSubscriptions = new Map<string, () => void>();
    const activate = (id: string) => {
      const layout = useConsoleLayout.getState();
      layout.patch({ activeWindow: id, ...(id.startsWith("extension.") ? { viewportContext: id } : id === "content" || id === "tour" ? { viewportContext: id } : {}) });
      useStudio.getState().activateHistory(id);
    };
    const reconcile = () => {
      if (disposed) return;
      const ids = ["viewport", ...api.panels.filter((p) => p.id !== "viewport").map((p) => p.id)];
      setMounted((old) => old.length === ids.length && old.every((id, i) => id === ids[i]) ? old : ids);
      for (const panel of api.panels) {
        const shown = panel.api.isVisible && !(panel.api.location.type === "edge" && panel.api.group.api.isCollapsed()) && (!immersive || panel.id === "viewport");
        const element = target(panel.id);
        element.dataset.presented = String(shown);
        element.inert = !shown;
        const dirty = panel.id === "viewport" ? ["dirty", "offline", "conflict"].includes(useStudio.getState().saveState) : useConsoleLayout.getState().dirtyWindows[panel.id];
        const title = windowById.get(panel.id)!.title + (dirty ? " •" : "");
        if (panel.title !== title) panel.api.setTitle(title);
      }
      useConsoleLayout.getState().patch({ openWindows: ids, viewportVisible: target("viewport").dataset.presented === "true" });
      for (const edge of ["left", "right", "bottom"] as const) {
        const group = api.getEdgeGroup(edge);
        if (!group || edgeSubscriptions.has(group.id)) continue;
        const dockGroup = api.getGroup(group.id);
        if (!(dockGroup instanceof DockviewGroupPanel)) throw Error("停靠分组未就绪：" + group.id);
        const element = dockGroup.element;
        element.dataset.consoleEdge = edge;
        const change = group.onDidCollapsedChange(queueReconcile);
        edgeSubscriptions.set(group.id, () => { change.dispose(); delete element.dataset.consoleEdge; });
      }
      for (const [id, remove] of edgeSubscriptions) if (!api.getGroup(id)) { remove(); edgeSubscriptions.delete(id); }
    };
    const queueReconcile = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(reconcile);
    };
    const api = createDockview(host.current!, {
      theme: { ...themeDark, name: "studio-console", className: "dockview-theme-dark studio-dock-theme", gap: 4 },
      defaultRenderer: "always",
      floatingGroupBounds: "boundedWithinViewport",
      createComponent: ({ id }) => {
        if (!windowById.has(id)) throw Error("未注册窗口：" + id);
        const element = target(id);
        let visibility: DockviewIDisposable | undefined;
        return {
          element,
          init: ({ api: panel }) => {
            visibility = panel.onDidVisibilityChange(() => {
              if (id === "viewport") useConsoleLayout.getState().patch({ viewportVisible: panel.isVisible });
            });
            queueReconcile();
          },
          focus: () => element.focus({ preventScroll: true }),
          dispose: () => {
            visibility?.dispose();
            if (id === "viewport") parking.current?.append(element);
            queueReconcile();
          },
        };
      },
      createTabComponent: ({ name }) => {
        if (name !== "viewport") return undefined;
        const element = document.createElement("div");
        element.className = "console-viewport-tab";
        element.textContent = "◈  透视 · 场景视口";
        let titleChange: DockviewIDisposable | undefined;
        return { element, init: ({ api }) => { element.textContent = "◈  " + api.title; titleChange = api.onDidTitleChange(({ title }) => { element.textContent = "◈  " + title; }); }, dispose: () => titleChange?.dispose() };
      },
      getTabContextMenuItems: ({ panel }) => panel.id === "viewport" ? ["maximize"] : [
        { label: "浮动窗口", action: () => useConsoleLayout.getState().float(panel.id) },
        { label: "停靠到视口右侧", action: () => useConsoleLayout.getState().dock(panel.id) },
        { label: "自动隐藏到边缘", action: () => useConsoleLayout.getState().autoHide(panel.id) },
        "separator", "maximize", "close",
      ],
    });
    useConsoleLayout.getState().patch({ api });
    const apply = (layout: SerializedDockview | null, retainWindows?: Set<string>) => {
      applying = true;
      try {
        const state = useConsoleLayout.getState();
        const value = layout ?? presetLayout(state.preset, api.width, api.height);
        assertConsoleLayout(value);
        api.fromJSON(value, { reuseExistingPanels: true });
        if (retainWindows) for (const panel of api.panels) if (!retainWindows.has(panel.id)) api.removePanel(panel);
      } catch (error) {
        useConsoleLayout.getState().patch({ notice: "布局恢复失败，已恢复展厅窗口。" + String(error) });
        api.fromJSON(presetLayout("exhibition", api.width, api.height), { reuseExistingPanels: true });
      } finally {
        applying = false;
        reconcile();
        if (!wasNarrow) useConsoleLayout.getState().patch({ layout: api.toJSON() });
      }
    };
    const synchronizeImmersive = () => {
      const next = useStudio.getState().mode === "play" || useConsoleLayout.getState().focus;
      if (next === immersive) return;
      immersive = next;
      if (next) {
        previewReturn = api.activePanel?.id ?? "viewport";
        for (const edge of ["left", "right", "bottom"] as const) {
          const group = api.getEdgeGroup(edge);
          if (group) { immersiveEdges.set(edge, { visible: api.isEdgeGroupVisible(edge), collapsed: group.isCollapsed() }); api.setEdgeGroupVisible(edge, false); }
        }
        api.getPanel("viewport")?.api.setActive();
        api.getPanel("viewport")?.api.maximize();
        useConsoleLayout.getState().open("viewport");
      } else {
        api.exitMaximizedGroup();
        for (const [edge, before] of immersiveEdges) {
          const group = api.getEdgeGroup(edge);
          if (group) { api.setEdgeGroupVisible(edge, before.visible); if (before.collapsed) group.collapse(); else group.expand(); }
        }
        immersiveEdges.clear();
        api.getPanel(previewReturn)?.api.setActive();
      }
      queueReconcile();
    };
    const applyDesiredLayout = (layout: SerializedDockview | null) => {
      if (wasNarrow) {
        desktop = layout ?? presetLayout(useConsoleLayout.getState().preset, desktop?.grid.width ?? 1440, desktop?.grid.height ?? 900, false);
        apply(compactLayout(desktop, api.width, api.height));
      } else {
        desktop = null;
        apply(layout);
      }
    };
    events.push(api.onWillDragPanel((event) => { if (event.panel.id === "viewport") event.nativeEvent.preventDefault(); }));
    events.push(api.onWillDragGroup((event) => { if (event.group.panels.some((panel) => panel.id === "viewport")) event.nativeEvent.preventDefault(); }));
    events.push(api.onDidActivePanelChange(({ panel }) => { if (panel) activate(panel.id); }));
    events.push(api.onDidLayoutChange(() => {
      queueReconcile();
      if (applying || immersive) return;
      clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        if (!disposed && !wasNarrow && !immersive) useConsoleLayout.getState().patch({ layout: api.toJSON() });
      }, 180);
    }));
    const focus = (event: Event) => {
      const element = (event.target as HTMLElement).closest<HTMLElement>("[data-console-window]");
      if (element?.dataset.consoleWindow) {
        activate(element.dataset.consoleWindow);
        const interactive = (event.target as HTMLElement).closest('input,textarea,select,button,a,[contenteditable="true"],[tabindex]');
        if (event.type === "pointerdown" && (!interactive || interactive === element)) element.focus({ preventScroll: true });
      }
    };
    const edgeAt = (value: EventTarget | null) => {
      if (!(value instanceof HTMLElement)) return undefined;
      const owner = value.closest<HTMLElement>("[data-console-window]")?.dataset.consoleWindow;
      const panel = owner ? api.getPanel(owner) : undefined;
      if (panel?.api.location.type === "edge") return panel.api.group.api;
      const edge = value.closest<HTMLElement>("[data-console-edge]")?.dataset.consoleEdge;
      return edge === "left" || edge === "right" || edge === "bottom" ? api.getEdgeGroup(edge) : undefined;
    };
    const enterEdge = (event: Event) => { const group = edgeAt(event.target); if (group?.isCollapsed()) group.expand(); };
    const leaveEdge = (event: Event) => {
      const group = edgeAt(event.target), next = edgeAt((event as FocusEvent | PointerEvent).relatedTarget);
      if (group && group.id !== next?.id && (event.type === "focusout" || group.id !== edgeAt(document.activeElement)?.id)) group.collapse();
    };
    host.current!.addEventListener("focusin", focus);
    host.current!.addEventListener("pointerdown", focus);
    host.current!.addEventListener("pointerover", enterEdge);
    host.current!.addEventListener("pointerout", leaveEdge);
    host.current!.addEventListener("focusin", enterEdge);
    host.current!.addEventListener("focusout", leaveEdge);
    const unsubscribe = useConsoleLayout.subscribe((state, previous) => {
      if (state.dirtyWindows !== previous.dirtyWindows) queueReconcile();
      if (state.revision !== previous.revision) {
        if (immersive) { api.exitMaximizedGroup(); immersive = false; immersiveEdges.clear(); }
        applyDesiredLayout(state.layout);
        synchronizeImmersive();
      }
      if (state.focus !== previous.focus) synchronizeImmersive();
    });
    const studioSubscription = useStudio.subscribe((state, previous) => {
      if (state.mode !== previous.mode) synchronizeImmersive();
      if (state.editingLibrary !== previous.editingLibrary && state.editingLibrary) useConsoleLayout.getState().open("extension.prefab");
      if (state.saveState !== previous.saveState) queueReconcile();
    });
    const resize = new ResizeObserver(([entry]) => {
      const narrow = entry.contentRect.width < 820;
      if (narrow === wasNarrow || immersive) return;
      wasNarrow = narrow;
      if (narrow) {
        desktop = api.toJSON();
        apply(compactLayout(desktop, entry.contentRect.width, entry.contentRect.height));
      } else if (desktop) {
        const current = api.toJSON(), wanted = new Set(Object.keys(current.panels)), active = api.activePanel?.id;
        const restore = structuredClone(desktop);
        const added = Object.keys(current.panels).filter((id) => !restore.panels[id]);
        for (const id of added) restore.panels[id] = current.panels[id];
        const addTabs = (node: SerializedDockview["grid"]["root"]) => {
          if (Array.isArray(node.data)) node.data.forEach(addTabs);
          else if (node.data.views.includes("viewport")) {
            node.data.views.push(...added);
            if (active && node.data.views.includes(active)) node.data.activeView = active;
          }
        };
        addTabs(restore.grid.root);
        apply(restore, wanted);
        desktop = null;
      }
    });
    resize.observe(host.current!);
    api.layout(host.current!.clientWidth, host.current!.clientHeight);
    applyDesiredLayout(useConsoleLayout.getState().layout);
    synchronizeImmersive();
    return () => {
      disposed = true;
      clearTimeout(persistTimer); cancelAnimationFrame(frame);
      resize.disconnect(); unsubscribe(); studioSubscription();
      events.forEach((event) => event.dispose()); edgeSubscriptions.forEach((remove) => remove());
      host.current?.removeEventListener("focusin", focus);
      host.current?.removeEventListener("pointerdown", focus);
      host.current?.removeEventListener("pointerover", enterEdge);
      host.current?.removeEventListener("pointerout", leaveEdge);
      host.current?.removeEventListener("focusin", enterEdge);
      host.current?.removeEventListener("focusout", leaveEdge);
      api.dispose();
      useConsoleLayout.getState().patch({ api: null, openWindows: [] });
    };
  }, []);
  return <main className="console-workbench" aria-label="可停靠创作工作台">
    <div ref={host} className="console-dock-host" />
    <div ref={parking} className="console-parking" aria-hidden="true" />
    {mounted.map((id) => createPortal(id === "viewport" ? <Viewport /> : <WindowContent id={id} />, target(id), id))}
  </main>;
}
