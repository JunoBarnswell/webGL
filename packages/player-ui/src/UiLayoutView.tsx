import { playerWidgets } from "./widgets";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  createAction,
  type BehaviorAction,
  type SceneDocument,
  type UiBreakpoint,
  type UiNode,
  type UiStyle,
} from "@studio/scene-schema";
import type { RuntimeSnapshot, SceneRuntime } from "@studio/scene-runtime";
import { BusinessControls } from "./BusinessControls";
import { useRuntime } from "./useRuntime";

interface RenderContext {
  document: SceneDocument;
  runtime: SceneRuntime | null;
  state: RuntimeSnapshot;
  contentId: string;
  breakpoint: UiBreakpoint;
  design: boolean;
  children: Map<string | null, UiNode[]>;
  run: (action: BehaviorAction) => void;
  onError: (error: unknown) => void;
}
const Context = createContext<RenderContext | null>(null);
export interface UiLayoutViewProps {
  document: SceneDocument;
  runtime: SceneRuntime | null;
  layoutId: string;
  contentId?: string;
  breakpoint?: UiBreakpoint;
  design?: boolean;
  onError: (error: unknown) => void;
}
export function resolvedUiStyle(
  node: UiNode,
  breakpoint: UiBreakpoint,
): UiStyle {
  return {
    ...node.style,
    ...(breakpoint !== "desktop" ? node.tablet : {}),
    ...(breakpoint === "mobile" ? node.mobile : {}),
  };
}
export function uiCss(style: UiStyle, root = false): CSSProperties {
  const flow = style.position === "flow";
  const size = (value: number | string) =>
    value === "fill" ? "100%" : value === "hug" ? "fit-content" : value;
  const css: CSSProperties = {
    position: flow ? "relative" : "absolute",
    width: size(style.width),
    height: size(style.height),
    maxWidth: root ? "calc(100% - 16px)" : "100%",
    minWidth: 0,
    boxSizing: "border-box",
    transform: "rotate(" + style.rotation + "deg)",
    zIndex: style.zIndex,
    color: style.color,
    background: style.background,
    fontSize: style.fontSize,
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    textAlign: style.textAlign,
    border: style.borderWidth + "px solid " + style.borderColor,
    borderRadius: style.borderRadius,
    boxShadow: style.shadow,
    opacity: style.opacity,
    padding: style.padding,
    gap: style.gap,
    overflow: style.overflow,
    display: style.layout === "free" ? "block" : "flex",
    flexDirection: style.layout === "column" ? "column" : "row",
    alignItems:
      style.align === "start"
        ? "flex-start"
        : style.align === "end"
          ? "flex-end"
          : style.align,
    justifyContent:
      style.justify === "start"
        ? "flex-start"
        : style.justify === "end"
          ? "flex-end"
          : style.justify,
  };
  if (!flow) {
    if (style.anchor === "center") {
      css.left = "50%";
      css.top = "50%";
      css.transform = "translate(-50%,-50%) rotate(" + style.rotation + "deg)";
    } else if (style.anchor === "stretch") {
      css.inset = 0;
      css.width = "100%";
      css.height = "100%";
    } else {
      if (style.anchor.endsWith("right")) css.right = style.x;
      else css.left = style.x;
      if (style.anchor.startsWith("bottom")) css.bottom = style.y;
      else css.top = style.y;
    }
  }
  return css;
}
function AssetImage({
  id,
  alt,
  fit,
}: {
  id: string;
  alt: string;
  fit: UiStyle["objectFit"];
}) {
  const context = useContext(Context)!;
  const [url, setUrl] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setUrl("");
    setError("");
    if (id && context.runtime)
      void context.runtime
        .assetUrl(id)
        .then((value) => {
          if (active) setUrl(value);
        })
        .catch((error) => {
          if (active)
            setError(error instanceof Error ? error.message : String(error));
        });
    return () => {
      active = false;
    };
  }, [id, context.runtime]);
  if (!id)
    return context.design ? (
      <span className="player-image-empty">绑定图片</span>
    ) : null;
  if (error)
    return (
      <span role="alert" className="player-image-error">
        {error}
      </span>
    );
  return url ? (
    <img src={url} alt={alt} draggable={false} style={{ objectFit: fit }} />
  ) : (
    <span className="player-image-empty" role="status">
      正在准备图片…
    </span>
  );
}
function UiElement({ node }: { node: UiNode }) {
  const context = useContext(Context)!,
    { document: doc, state, contentId, design } = context;
  const style = resolvedUiStyle(node, context.breakpoint),
    content = doc.contents.find((c) => c.id === contentId);
  const visible = state.uiVisibility[node.id] ?? !style.hidden;
  if (!visible && !design) return null;
  if (
    node.kind === "image" &&
    node.binding === "content.image" &&
    !content?.imageAssetId
  )
    return null;
  let text = node.text;
  const bindings: Record<string, string> = {
    "scene.name": doc.name,
    "content.title": content?.title ?? "",
    "content.body": content?.body ?? "",
    "runtime.viewMode": state.viewMode === "first" ? "第一人称" : "第三人称",
    "runtime.displayMode": state.displayMode === "solid" ? "实体" : "X-Ray",
    "runtime.tourName":
      doc.tours.find((t) => t.id === state.tour.id)?.name ?? "",
    "runtime.progress": Math.round(state.tour.progress * 100) + "%",
  };
  if (node.binding in bindings) text = bindings[node.binding];
  const invoke = (value?: number | boolean) => {
    if (design || !context.runtime) return;
    if (node.action) {
      const action = { ...node.action, data: { ...node.action.data } };
      if (value !== undefined && action.type === "SetVariable")
        action.data.value = value;
      context.run(action);
    }
    void context.runtime.emit(
      value === undefined ? "uiClick" : "uiChange",
      node.id,
      "ui",
    );
  };
  let child: ReactNode;
  const widget = playerWidgets.find((w) => w.kind === node.kind);
  if (widget) {
    const Component = widget.Component;
    child = (
      <Component
        document={doc}
        runtime={context.runtime}
        state={state}
        node={node}
        design={design}
      />
    );
  } else if (node.kind === "text" || node.kind === "icon")
    child = <span style={{ whiteSpace: "pre-wrap" }}>{text}</span>;
  else if (node.kind === "image")
    child = (
      <AssetImage
        id={
          node.binding === "content.image"
            ? (content?.imageAssetId ?? "")
            : node.assetId
        }
        alt={content?.title ?? node.name}
        fit={style.objectFit}
      />
    );
  else if (node.kind === "button")
    child = (
      <button
        disabled={design}
        style={{
          width: "100%",
          height: "100%",
          color: "inherit",
          background: "transparent",
          border: 0,
          font: "inherit",
        }}
        onClick={() => invoke()}
      >
        {text}
      </button>
    );
  else if (node.kind === "slider") {
    const variable = state.variables[node.action?.targetId ?? ""];
    child = (
      <label>
        {text}
        <input
          type="range"
          aria-label={node.name}
          min="0"
          max="1"
          step=".01"
          disabled={design}
          value={typeof variable === "number" ? variable : 0}
          onChange={(e) => invoke(Number(e.target.value))}
        />
      </label>
    );
  } else if (node.kind === "toggle") {
    const variable = state.variables[node.action?.targetId ?? ""];
    child = (
      <label>
        {text}
        <input
          type="checkbox"
          aria-label={node.name}
          disabled={design}
          checked={variable === true}
          onChange={(e) => invoke(e.target.checked)}
        />
      </label>
    );
  } else if (node.kind === "list")
    child = (
      <div className="player-content-list">
        {doc.contents.map((item) => (
          <button
            key={item.id}
            disabled={design}
            onClick={() => {
              const action = createAction("OpenContent");
              action.targetId = item.id;
              context.run(action);
            }}
          >
            {item.title}
          </button>
        ))}
      </div>
    );
  else if (node.kind === "container" || node.kind === "shape") child = null;
  else
    child = (
      <BusinessControls
        node={node}
        document={doc}
        runtime={context.runtime}
        state={state}
        contentId={contentId}
        design={design}
        run={context.run}
        onError={context.onError}
      />
    );
  return (
    <div
      className={
        "player-ui-node player-kind-" +
        node.kind +
        (design ? " player-design-node" : "") +
        (style.animation !== "none" ? " player-motion-" + style.animation : "")
      }
      data-ui-id={node.id}
      data-ui-hidden={!visible || undefined}
      aria-label={node.name}
      style={{
        ...uiCss(style, !node.parentId),
        pointerEvents: node.kind === "container" ? "none" : "auto",
        ...(design && !visible ? { opacity: 0.3 } : {}),
      }}
    >
      {child}
      {context.children.get(node.id)?.map((child) => (
        <UiElement key={child.id} node={child} />
      ))}
    </div>
  );
}
export function UiLayoutView({
  document: doc,
  runtime,
  layoutId,
  contentId = "",
  breakpoint = "desktop",
  design = false,
  onError,
}: UiLayoutViewProps) {
  const state = useRuntime(runtime);
  const children = useMemo(() => {
    const map = new Map<string | null, UiNode[]>();
    for (const node of doc.ui.nodes)
      if (node.layoutId === layoutId) {
        const list = map.get(node.parentId) ?? [];
        list.push(node);
        map.set(node.parentId, list);
      }
    return map;
  }, [doc.ui.nodes, layoutId]);
  const run = (action: BehaviorAction) => {
    if (runtime && !design) void runtime.dispatch(action).catch(onError);
  };
  const context: RenderContext = {
    document: doc,
    runtime,
    state,
    contentId,
    breakpoint,
    design,
    children,
    run,
    onError,
  };
  return (
    <Context.Provider value={context}>
      <div className="player-ui-layout" data-layout-id={layoutId}>
        {children.get(null)?.map((node) => (
          <UiElement key={node.id} node={node} />
        ))}
      </div>
    </Context.Provider>
  );
}
