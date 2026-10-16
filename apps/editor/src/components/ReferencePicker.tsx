import { createContext, useContext, useMemo, useState } from "react";
import {
  getComponent,
  type SceneAsset,
  type ReferenceKind,
} from "@studio/scene-schema";
import { useStudio } from "../state/studio";

export const ReferenceAssets = createContext<SceneAsset[] | null>(null);
export function ReferencePicker({
  kind,
  value,
  onChange,
  label,
  components = [],
  assetKind = "",
  pick = true,
}: {
  kind: ReferenceKind;
  value: string;
  onChange: (id: string) => void;
  label: string;
  components?: string[];
  assetKind?: string;
  pick?: boolean;
}) {
  const document = useStudio((s) => s.document),
    scopedAssets = useContext(ReferenceAssets),
    assets = scopedAssets ?? document?.assets ?? [],
    [query, setQuery] = useState("");
  const options = useMemo(() => {
    if (!document) return [];
    const lists = {
      entity: document.entities,
      asset: assets,
      material: document.materials,
      content: document.contents,
      viewpoint: document.viewpoints,
      tour: document.tours,
      variable: document.variables,
      ui: document.ui.nodes,
      layout: document.ui.layouts,
    };
    return lists[kind].filter((item) => {
      if (
        kind === "entity" &&
        components.length &&
        !document.entities
          .find((e) => e.id === item.id)
          ?.components.some((c) => c.enabled && components.includes(c.type))
      )
        return false;
      if (kind === "asset" && assetKind) {
        const asset = assets.find((a) => a.id === item.id);
        if (
          asset?.kind !== assetKind &&
          !(assetKind === "image" && asset?.kind === "texture")
        )
          return false;
      }
      return (
        !query ||
        item.id === value ||
        (item.name + " " + item.id).toLowerCase().includes(query.toLowerCase())
      );
    });
  }, [
    document,
    scopedAssets,
    kind,
    components.join(","),
    assetKind,
    query,
    value,
  ]);
  return (
    <div className="reference-picker">
      <label className="field stacked">
        <span>{label}</span>
        <div className="reference-search">
          <input
            type="search"
            aria-label={"搜索" + label}
            placeholder="搜索名称…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {kind === "entity" && pick && (
            <button
              title="在视口点击目标"
              onClick={() =>
                useStudio.getState().set({
                  pickEntity: (id) => {
                    const entity = useStudio
                      .getState()
                      .document?.entities.find((e) => e.id === id);
                    if (
                      components.length &&
                      !components.some(
                        (type) =>
                          entity &&
                          getComponent(
                            entity,
                            type as Parameters<typeof getComponent>[1],
                          ),
                      )
                    ) {
                      useStudio
                        .getState()
                        .set({ message: "所选对象不具备此动作需要的能力" });
                      return;
                    }
                    onChange(id);
                  },
                })
              }
            >
              拾取
            </button>
          )}
        </div>
        <select
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">请选择…</option>
          {options.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name || item.id}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
