import { useMemo, useState } from "react";
import {
  createPrefabRevision,
  revisionFromInstance,
  recompilePrefabs,
  newPrefabInstance,
  instantiatePrefab,
  prefabForEntity,
  prefabSourcePath,
  applyPrefabUpdatePlan,
  type PrefabReferenceMigration,
  revertPrefabOverride,
  detachPrefab,
} from "../../editor-core/src/prefab";
import {
  prefabOverrideKey,
  type PrefabRevision,
} from "../../scene-schema/src/prefab";
import type { SceneDocument } from "../../scene-schema/src/types";
import type { ExtensionPanelProps } from "../editor-contract";
import { captureThumbnail, AssetThumbnail } from "../designer";
import { useLibrary, type LibraryRecord } from "../library";
import { usePrefabPlan } from "./usePrefabPlan";
type Definition = {
  rootLocalId: string;
  document: SceneDocument;
  category?: string;
  thumbnailAssetId?: string;
};
const revision = (record: LibraryRecord<Definition>): PrefabRevision => ({
  id: record.id,
  revisionId: record.versionId,
  name: record.name,
  ...record.document,
});
export function PrefabPanel(props: ExtensionPanelProps) {
  const { document, selectedIds, command, services, select } = props,
    library = useLibrary<Definition>("prefab", services);
  const [tab, setTab] = useState("library"),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(""),
    [name, setName] = useState("展台模板"),
    [category, setCategory] = useState("通用"),
    [filter, setFilter] = useState(""),
    [history, setHistory] = useState<LibraryRecord<Definition>[]>([]),
    [usage, setUsage] = useState<
      { ownerType: string; ownerId: string; versionId: string }[]
    >([]),
    [choices, setChoices] = useState<Record<string, "instance" | "source">>({}),
    [selectedInstances, setSelectedInstances] = useState<string[]>([]);
  const [migrations, setMigrations] = useState<PrefabReferenceMigration[]>([]),
    [sourcePath, setSourcePath] = useState(""),
    [impact, setImpact] = useState<{
      uses: {
        ownerType: string;
        ownerId: string;
        historical: boolean;
        requiresAncestorRevision: boolean;
        references: { path: string; ownerId: string }[];
      }[];
    } | null>(null);
  const record = library.items.find((i) => i.id === active) ?? library.items[0],
    instance = prefabForEntity(document, selectedIds[0]);
  const candidates = useMemo(
    () =>
      record
        ? (document.prefabs ?? []).filter((i) => i.prefabId === record.id)
        : [],
    [document.prefabs, record],
  );
  const currentRevision = useMemo(
    () => (record && tab === "diff" ? revision(record) : null),
    [record, tab],
  );
  const selectedCandidates = useMemo(
    () => selectedInstances.filter((id) => candidates.some((i) => i.id === id)),
    [selectedInstances, candidates],
  );
  const planning = usePrefabPlan(
      document,
      selectedCandidates,
      currentRevision,
      choices,
      migrations,
      services.analyze,
    ),
    conflicts = planning.plan?.conflicts ?? [];
  const ancestry = useMemo(
      () => prefabSourcePath(document, selectedIds[0] ?? ""),
      [document, selectedIds],
    ),
    sourceLevel =
      ancestry.find((level) => level.path === sourcePath) ?? ancestry[0];
  const run = (label: string, fn: () => Promise<void>) =>
    void services.run(label, fn);
  const applyFields = (keys: string[]) =>
    run("应用覆盖到源模板", async () => {
      if (!instance) throw Error("未选择实例");
      const source = library.items.find((i) => i.id === instance.prefabId);
      if (!source) throw Error("源模板未载入");
      const effective = revisionFromInstance(
        document,
        instance,
        source.name,
        keys,
      );
      await services.request("/library/prefab/" + source.id, {
        method: "PUT",
        body: JSON.stringify({
          name: source.name,
          expectedRevision: source.revision,
          document: {
            ...source.document,
            rootLocalId: effective.rootLocalId,
            document: effective.document,
          },
        }),
      });
      await library.refresh();
    });
  return (
    <div className="domain-designer prefab-designer">
      <nav className="designer-tabs">
        {[
          ["library", "模板库"],
          ["instance", "实例与覆盖"],
          ["diff", "三方 Diff"],
          ["history", "版本与使用位置"],
        ].map(([id, title]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {title}
          </button>
        ))}
      </nav>
      {services.sourceEditing && (
        <div className="source-breadcrumb">
          模板独立编辑中{" "}
          <button onClick={() => run("返回场景", services.returnToScene)}>
            保存并返回场景
          </button>
        </div>
      )}
      {tab === "library" && (
        <div className="designer-columns">
          <section>
            <input
              aria-label="模板搜索"
              placeholder="搜索模板"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              aria-label="模板分类筛选"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="">全部分类</option>
              {[
                ...new Set(
                  library.items.map((i) => i.document.category ?? "通用"),
                ),
              ].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <div className="library-grid">
              {library.items
                .filter(
                  (i) =>
                    i.name.toLowerCase().includes(query.toLowerCase()) &&
                    (!filter || (i.document.category ?? "通用") === filter),
                )
                .map((item) => (
                  <button
                    draggable
                    onDragStart={(event) => {
                      props.services.dragPrefab(revision(item));
                      event.dataTransfer.setData(
                        "application/x-studio-prefab",
                        JSON.stringify(revision(item)),
                      );
                    }}
                    onDragEnd={() => props.services.dragPrefab(null)}
                    key={item.id}
                    className={item.id === record?.id ? "active" : ""}
                    onClick={() => setActive(item.id)}
                  >
                    <AssetThumbnail
                      id={item.document.thumbnailAssetId ?? ""}
                      assets={item.document.document.assets}
                      services={services}
                      alt={item.name}
                    />
                    <strong>{item.name}</strong>
                    <small>
                      Revision {item.revision} ·{" "}
                      {new Date(item.updatedAt).toLocaleDateString()}
                    </small>
                  </button>
                ))}
            </div>
          </section>
          <section>
            <h3>从所选层级创建</h3>
            <input
              aria-label="模板名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              aria-label="模板分类"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
            <p>缩略图取自当前镜头；选择层级后可先聚焦再创建。</p>
            <button
              disabled={selectedIds.length !== 1}
              onClick={() =>
                run("创建预制体", async () => {
                  const source = createPrefabRevision(
                    document,
                    selectedIds[0],
                    name,
                  );
                  const thumbnail = await captureThumbnail(props, name);
                  source.document.assets.push(thumbnail);
                  const saved = await services.request<
                    LibraryRecord<Definition>
                  >("/library/prefab/" + source.id, {
                    method: "PUT",
                    body: JSON.stringify({
                      name,
                      expectedRevision: 0,
                      document: {
                        rootLocalId: source.rootLocalId,
                        document: source.document,
                        category,
                        thumbnailAssetId: thumbnail.id,
                      },
                    }),
                  });
                  const pinned = revision(saved),
                    i = newPrefabInstance(pinned);
                  for (const local of Object.keys(i.bindings.entity))
                    i.bindings.entity[local] = local;
                  const root = document.entities.find(
                    (e) => e.id === selectedIds[0],
                  )!;
                  i.transform = structuredClone(root.transform);
                  i.parentId = root.parentId;
                  i.name = root.name;
                  command({
                    kind: "prefab",
                    label: "创建预制体并链接源层级",
                    mutate(doc) {
                      (doc.prefabs ??= []).push(i);
                      recompilePrefabs(doc);
                    },
                  });
                  setActive(saved.id);
                  await library.refresh();
                })
              }
            >
              创建并链接为实例
            </button>
            {record && (
              <>
                <h3>{record.name}</h3>
                <div className="button-group">
                  <button
                    onClick={() => {
                      const result = instantiatePrefab(revision(record));
                      if (command(result.command))
                        select([
                          result.instance.bindings.entity[
                            result.instance.rootLocalId
                          ],
                        ]);
                    }}
                  >
                    实例化
                  </button>
                  <button
                    onClick={() =>
                      run("编辑模板源", () =>
                        services.editSource(
                          record as LibraryRecord<Definition>,
                        ),
                      )
                    }
                  >
                    3D 预览 / 隔离编辑源模板
                  </button>
                  <button
                    onClick={() =>
                      run("查询模板历史", async () => {
                        setHistory(
                          await services.request(
                            "/library/prefab/" + record.id + "/revisions",
                          ),
                        );
                        setUsage(
                          await services.request(
                            "/library/prefab/" + record.id + "/usage",
                          ),
                        );
                        setTab("history");
                      })
                    }
                  >
                    历史 / 使用位置
                  </button>
                </div>
                <p>
                  拖入视口可进行地面定位后一次提交；双击层级子节点即可设置局部覆盖。
                </p>
              </>
            )}
          </section>
        </div>
      )}
      {tab === "instance" &&
        (instance ? (
          <section>
            <fieldset>
              <legend>明确选择 Apply 的源祖先</legend>
              <select
                aria-label="Apply 源祖先"
                value={sourceLevel?.path ?? ""}
                onChange={(event) => setSourcePath(event.target.value)}
              >
                {ancestry.map((level, index) => (
                  <option key={level.path} value={level.path}>
                    {"↳ ".repeat(index)}
                    {level.instance.name} · {level.instance.prefabId}@
                    {level.instance.revisionId.slice(0, 8)}
                  </option>
                ))}
              </select>
              <p>
                保存子模板的新修订会保留父模板固定的旧修订。父模板需要单独更新并保存新修订。
              </p>
              <button
                disabled={!sourceLevel}
                onClick={() =>
                  run("应用到选定源祖先", async () => {
                    if (!sourceLevel) return;
                    const source = library.items.find(
                      (record) => record.id === sourceLevel.instance.prefabId,
                    );
                    if (!source) throw Error("选定源未载入");
                    const effective = revisionFromInstance(
                      sourceLevel.document,
                      sourceLevel.instance,
                      source.name,
                    );
                    await services.request("/library/prefab/" + source.id, {
                      method: "PUT",
                      body: JSON.stringify({
                        name: source.name,
                        expectedRevision: source.revision,
                        document: {
                          ...source.document,
                          rootLocalId: effective.rootLocalId,
                          document: effective.document,
                        },
                      }),
                    });
                    await library.refresh();
                  })
                }
              >
                将当前有效覆盖保存到选定源的新修订
              </button>
            </fieldset>
            <h3>
              {instance.name} · {instance.prefabId}@
              {instance.revisionId.slice(0, 8)}
            </h3>
            <div className="button-group">
              <button
                onClick={() => command(revertPrefabOverride(instance.id))}
              >
                恢复全部覆盖
              </button>
              <button onClick={() => command(detachPrefab(instance.id))}>
                拆离为普通层级
              </button>
              <button
                onClick={() => {
                  setActive(instance.prefabId);
                  setTab("diff");
                }}
              >
                对比源模板
              </button>
            </div>
            <p>
              {instance.overrides.length} 字段覆盖，{instance.additions.length}{" "}
              个新增，{instance.tombstones.length} 个删除覆盖
            </p>
            <table>
              <thead>
                <tr>
                  <th>LocalId / 字段</th>
                  <th>实例值</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {instance.overrides.map((o) => (
                  <tr key={prefabOverrideKey(o)}>
                    <td>
                      {o.localId} / {o.componentType} {o.path.join(".")}
                    </td>
                    <td>
                      <code>{JSON.stringify(o.value)}</code>
                    </td>
                    <td>
                      <button
                        onClick={() =>
                          command(
                            revertPrefabOverride(instance.id, [
                              prefabOverrideKey(o),
                            ]),
                          )
                        }
                      >
                        恢复此字段
                      </button>
                      <button
                        onClick={() => applyFields([prefabOverrideKey(o)])}
                      >
                        应用此字段到源
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h4>结构覆盖</h4>
            {instance.additions.map((e) => (
              <p key={e.id}>
                ＋ {e.name} · LocalId {e.id}
              </p>
            ))}
            {instance.tombstones.map((id) => (
              <p key={id}>− {id}</p>
            ))}
          </section>
        ) : (
          <p>
            在层级树或视口选择一个模板实例。字段变化自动记录为覆盖，新增和删除子节点也在同一撤销事务中记录。
          </p>
        ))}
      {tab === "diff" && (
        <section>
          <select
            aria-label="模板源"
            value={record?.id ?? ""}
            onChange={(e) => {
              setActive(e.target.value);
              setChoices({});
            }}
          >
            {library.items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
          <p>
            模板版本固定；升级不会修改未选中的实例或已发布项目。受影响的当前场景实例：
            {candidates.length}。
          </p>
          {candidates.map((i) => (
            <label key={i.id}>
              <input
                type="checkbox"
                checked={selectedInstances.includes(i.id)}
                onChange={(e) =>
                  setSelectedInstances(
                    e.target.checked
                      ? [...selectedInstances, i.id]
                      : selectedInstances.filter((id) => id !== i.id),
                  )
                }
              />
              {i.name} · {i.revisionId.slice(0, 8)} →{" "}
              {record?.versionId.slice(0, 8)}
            </label>
          ))}
          <table>
            <thead>
              <tr>
                <th>字段 / 结构</th>
                <th>旧基值</th>
                <th>最新模板</th>
                <th>实例覆盖</th>
                <th>冲突处理</th>
              </tr>
            </thead>
            <tbody>
              {conflicts.map((c) => (
                <tr key={c.instanceId + c.key}>
                  <td>
                    {c.localId} {c.field}
                  </td>
                  <td>
                    <code>{JSON.stringify(c.base)}</code>
                  </td>
                  <td>
                    <code>{JSON.stringify(c.source)}</code>
                  </td>
                  <td>
                    <code>{JSON.stringify(c.instance)}</code>
                  </td>
                  <td>
                    <select
                      value={choices[c.instanceId + ":" + c.key] ?? ""}
                      onChange={(e) =>
                        setChoices({
                          ...choices,
                          [c.instanceId + ":" + c.key]: e.target.value as
                            | "instance"
                            | "source",
                        })
                      }
                    >
                      <option value="">请选择</option>
                      <option value="instance">保留实例</option>
                      <option value="source">采用源模板</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="button-group">
            <span>
              {planning.status === "planning"
                ? "正在生成完整变更计划…"
                : planning.status === "cancelled"
                  ? "已取消计划，文档未修改"
                  : `${planning.plan?.changes.length ?? 0} 项源变更 · ${planning.plan?.impactedReferences.length ?? 0} 处引用影响`}
            </span>
            <button
              onClick={planning.cancel}
              disabled={planning.status !== "planning"}
            >
              取消计划
            </button>
            <button
              onClick={planning.retry}
              disabled={!selectedCandidates.length}
            >
              重新生成
            </button>
            <button
              disabled={!record}
              onClick={() =>
                record &&
                run("查询跨场景模板影响", async () =>
                  setImpact(
                    await services.request(
                      "/library/prefab/" +
                        record.id +
                        "/impact?version=" +
                        record.versionId,
                    ),
                  ),
                )
              }
            >
              查询跨场景影响
            </button>
          </div>
          {planning.error && <p role="alert">{planning.error}</p>}
          {planning.plan && (
            <>
              <details>
                <summary>完整源树、资源与嵌套修订 Diff</summary>
                <table>
                  <thead>
                    <tr>
                      <th>实例 / 类型</th>
                      <th>对象与字段</th>
                      <th>旧源</th>
                      <th>新源</th>
                    </tr>
                  </thead>
                  <tbody>
                    {planning.plan.changes.map((change, index) => (
                      <tr key={index}>
                        <td>
                          {change.instanceId.slice(0, 8)} · {change.kind}
                        </td>
                        <td>
                          {change.collection} / {change.localId} /{" "}
                          {change.path.join(".")}
                        </td>
                        <td>
                          <details>
                            <summary>旧值</summary>
                            <code>{JSON.stringify(change.base)}</code>
                          </details>
                        </td>
                        <td>
                          <details>
                            <summary>新值</summary>
                            <code>{JSON.stringify(change.source)}</code>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
              {planning.plan.impactedReferences.map((edge) => (
                <article key={edge.path}>
                  <strong>
                    {edge.ownerId} · {edge.componentType}
                  </strong>
                  <code>
                    {edge.path} → {edge.id}
                  </code>
                  <select
                    aria-label={"引用迁移 " + edge.path}
                    value={
                      migrations.find(
                        (m) => m.kind === edge.kind && m.fromId === edge.id,
                      )?.retain
                        ? "retain"
                        : (migrations.find(
                            (m) => m.kind === edge.kind && m.fromId === edge.id,
                          )?.toId ?? "")
                    }
                    onChange={(event) =>
                      setMigrations((previous) => [
                        ...previous.filter(
                          (m) => m.kind !== edge.kind || m.fromId !== edge.id,
                        ),
                        ...(event.target.value
                          ? [
                              {
                                kind: edge.kind,
                                fromId: edge.id,
                                ...(event.target.value === "retain"
                                  ? { retain: true }
                                  : { toId: event.target.value }),
                              },
                            ]
                          : []),
                      ])
                    }
                  >
                    <option value="">选择如何处理引用</option>
                    {edge.kind === "entity" && (
                      <option value="retain">
                        保留已删除节点为实例本地增项
                      </option>
                    )}
                    {(edge.kind === "entity"
                      ? document.entities
                      : edge.kind === "material"
                        ? document.materials
                        : edge.kind === "asset"
                          ? document.assets
                          : edge.kind === "content"
                            ? document.contents
                            : edge.kind === "viewpoint"
                              ? document.viewpoints
                              : edge.kind === "tour"
                                ? document.tours
                                : edge.kind === "ui"
                                  ? document.ui.nodes
                                  : edge.kind === "layout"
                                    ? document.ui.layouts
                                    : []
                    )
                      .filter((item) => item.id !== edge.id)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          重定向：{item.name}
                        </option>
                      ))}
                  </select>
                  <button
                    onClick={() => {
                      select([edge.ownerId]);
                      props.inspect(edge.ownerId);
                    }}
                  >
                    定位引用对象
                  </button>
                </article>
              ))}
              {planning.plan.validationErrors.map((error, i) => (
                <p className="danger" key={i}>
                  {error}
                </p>
              ))}
            </>
          )}
          {impact && (
            <details open>
              <summary>跨场景及历史固定修订影响</summary>
              {impact.uses.map((owner, i) => (
                <article key={i}>
                  {owner.ownerType} / {owner.ownerId} ·{" "}
                  {owner.historical ? "历史固定版本，保持原修订" : "草稿"}
                  {owner.requiresAncestorRevision ? " · 需创建父源新修订" : ""}
                  {owner.references.map((ref, i) => (
                    <code key={i}>
                      {ref.ownerId} {ref.path}
                    </code>
                  ))}
                </article>
              ))}
            </details>
          )}
          <button
            disabled={!planning.plan?.ready || planning.status !== "ready"}
            onClick={() =>
              planning.plan && command(applyPrefabUpdatePlan(planning.plan))
            }
          >
            原子升级所选实例（可撤销）
          </button>
          <button
            disabled={!instance || !record}
            onClick={() =>
              run("覆盖应用到源模板", async () => {
                if (!instance || !record) return;
                const effective = revisionFromInstance(
                  document,
                  instance,
                  record.name,
                );
                const body = effective.document;
                const saved = await services.request<LibraryRecord<Definition>>(
                  "/library/prefab/" + record.id,
                  {
                    method: "PUT",
                    body: JSON.stringify({
                      name: record.name,
                      expectedRevision: record.revision,
                      document: {
                        ...record.document,
                        rootLocalId: instance.rootLocalId,
                        document: body,
                      },
                    }),
                  },
                );
                await library.refresh();
                setActive(saved.id);
              })
            }
          >
            将当前实例制作为源新修订
          </button>
        </section>
      )}
      {tab === "history" && record && (
        <section>
          <h3>不可变模板修订</h3>
          {history.map((v) => (
            <div key={v.versionId}>
              <code>{v.versionId}</code> {v.updatedAt}
              <button
                onClick={() => {
                  const result = instantiatePrefab(
                    revision({ ...v, name: record.name }),
                  );
                  command(result.command);
                }}
              >
                固定此版实例化
              </button>
              <button
                onClick={() =>
                  run("回滚模板为新修订", async () => {
                    await services.request("/library/prefab/" + record.id, {
                      method: "PUT",
                      body: JSON.stringify({
                        name: record.name,
                        expectedRevision: record.revision,
                        document: v.document,
                      }),
                    });
                    await library.refresh();
                  })
                }
              >
                恢复为新修订
              </button>
            </div>
          ))}
          <h3>跨工程依赖位置</h3>
          {usage.map((u, index) => (
            <p key={index}>
              {u.ownerType} / {u.ownerId} @ {u.versionId}
            </p>
          ))}
          <button
            onClick={() =>
              run("删除模板", async () => {
                await services.request("/library/prefab/" + record.id, {
                  method: "DELETE",
                });
                await library.refresh();
              })
            }
          >
            删除未引用模板
          </button>
        </section>
      )}
      {library.error && <p role="alert">{library.error}</p>}
    </div>
  );
}
