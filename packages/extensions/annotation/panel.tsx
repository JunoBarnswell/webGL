import { useState } from "react";
import { getComponent, type Vec3 } from "../../scene-schema/src/index";
import {
  duplicateEntities,
  deleteEntities,
} from "../../editor-core/src/commands";
import type { ExtensionPanelProps } from "../editor-contract";
import { anchorProblem, resolveAnchor } from "./anchors";
export function AnnotationPanel({
  document,
  selectedIds,
  mode,
  command,
  select,
  placeAnchor,
  inspect,
  runtime,
  state,
}: ExtensionPanelProps) {
  const [filter, setFilter] = useState(""),
    [color, setColor] = useState("#56d6bd");
  const labels = document.entities.filter((e) =>
    getComponent(e, "studio.annotation.Label"),
  );
  if (!labels.length) return null;
  const selected = labels.filter((e) => selectedIds.includes(e.id));
  const problems = labels.flatMap((e) => {
    const c = getComponent(e, "studio.annotation.Label")!;
    const status = state.extensions["studio.annotation:" + e.id];
    const reason =
      anchorProblem(document, c, e.id) ||
      (status?.anchorState === "unresolved" ? String(status.reason) : "");
    return reason ? [{ entity: e, reason }] : [];
  });
  const align = (axis: 0 | 1) => {
    if (!runtime || selected.length < 2) return;
    const positions = selected.flatMap((e) => {
      const c = getComponent(e, "studio.annotation.Label")!,
        anchor = resolveAnchor(runtime, e.id, c);
      if (!anchor.world) return [];
      const projected = anchor.world.clone().project(runtime.engine.camera);
      const screen: Vec3 = [
        (projected.x * 0.5 + 0.5) * runtime.engine.container.clientWidth,
        (-projected.y * 0.5 + 0.5) * runtime.engine.container.clientHeight,
        0,
      ];
      const offset = c.data.offset as Vec3;
      return [{ id: e.id, value: screen[axis] + offset[axis] }];
    });
    if (!positions.length) return;
    const target = positions[0].value;
    command({
      label: "对齐空间标注",
      mutate: (doc) => {
        for (const item of positions) {
          const c = doc.entities
            .find((e) => e.id === item.id)
            ?.components.find((c) => c.type === "studio.annotation.Label");
          if (c) {
            const offset = [...(c.data.offset as Vec3)] as Vec3;
            offset[axis] += target - item.value;
            c.data.offset = offset;
          }
        }
      },
    });
  };
  return (
    <section className="kit-panel">
      <input
        aria-label="搜索空间标注"
        placeholder="名称 / 属性"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {problems.length > 0 && (
        <details open>
          <summary>待修复锚点 · {problems.length}</summary>
          {problems.map(({ entity, reason }) => (
            <div key={entity.id}>
              <span>
                {entity.name}：{reason}
              </span>
              <button
                disabled={mode === "play"}
                onClick={() => {
                  select([entity.id]);
                  placeAnchor(entity.id);
                }}
              >
                重新选面
              </button>
              <button onClick={() => inspect(entity.id)}>属性</button>
            </div>
          ))}
        </details>
      )}
      <div className="kit-list">
        {labels
          .filter((e) =>
            (e.name + " " + JSON.stringify(e.components))
              .toLowerCase()
              .includes(filter.toLowerCase()),
          )
          .map((e) => (
            <label key={e.id}>
              <input
                type="checkbox"
                checked={selectedIds.includes(e.id)}
                onChange={(event) =>
                  select(
                    event.target.checked
                      ? [...selectedIds, e.id]
                      : selectedIds.filter((id) => id !== e.id),
                  )
                }
              />
              {e.name}
              <button onClick={() => inspect(e.id)}>编辑</button>
              <button
                disabled={mode === "play"}
                onClick={() => placeAnchor(e.id)}
              >
                选面附着
              </button>
            </label>
          ))}
      </div>
      <fieldset disabled={mode === "play" || !selected.length}>
        <label>
          批量颜色
          <input
            type="color"
            aria-label="批量标签颜色"
            value={color}
            onChange={(event) => setColor(event.target.value)}
          />
        </label>
        <button
          onClick={() =>
            command({
              label: "标注样式模板",
              mutate: (doc) => {
                for (const entity of doc.entities.filter((e) =>
                  selectedIds.includes(e.id),
                )) {
                  const c = getComponent(entity, "studio.annotation.Label");
                  if (c)
                    Object.assign(c.data, {
                      color,
                      size: 14,
                      style: "callout",
                    });
                }
              },
            })
          }
        >
          应用引线样式
        </button>
        <button onClick={() => align(0)}>水平位置对齐</button>
        <button onClick={() => align(1)}>垂直位置对齐</button>
        <button
          onClick={() => command(duplicateEntities(selected.map((e) => e.id)))}
        >
          复制所选标签
        </button>
        <button
          onClick={() => command(deleteEntities(selected.map((e) => e.id)))}
        >
          删除所选标签
        </button>
      </fieldset>
      <p className="hint">
        编辑状态可直接拖动标签调整引线；Esc
        取消当前拖动。锚点版本不匹配时需重新选面，源数据不会被静默改写。
      </p>
    </section>
  );
}
