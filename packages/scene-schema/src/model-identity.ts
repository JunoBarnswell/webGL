export function modelIdentities(
  nodes: Record<string, unknown>[],
  roots: number[],
): Map<number, string> {
  const result = new Map<number, string>(),
    used = new Set<string>();
  const visit = (
    index: number,
    parent: string,
    unstable: boolean,
    siblings: number[],
  ) => {
    if (result.has(index)) throw Error("模型层级重复或循环");
    const node = nodes[index];
    if (!node) throw Error("模型节点越界");
    const extras = node.extras as Record<string, unknown> | undefined;
    const external =
      extras?.sourceElementId ??
      extras?.ElementId ??
      extras?.GlobalId ??
      extras?.guid;
    const name = String(node.name ?? "");
    const ambiguous =
      unstable ||
      !name ||
      siblings.filter((i) => nodes[i]?.name === node.name).length > 1;
    const identity = external
      ? "external:" + String(external)
      : ambiguous
        ? "unresolved:" + parent + "/" + encodeURIComponent(name) + "#" + index
        : parent + "/" + encodeURIComponent(name);
    if (used.has(identity)) throw Error("模型来源身份不唯一：" + identity);
    used.add(identity);
    result.set(index, identity);
    const children = (node.children as number[]) ?? [];
    for (const child of children)
      visit(child, identity, !external && ambiguous, children);
  };
  for (const root of roots) visit(root, "", false, roots);
  return result;
}

export interface SourceIdentityReport {
  matched: { previous: string; incoming: string }[];
  added: string[];
  unmatched: string[];
  ambiguous: string[];
}
/** Shared by model revisions and derived-asset admission. Render node indices are never identities. */
export function reconcileSourceIdentities(
  previous: readonly string[],
  incoming: readonly string[],
  explicit: Readonly<Record<string, string>> = {},
): SourceIdentityReport {
  const count = (keys: readonly string[]) => {
    const result = new Map<string, number>();
    for (const key of keys) result.set(key, (result.get(key) ?? 0) + 1);
    return result;
  };
  const old = count(previous),
    next = count(incoming),
    used = new Set<string>();
  const report: SourceIdentityReport = {
    matched: [],
    added: [],
    unmatched: [],
    ambiguous: [],
  };
  for (const key of previous) {
    const target = explicit[key] ?? key;
    if (
      (old.get(key) ?? 0) > 1 ||
      (next.get(target) ?? 0) > 1 ||
      used.has(target)
    )
      report.ambiguous.push(key);
    else if (
      !target ||
      (target.startsWith("unresolved:") && !explicit[key]) ||
      !next.has(target)
    )
      report.unmatched.push(key);
    else {
      report.matched.push({ previous: key, incoming: target });
      used.add(target);
    }
  }
  report.added = incoming.filter((key) => !used.has(key));
  return report;
}
export function assertIdentityPreserved(report: SourceIdentityReport): void {
  if (report.unmatched.length || report.ambiguous.length)
    throw Error("来源身份门禁失败：" + JSON.stringify(report));
}
