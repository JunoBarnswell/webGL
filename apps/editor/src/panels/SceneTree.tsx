import { ExtensionTools } from "../extensions/ExtensionTools";
import * as THREE from "three";
import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  LockKeyhole,
  Plus,
  Search,
  Trash2,
  UnlockKeyhole,
  Box,
  Layers,
} from "lucide-react";
import { createEntity, getComponent, type Entity } from "@studio/scene-schema";
import {
  addEntity,
  deleteEntities,
  duplicateEntities,
  reparentEntity,
} from "@studio/editor-core";
import { AssetThumbnail } from "../components/AssetThumbnail";
import { useStudio } from "../state/studio";
export function SceneTree() {
  const document = useStudio((s) => s.document),
    selected = useStudio((s) => s.selected),
    mode = useStudio((s) => s.mode);
  const [search, setSearch] = useState(""),
    [collapsed, setCollapsed] = useState(new Set<string>());
  const index = useMemo(
    () => new Map(document?.entities.map((e) => [e.id, e]) ?? []),
    [document?.entities],
  );
  const prefabOwners = useMemo(
    () =>
      new Map(
        (document?.prefabs ?? []).flatMap((instance) =>
          Object.entries(instance.bindings.entity).map(
            ([local, id]) => [id, { instance, local }] as const,
          ),
        ),
      ),
    [document?.prefabs],
  );
  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, Entity[]>();
    for (const entity of document?.entities ?? []) {
      const group = map.get(entity.parentId) ?? [];
      group.push(entity);
      map.set(entity.parentId, group);
    }
    return map;
  }, [document?.entities]);
  const title = (entity: Entity) => {
    const contentId = entity.components.find((c) =>
      ["Artwork", "Hotspot"].includes(c.type),
    )?.data.contentId;
    return (
      document?.contents.find((c) => c.id === contentId)?.title ||
      entity.name ||
      "未命名节点"
    );
  };
  const matches = useMemo(() => {
    const result = new Set<string>();
    if (!document) return result;
    for (const entity of document.entities)
      if (
        (
          entity.name +
          " " +
          title(entity) +
          " " +
          entity.components.map((c) => c.type).join(" ")
        )
          .toLowerCase()
          .includes(search.toLowerCase()) ||
        entity.legacyUuid.toLowerCase().includes(search.toLowerCase())
      ) {
        let current: Entity | undefined = entity;
        while (current) {
          result.add(current.id);
          current = index.get(current.parentId ?? "");
        }
      }
    return result;
  }, [document, search, index]);
  const command = useStudio.getState().command;
  const row = (entity: Entity, depth: number): React.ReactNode => {
    if (!matches.has(entity.id)) return null;
    const children = childrenByParent.get(entity.id) ?? [];
    const closed = collapsed.has(entity.id) && !search;
    const contentId = entity.components.find((c) =>
      ["Artwork", "Hotspot"].includes(c.type),
    )?.data.contentId;
    const content = document?.contents.find((c) => c.id === contentId),
      asset = document?.assets.find((a) => a.id === content?.imageAssetId);
    return (
      <div
        key={entity.id}
        role="treeitem"
        aria-expanded={children.length ? !closed : undefined}
        aria-selected={selected.includes(entity.id)}
      >
        <div
          className={
            "tree-row " +
            (selected.includes(entity.id) ? "selected " : "") +
            (!entity.visible ? "muted" : "")
          }
          style={{ paddingLeft: 8 + depth * 14 }}
          draggable={mode === "edit" && !entity.locked}
          onDragStart={(event) => {
            event.dataTransfer.setData("studio/entity", entity.id);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const id = event.dataTransfer.getData("studio/entity");
            if (id) command(reparentEntity(id, entity.id));
          }}
        >
          <button
            className="disclosure icon-button"
            aria-label={(closed ? "展开 " : "折叠 ") + entity.name}
            onClick={() =>
              setCollapsed((previous) => {
                const next = new Set(previous);
                if (next.has(entity.id)) next.delete(entity.id);
                else next.add(entity.id);
                return next;
              })
            }
          >
            {children.length ? (
              closed ? (
                <ChevronRight />
              ) : (
                <ChevronDown />
              )
            ) : null}
          </button>
          <button
            className="tree-label"
            title={entity.legacyUuid || entity.id}
            onClick={(event) =>
              useStudio
                .getState()
                .select(
                  [entity.id],
                  event.ctrlKey || event.metaKey || event.shiftKey,
                )
            }
          >
            {asset ? (
              <AssetThumbnail asset={asset} />
            ) : getComponent(entity, "Mesh") ||
              getComponent(entity, "Model") ||
              getComponent(entity, "ModelNode") ? (
              <Box />
            ) : (
              <Layers />
            )}
            <span>
              {title(entity)}
              {prefabOwners.has(entity.id) && (
                <small
                  className="prefab-badge"
                  title={
                    "Instance of " +
                    prefabOwners.get(entity.id)!.instance.prefabId +
                    "@" +
                    prefabOwners.get(entity.id)!.instance.revisionId
                  }
                >
                  ◇
                  {prefabOwners
                    .get(entity.id)!
                    .instance.overrides.some(
                      (o) => o.localId === prefabOwners.get(entity.id)!.local,
                    )
                    ? "•"
                    : ""}
                </small>
              )}
            </span>
            <small className="tree-type">
              {content
                ? "作品"
                : getComponent(entity, "Model")
                  ? "模型"
                  : getComponent(entity, "Mesh")
                    ? "网格"
                    : "对象"}
            </small>
          </button>
          <button
            className="icon-button row-action"
            title={entity.visible ? "隐藏" : "显示"}
            aria-label={(entity.visible ? "隐藏 " : "显示 ") + entity.name}
            disabled={mode === "play"}
            onClick={() =>
              command({
                label: "切换可见性",
                mutate: (doc) => {
                  doc.entities.find((e) => e.id === entity.id)!.visible =
                    !entity.visible;
                },
              })
            }
          >
            {entity.visible ? <Eye /> : <EyeOff />}
          </button>
          <button
            className="icon-button row-action"
            title={entity.locked ? "解锁" : "锁定"}
            aria-label={(entity.locked ? "解锁 " : "锁定 ") + entity.name}
            disabled={mode === "play"}
            onClick={() =>
              command({
                label: "切换锁定",
                mutate: (doc) => {
                  doc.entities.find((e) => e.id === entity.id)!.locked =
                    !entity.locked;
                },
              })
            }
          >
            {entity.locked ? <LockKeyhole /> : <UnlockKeyhole />}
          </button>
        </div>
        {!closed && children.map((child) => row(child, depth + 1))}
      </div>
    );
  };
  return (
    <section className="panel tree-panel">
      <ExtensionTools />
      <div className="panel-toolbar">
        <span>{document?.entities.length ?? 0} 个节点</span>
        <div className="button-group">
          <button
            className="icon-button"
            title="新增节点"
            aria-label="新增节点"
            disabled={mode === "play"}
            onClick={() => {
              const parentId = selected[0] ?? null;
              const entity = createEntity("新节点", parentId);
              const parent = parentId
                ? useStudio.getState().runtime?.getObject(parentId)
                : undefined;
              if (parent) {
                const bounds = new THREE.Box3().setFromObject(parent);
                if (!bounds.isEmpty())
                  entity.transform.position = parent
                    .worldToLocal(bounds.getCenter(new THREE.Vector3()))
                    .toArray();
              }
              command(addEntity(entity));
              useStudio.getState().select([entity.id]);
            }}
          >
            <Plus />
          </button>
          <button
            className="icon-button"
            title="复制节点"
            aria-label="复制节点"
            disabled={!selected.length || mode === "play"}
            onClick={() => command(duplicateEntities(selected))}
          >
            <Copy />
          </button>
          <button
            className="icon-button"
            title="删除节点"
            aria-label="删除节点"
            disabled={!selected.length || mode === "play"}
            onClick={() => {
              command(deleteEntities(selected));
              useStudio.getState().select([]);
            }}
          >
            <Trash2 />
          </button>
        </div>
      </div>
      <label className="search-field">
        <Search />
        <input
          aria-label="搜索场景节点"
          placeholder="搜索名称或原 UUID"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <div
        className="tree-content"
        role="tree"
        aria-label="场景层级"
        aria-multiselectable
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          const id = event.dataTransfer.getData("studio/entity");
          if (id) command(reparentEntity(id, null));
        }}
      >
        {(childrenByParent.get(null) ?? []).map((entity) => row(entity, 0))}
        {!document?.entities.length && (
          <div className="empty-state">导入模型，或创建第一个节点</div>
        )}
      </div>
    </section>
  );
}
