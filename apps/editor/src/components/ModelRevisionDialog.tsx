import { useEffect, useMemo, useRef, useState } from "react";
import {
  getComponent,
  type Entity,
  type SceneAsset,
} from "@studio/scene-schema";
import { replaceModelRevision } from "@studio/editor-core";
import { useStudio } from "../state/studio";
export interface RevisionInput {
  modelId: string;
  asset: SceneAsset;
  nodes: Entity[];
  clips: string[];
  sceneId: string;
}
export function ModelRevisionDialog({
  input,
  close,
}: {
  input: RevisionInput;
  close: () => void;
}) {
  const previousFocus = useRef(
      window.document.activeElement as HTMLElement | null,
    ),
    host = useRef<HTMLElement>(null);
  useEffect(
    () => () => {
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
    },
    [],
  );
  const document = useStudio((s) => s.document);
  const [mapping, setMapping] = useState<Record<string, string>>({}),
    [animationMap, setAnimationMap] = useState<Record<string, string>>({}),
    [keepUnmatched, setKeepUnmatched] = useState(false),
    [acceptNew, setAcceptNew] = useState(true),
    [preserveTransforms, setPreserveTransforms] = useState(true);
  const result = useMemo(() => {
    try {
      return {
        plan:
          document && document.sceneId === input.sceneId
            ? replaceModelRevision(
                document,
                input.modelId,
                input.asset,
                input.nodes,
                {
                  mapping,
                  animationMap,
                  keepUnmatched,
                  acceptNew,
                  preserveTransforms,
                  clips: input.clips,
                },
              )
            : undefined,
        error: "",
      };
    } catch (error) {
      return { plan: undefined, error: String(error) };
    }
  }, [
    document,
    input,
    mapping,
    animationMap,
    keepUnmatched,
    acceptNew,
    preserveTransforms,
  ]);
  const plan = result.plan;
  if (!document) return null;
  if (!plan)
    return (
      <div className="modal-backdrop">
        <section
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-label="模型更新不可用"
        >
          <p role="alert">{result.error || "工程已切换"}</p>
          <button onClick={close}>关闭</button>
        </section>
      </div>
    );
  const previous = document.entities.filter(
    (e) => getComponent(e, "ModelNode")?.data.modelEntityId === input.modelId,
  );
  const sourceNodes = input.nodes.filter((e) => getComponent(e, "ModelNode"));
  const animations = document.entities.flatMap((e) =>
    e.components
      .filter(
        (c) => c.type === "Animation" && c.data.modelEntityId === input.modelId,
      )
      .map((c) => ({ entity: e, component: c })),
  );
  const blocked =
    plan.report.conflicts.length > 0 ||
    (plan.report.unmatched.length > 0 && !keepUnmatched) ||
    (plan.report.newElements.length > 0 && !acceptNew);
  return (
    <div className="modal-backdrop">
      <section
        ref={host}
        className="modal model-revision-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="模型版本与身份映射"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            close();
          }
          if (e.key === "Tab") {
            const items = [
              ...host.current!.querySelectorAll<HTMLElement>(
                "button:not(:disabled),select:not(:disabled),input:not(:disabled)",
              ),
            ];
            const first = items[0],
              last = items.at(-1);
            if (e.shiftKey && window.document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && window.document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header>
          <h2>模型版本与身份映射</h2>
          <button autoFocus onClick={close}>
            取消
          </button>
        </header>
        <p>
          匹配 {plan.report.matched.length}；未匹配{" "}
          {plan.report.unmatched.length}；新增 {plan.report.newElements.length}
          。应用为单条可撤销事务。
        </p>
        <div className="mapping-list">
          {previous.map((entity) => (
            <label key={entity.id}>
              {entity.name}
              <select
                aria-label={entity.name + " 来源映射"}
                value={
                  mapping[entity.id] ?? plan.report.mapping[entity.id] ?? ""
                }
                onChange={(e) =>
                  setMapping({ ...mapping, [entity.id]: e.target.value })
                }
              >
                <option value="">保留为待修复占位</option>
                {sourceNodes.map((node) => (
                  <option
                    key={node.id}
                    value={String(
                      getComponent(node, "ModelNode")!.data.sourceElementId,
                    )}
                  >
                    {node.name} ·{" "}
                    {String(
                      getComponent(node, "ModelNode")!.data.sourceElementId,
                    )}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        {animations.map(({ entity, component }) => (
          <label key={entity.id}>
            动画 {entity.name} · {String(component.data.clip)}
            <select
              aria-label={entity.name + " 动画映射"}
              value={
                animationMap[String(component.data.clip)] ??
                String(component.data.clip)
              }
              onChange={(e) =>
                setAnimationMap({
                  ...animationMap,
                  [String(component.data.clip)]: e.target.value,
                })
              }
            >
              <option value={String(component.data.clip)}>保留当前片段</option>
              {input.clips.map((clip) => (
                <option key={clip} value={clip}>
                  {clip}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label>
          <input
            type="checkbox"
            checked={preserveTransforms}
            onChange={(e) => setPreserveTransforms(e.target.checked)}
          />
          保留已编辑的世界姿态（关闭则采用新来源姿态）
        </label>
        <label>
          <input
            type="checkbox"
            checked={acceptNew}
            onChange={(e) => setAcceptNew(e.target.checked)}
          />
          纳入新增元素和完整来源层级
        </label>
        <label>
          <input
            type="checkbox"
            checked={keepUnmatched}
            onChange={(e) => setKeepUnmatched(e.target.checked)}
          />
          未匹配元素保留全部业务资料与 ID，作为待修复占位；阻止发布
        </label>
        {plan.report.conflicts.map((error) => (
          <p key={error} role="alert">
            {error}
          </p>
        ))}
        <p className="hint">
          旧表面锚点不会自动移动到新三角形。更新后请在标注修复面板重新选面；实体局部锚点与业务引用保持原
          ID。
        </p>
        <button
          className="primary"
          disabled={blocked}
          onClick={() => {
            if (useStudio.getState().command(plan.command)) close();
          }}
        >
          应用模型更新
        </button>
      </section>
    </div>
  );
}
