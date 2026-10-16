import { useMemo, useState } from "react";
import {
  createAction,
  createComponent,
  createEntity,
  getComponent,
  type JsonValue,
} from "../../scene-schema/src/index";
import type { ExtensionPanelProps } from "../editor-contract";
import { stages } from "./pose";
export function AssemblyPanel({
  document,
  selectedIds,
  mode,
  command,
  select,
  focus,
  dispatch,
  inspect,
}: ExtensionPanelProps) {
  const roots = document.entities.filter((e) =>
    getComponent(e, "studio.assembly.Root"),
  );
  const [choice, setChoice] = useState(""),
    [filter, setFilter] = useState("");
  const root =
    roots.find((e) => e.id === choice) ||
    roots.find((e) => selectedIds.includes(e.id)) ||
    roots[0];
  const groups = document.entities.filter(
    (e) => getComponent(e, "studio.assembly.Group")?.data.rootId === root?.id,
  );
  const parts = document.entities.filter((e) => {
    const c = getComponent(e, "studio.assembly.Part");
    return (
      c &&
      (c.data.groupId === root?.id ||
        groups.some((g) => g.id === c.data.groupId))
    );
  });
  const steps = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; start: number; end: number; parts: string[] }
    >();
    for (const part of parts)
      for (const stage of stages(
        getComponent(part, "studio.assembly.Part")?.data.stages,
      )) {
        const value = map.get(stage.id) ?? {
          id: stage.id,
          name: stage.name,
          start: stage.start,
          end: stage.end,
          parts: [],
        };
        value.parts.push(part.id);
        value.start = Math.min(value.start, stage.start);
        value.end = Math.max(value.end, stage.end);
        map.set(stage.id, value);
      }
    return [...map.values()].sort(
      (a, b) => a.start - b.start || a.id.localeCompare(b.id),
    );
  }, [document, root?.id]);
  if (!roots.length) return null;
  const selected = parts.filter((e) => selectedIds.includes(e.id));
  const run = (
    type: string,
    targetId: string,
    data: Record<string, JsonValue> = {},
  ) => {
    const action = createAction(type);
    action.targetId = targetId;
    Object.assign(action.data, data);
    void dispatch(action);
  };
  const reorder = (id: string, delta: number) =>
    command({
      label: "排列拆解步骤",
      mutate: (doc) => {
        const ordered = [...steps];
        const index = ordered.findIndex((s) => s.id === id),
          other = index + delta;
        if (index < 0 || other < 0 || other >= ordered.length) return;
        [ordered[index], ordered[other]] = [ordered[other], ordered[index]];
        const intervals = new Map(
          ordered.map((s, i) => [
            s.id,
            { start: i / ordered.length, end: (i + 1) / ordered.length },
          ]),
        );
        for (const part of doc.entities)
          for (const stage of stages(
            getComponent(part, "studio.assembly.Part")?.data.stages,
          )) {
            const interval = intervals.get(stage.id);
            if (interval) Object.assign(stage, interval);
          }
      },
    });
  return (
    <section className="kit-panel">
      <label>
        装配序列
        <select
          aria-label="装配序列"
          value={root.id}
          onChange={(e) => setChoice(e.target.value)}
        >
          {roots.map((root) => (
            <option key={root.id} value={root.id}>
              {root.name}
            </option>
          ))}
        </select>
      </label>
      <input
        aria-label="搜索 BOM"
        placeholder="零件号 / 名称 / 来源元素"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="kit-list" role="group" aria-label="BOM 零件">
        {parts
          .filter((e) =>
            (
              e.name +
              " " +
              JSON.stringify(getComponent(e, "studio.assembly.Part")?.data)
            )
              .toLowerCase()
              .includes(filter.toLowerCase()),
          )
          .map((part) => (
            <div key={part.id}>
              <label>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(part.id)}
                  onChange={(e) =>
                    select(
                      e.target.checked
                        ? [...selectedIds, part.id]
                        : selectedIds.filter((id) => id !== part.id),
                    )
                  }
                />
                {String(
                  getComponent(part, "studio.assembly.Part")!.data.partNo,
                ) || part.name}
              </label>
              <button onClick={() => focus([part.id])}>定位</button>
              <button onClick={() => inspect(part.id)}>编辑</button>
              {mode === "play" && (
                <button
                  onClick={() => run("studio.assembly.HighlightPart", part.id)}
                >
                  高亮
                </button>
              )}
            </div>
          ))}
      </div>
      <div className="button-group">
        <button
          disabled={mode === "play" || !selected.length}
          onClick={() =>
            command({
              label: "装配分组",
              mutate: (doc) => {
                const group = createEntity("装配组");
                const component = createComponent("studio.assembly.Group");
                component.data.rootId = root.id;
                group.components.push(component);
                doc.entities.push(group);
                for (const part of doc.entities.filter((e) =>
                  selectedIds.includes(e.id),
                )) {
                  const c = getComponent(part, "studio.assembly.Part");
                  if (c) c.data.groupId = group.id;
                }
              },
            })
          }
        >
          所选零件分组
        </button>
        <button
          disabled={mode === "play" || !selected.length}
          onClick={() =>
            command({
              label: "添加拆解步骤",
              mutate: (doc) => {
                const id = crypto.randomUUID();
                for (const part of doc.entities.filter((e) =>
                  selectedIds.includes(e.id),
                )) {
                  const c = getComponent(part, "studio.assembly.Part");
                  if (c) {
                    const values = stages(c.data.stages);
                    for (const old of values) {
                      old.start *= 0.75;
                      old.end *= 0.75;
                    }
                    values.push({
                      id,
                      name: "步骤 " + (steps.length + 1),
                      start: 0.75,
                      end: 1,
                      path: [[0, 500, 0]],
                      rotation: [0, 0, 0],
                      scale: [1, 1, 1],
                      easing: "smooth",
                      trail: false,
                      visibility: "inherit",
                    });
                    c.data.stages = values as unknown as JsonValue;
                  }
                }
              },
            })
          }
        >
          添加所选零件步骤
        </button>
      </div>
      <ol className="assembly-timeline" aria-label="拆解步骤时间线">
        {steps.map((step, index) => (
          <li key={step.id}>
            <button
              onClick={() => {
                select(step.parts);
                if (mode === "play")
                  run("studio.assembly.SelectStep", root.id, {
                    stepId: step.id,
                  });
              }}
            >
              {step.name} · {step.parts.length} 零件
            </button>
            <div
              className="timeline-range"
              style={{
                marginLeft: step.start * 100 + "%",
                width: (step.end - step.start) * 100 + "%",
              }}
            />
            <div className="button-group">
              <button
                disabled={mode === "play" || index === 0}
                onClick={() => reorder(step.id, -1)}
              >
                前移
              </button>
              <button
                disabled={mode === "play" || index === steps.length - 1}
                onClick={() => reorder(step.id, 1)}
              >
                后移
              </button>
              <button onClick={() => inspect(step.parts[0])}>
                路径 / 旋转 / 轨迹
              </button>
              <button
                disabled={mode === "play"}
                onClick={() =>
                  command({
                    label: "删除拆解步骤",
                    mutate: (doc) => {
                      for (const part of doc.entities) {
                        const c = getComponent(part, "studio.assembly.Part");
                        if (c)
                          c.data.stages = stages(c.data.stages).filter(
                            (s) => s.id !== step.id,
                          ) as unknown as JsonValue;
                      }
                    },
                  })
                }
              >
                移除步骤
              </button>
            </div>
          </li>
        ))}
      </ol>
      {mode === "play" && (
        <div className="button-group">
          <button onClick={() => run("studio.assembly.Play", root.id)}>
            播放序列
          </button>
          <button onClick={() => run("studio.assembly.Pause", root.id)}>
            暂停序列
          </button>
          <button onClick={() => run("studio.assembly.Restore", root.id)}>
            复原
          </button>
        </div>
      )}
      <p className="hint">
        路径点、局部旋转、缩放、缓动与可见性在零件步骤属性中编辑；相同进度从基准姿态求值。
      </p>
    </section>
  );
}
