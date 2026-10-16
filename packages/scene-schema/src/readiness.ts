import { compilePrefabs } from "./prefab";
import { documentReferenceEdges } from "./references";
import { validateDocument } from "./index";
import type { SceneDocument } from "./types";
export interface ReleasePolicy {
  hardware: "advisory" | "required";
  budget: "advisory" | "required";
}
export interface ReadinessCheck {
  code: string;
  status: "pass" | "fail" | "unverified";
  severity: "error" | "warning" | "info";
  message: string;
  path: string;
  ownerId: string;
  sceneId: string;
  details: string[];
}
export interface ReleaseReadinessReport {
  subjectKind: "scene" | "project";
  subjectId: string;
  checkedAt: string;
  ready: boolean;
  errorCount: number;
  warningCount: number;
  checks: ReadinessCheck[];
}
export function summarizeReadiness(
  subjectKind: "scene" | "project",
  subjectId: string,
  checks: ReadinessCheck[],
): ReleaseReadinessReport {
  const errorCount = checks.filter(
    (c) => c.severity === "error" && c.status !== "pass",
  ).length;
  return {
    subjectKind,
    subjectId,
    checkedAt: new Date().toISOString(),
    ready: errorCount === 0,
    errorCount,
    warningCount: checks.filter(
      (c) => c.severity === "warning" && c.status !== "pass",
    ).length,
    checks,
  };
}
/** Local structural preflight. Storage/pins/evidence are authoritatively checked by the API. */
export function releaseReadiness(
  document: SceneDocument,
): ReleaseReadinessReport {
  const checks: ReadinessCheck[] = [],
    add = (
      code: string,
      status: ReadinessCheck["status"],
      message: string,
      path = "",
      ownerId = "",
      details: string[] = [],
    ) =>
      checks.push({
        code,
        status,
        severity:
          status === "fail"
            ? "error"
            : status === "unverified"
              ? "warning"
              : "info",
        message,
        path,
        ownerId,
        sceneId: document.sceneId,
        details,
      });
  const errors = validateDocument(document, true);
  add(
    "schema",
    errors.length ? "fail" : "pass",
    errors.length ? "文档或扩展契约未通过" : "文档与扩展契约通过",
    "",
    "",
    errors,
  );
  if (errors.length)
    return summarizeReadiness("scene", document.sceneId, checks);
  const compiled = compilePrefabs(document),
    groups = new Map<string, Set<string>>();
  for (const [kind, items] of [
    ["entity", compiled.entities],
    ["material", compiled.materials],
    ["asset", compiled.assets],
    ["content", compiled.contents],
    ["viewpoint", compiled.viewpoints],
    ["tour", compiled.tours],
    ["variable", compiled.variables],
    ["ui", compiled.ui.nodes],
    ["layout", compiled.ui.layouts],
  ] as const)
    groups.set(kind, new Set(items.map((item) => item.id)));
  const invalid = documentReferenceEdges(compiled).filter(
    (edge) => groups.has(edge.kind) && !groups.get(edge.kind)!.has(edge.id),
  );
  for (const edge of invalid)
    add(
      "reference",
      "fail",
      "引用目标不存在：" + edge.id,
      edge.path,
      edge.ownerId,
    );
  if (!invalid.length) add("reference", "pass", "当前场景引用闭合");
  add("revision", "unverified", "由服务端核对不可变源修订与目录固定版本");
  add("resource", "unverified", "由服务端确认资源摘要与对象存储闭包");
  add("visual", "unverified", "由服务端核对模型节点、动画与材质变体绑定");
  add("workspace", "pass", "工作区使用共享文档与运行能力");
  add("budget", "unverified", "处理预算和报告由服务端核对");
  add("hardware", "unverified", "未将本地结构校验作为硬件验收证据");
  return summarizeReadiness("scene", document.sceneId, checks);
}
