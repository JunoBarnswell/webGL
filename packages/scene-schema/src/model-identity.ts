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
