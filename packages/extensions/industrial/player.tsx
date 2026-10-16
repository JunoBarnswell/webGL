import { useEffect, useState } from "react";
import { getComponent } from "../../scene-schema/src/index";
import type { PlayerWidget, PlayerWidgetProps } from "../player-contract";
import type IndustrialSystem from "./runtime";
import type { IndustrialReview, SemanticPage } from "./core";
function IndustrialWidget({
  document,
  runtime,
  node,
  design,
}: PlayerWidgetProps) {
  useEffect(
    () => () => runtime?.visual.reset("industrial:selection"),
    [runtime],
  );
  const entity =
      document.entities.find(
        (e) =>
          e.id === node?.targetId &&
          getComponent(e, "studio.industrial.Review"),
      ) ??
      document.entities.find((e) =>
        getComponent(e, "studio.industrial.Review"),
      ),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0),
    [data, setData] = useState<SemanticPage | null>(null),
    [error, setError] = useState(""),
    [selected, setSelected] = useState("");
  const review = entity
      ? (getComponent(entity, "studio.industrial.Review")!
          .data as unknown as IndustrialReview)
      : null,
    system = runtime?.systems.find((s) => s.id === "studio.industrial") as
      | IndustrialSystem
      | undefined;
  useEffect(() => {
    if (!entity || !review?.semanticAssetId || !system || design) return;
    const abort = new AbortController(),
      timer = setTimeout(() => {
        void system
          .query(
            entity.id,
            {
              q: query,
              page: String(page),
              filters: JSON.stringify(review.filters),
            },
            abort.signal,
          )
          .then(setData)
          .catch((error) => {
            if (!abort.signal.aborted) setError(String(error));
          });
      }, 180);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [entity?.id, review?.semanticAssetId, query, page, system, design]);
  if (!review || !entity) return null;
  const record = data?.items.find((r) => r.sourceElementId === selected);
  return (
    <section className="industrial-player" aria-label="工业资产审阅">
      <h3>设备与来源属性</h3>
      <input
        aria-label="搜索设备"
        value={query}
        placeholder="设备编号 / 来源属性"
        onChange={(e) => {
          setQuery(e.target.value);
          setPage(0);
        }}
      />
      <div className="industrial-records">
        {data?.items.map((record) => (
          <button
            key={record.sourceElementId}
            onClick={() => {
              setSelected(record.sourceElementId);
              const ids = document.entities
                .filter(
                  (e) =>
                    getComponent(e, "ModelNode")?.data.sourceElementId ===
                    record.sourceElementId,
                )
                .map((e) => e.id);
              runtime?.visual.highlight("industrial:selection", ids);
              if (ids.length) void runtime?.focusObjects(ids);
            }}
          >
            {record.name} · {record.classId}
          </button>
        ))}
      </div>
      <div className="player-action-row">
        <button disabled={!page} onClick={() => setPage(page - 1)}>
          上一页
        </button>
        <small>{data?.total ?? 0} 项</small>
        <button
          disabled={!data || (page + 1) * data.pageSize >= data.total}
          onClick={() => setPage(page + 1)}
        >
          下一页
        </button>
      </div>
      {record && (
        <details open>
          <summary>{record.name} · 来源属性</summary>
          <dl>
            {Object.entries(record.properties).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>
                  {typeof value === "object"
                    ? JSON.stringify(value)
                    : String(value)}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      <nav aria-label="保存视图">
        {review.views.map((view) => (
          <button
            key={view.id}
            disabled={design}
            onClick={() =>
              void system
                ?.apply(entity.id, view)
                .catch((error) => setError(String(error)))
            }
          >
            {view.name}
          </button>
        ))}
      </nav>
      <button disabled={design} onClick={() => system?.reset(entity.id)}>
        恢复完整模型
      </button>
      {review.measurements.length > 0 && (
        <small>测量基于当前网格精度，不作为工程认证尺寸。</small>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
export const widgets: PlayerWidget[] = [
  {
    kind: "industrial",
    title: "工业审阅清单",
    componentType: "studio.industrial.Review",
    Component: IndustrialWidget,
  },
];
