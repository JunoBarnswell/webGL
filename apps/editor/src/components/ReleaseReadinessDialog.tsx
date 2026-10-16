import { useEffect, useRef } from "react";
import { useStudio } from "../state/studio";

const labels: Record<string, string> = {
  schema: "文档契约",
  reference: "引用",
  revision: "固定修订",
  resource: "资源",
  visual: "视觉绑定",
  workspace: "工作区",
  budget: "处理预算",
  hardware: "硬件证据",
  project: "项目上下文",
};
export function ReleaseReadinessDialog() {
  const report = useStudio((s) => s.releaseReport),
    pending = useStudio((s) => s.reportPending);
  const host = useRef<HTMLElement>(null);
  const open = Boolean(report);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    host.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
  if (!report) return null;
  return (
    <div className="modal-backdrop">
      <section
        ref={host}
        tabIndex={-1}
        className="modal readiness-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="发布检查"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            useStudio.getState().set({ releaseReport: null });
          }
          if (event.key === "Tab") {
            const items = host.current?.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            );
            if (!items?.length) return;
            const first = items[0],
              last = items[items.length - 1];
            if (
              event.shiftKey &&
              (document.activeElement === first ||
                document.activeElement === host.current)
            ) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <div className="modal-header">
          <h2>发布检查</h2>
          <button
            onClick={() => useStudio.getState().set({ releaseReport: null })}
          >
            关闭
          </button>
        </div>
        <p role="status">
          {pending
            ? "正在核对云端资源与固定修订…"
            : `${report.errorCount} 项阻止发布 · ${report.warningCount} 项提示`}
        </p>
        <p>
          检查当前编辑文档。预算和硬件证据默认提示，可在场景设置中设为发布必需。
        </p>
        <div className="readiness-list">
          {report.checks.map((check, index) => (
            <article
              key={index}
              className={
                check.severity === "error" && check.status !== "pass"
                  ? "danger"
                  : ""
              }
            >
              <strong>
                {labels[check.code] ?? check.code} ·{" "}
                {check.status === "pass"
                  ? "通过"
                  : check.status === "fail"
                    ? "未通过"
                    : "未核实"}
              </strong>
              <p>{check.message}</p>
              {check.path && <code>{check.path}</code>}
              {check.details.length > 0 && (
                <details>
                  <summary>详情（{check.details.length}）</summary>
                  {check.details.map((detail, i) => (
                    <p key={i}>{detail}</p>
                  ))}
                </details>
              )}
              {check.ownerId && (
                <button
                  onClick={() => {
                    const state = useStudio.getState();
                    state.select([check.ownerId]);
                    state.set({
                      inspectorOpen: true,
                      releaseReport: null,
                      message: check.message + " " + check.path,
                    });
                  }}
                >
                  定位对象
                </button>
              )}
            </article>
          ))}
        </div>
        <button
          disabled={pending}
          onClick={() => void useStudio.getState().checkReadiness()}
        >
          重新检查
        </button>
      </section>
    </div>
  );
}
