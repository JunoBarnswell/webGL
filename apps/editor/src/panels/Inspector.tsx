import { editablePoint } from "../shell/DocumentPoint";
import { current as draftValue } from "immer";
import * as THREE from "three";
import {
  componentDefinitions,
  editField,
  declareExtension,
  createComponent,
  createMaterial,
  getComponent,
  materialFields,
  settingFields,
  type ComponentType,
  type Entity,
  type JsonValue,
  type FieldSchema,
} from "@studio/scene-schema";
import {
  prefabForEntity,
  revertPrefabOverride,
} from "../../../../packages/editor-core/src/prefab";
import { prefabOverrideKey } from "../../../../packages/scene-schema/src/prefab";
import { reparentEntity } from "@studio/editor-core";
import { useStudio } from "../state/studio";
import { Field, Fields, TextField } from "../components/Fields";
import { saveBlob } from "../state/api";

const vectorField: FieldSchema = {
  type: "array",
  "x-editor": "vector",
  items: { type: "number" },
};
export function Inspector() {
  const document = useStudio((s) => s.document),
    selected = useStudio((s) => s.selected),
    mode = useStudio((s) => s.mode),
    runtime = useStudio((s) => s.runtime),
    transforms = useStudio((s) => s.transforms);
  const entity = document?.entities.find((e) => e.id === selected[0]);
  const command = useStudio.getState().command;
  const instance = entity && prefabForEntity(document!, entity.id),
    localId =
      instance &&
      Object.keys(instance.bindings.entity).find(
        (id) => instance.bindings.entity[id] === entity?.id,
      );
  const overrides =
    instance?.overrides.filter((o) => o.localId === localId) ?? [];
  if (!document) return <div className="empty-state">打开工程后开始编辑</div>;
  const mutate = (label: string, fn: (current: Entity) => void) =>
    command({
      label,
      mutate: (doc) => {
        const current = doc.entities.find((e) => e.id === entity?.id);
        if (current) fn(current);
      },
    });
  const materialComponent =
    entity &&
    (getComponent(entity, "Mesh") ??
      getComponent(entity, "Model") ??
      getComponent(entity, "ModelNode"));
  const material = document.materials.find(
    (m) => m.id === materialComponent?.data.materialId,
  );
  const updateMaterial = (key: string, value: JsonValue) =>
    command({
      label: "修改材质",
      mutate: (doc) => {
        const current = doc.entities.find((e) => e.id === entity?.id);
        const component = current?.components.find(
          (c) => c.type === materialComponent?.type,
        );
        if (!component) return;
        let target = doc.materials.find(
          (m) => m.id === component.data.materialId,
        );
        if (!target) return;
        const users = doc.entities.reduce(
          (sum, e) =>
            sum +
            e.components.filter((c) => c.data.materialId === target!.id).length,
          0,
        );
        if (users > 1) {
          target = structuredClone(draftValue(target));
          target.id = crypto.randomUUID();
          target.name += " 副本";
          doc.materials.push(target);
          component.data.materialId = target.id;
        }
        Object.assign(target, { [key]: value });
      },
    });
  const transform = entity
    ? (transforms[entity.id] ?? entity.transform)
    : undefined;
  const angles = transform
    ? new THREE.Euler().setFromQuaternion(
        new THREE.Quaternion().fromArray(transform.rotation),
        "XYZ",
      )
    : new THREE.Euler();
  return (
    <section className="panel inspector">
      <div className="inspector-heading">
        <span className="section-kicker">
          {entity ? "当前节点" : "场景设置"}
        </span>
        <h2>{entity?.name ?? document.name}</h2>
        {selected.length > 1 && (
          <p>已选择 {selected.length} 个节点，视口变换同时应用</p>
        )}
      </div>
      {instance && (
        <details className="prefab-override-inspector" open>
          <summary>◇ 模板实例 · {overrides.length} 个字段覆盖</summary>
          <small>LocalId {localId}</small>
          {overrides.map((o) => (
            <div key={prefabOverrideKey(o)}>
              <span>
                ● {o.componentType} {o.path.join(".")}
              </span>
              <button
                disabled={mode === "play"}
                onClick={() =>
                  command(
                    revertPrefabOverride(instance.id, [prefabOverrideKey(o)]),
                  )
                }
              >
                恢复此字段
              </button>
            </div>
          ))}
          <button
            onClick={() => useStudio.getState().set({ workspace: "prefab" })}
          >
            打开实例与源模板 Diff
          </button>
        </details>
      )}
      <fieldset disabled={mode === "play" || Boolean(entity?.locked)}>
        {!entity ? (
          <>
            <button
              className="wide-button"
              disabled={!runtime}
              onClick={() => {
                const pose = useStudio.getState().view?.pose();
                if (!pose || !runtime) {
                  useStudio.getState().set({ message: "视口尚未就绪" });
                  return;
                }
                const far = runtime.engine.camera.far;
                command({
                  label: "记录初始视角",
                  mutate: (doc) => {
                    Object.assign(doc.settings, pose, { far });
                  },
                });
              }}
            >
              将当前画面设为初始视角
            </button>
            <label className="field">
              <span>场景名称</span>
              <TextField
                label="场景名称"
                value={document.name}
                onChange={(value) =>
                  command({
                    label: "修改场景名称",
                    mutate: (doc) => {
                      doc.name = value;
                    },
                  })
                }
              />
            </label>
            <Fields
              fields={settingFields}
              value={document.settings as unknown as Record<string, JsonValue>}
              path="settings"
              onChange={(key, value) =>
                command({
                  label: "修改场景设置",
                  mutate: (doc) =>
                    Object.assign(doc.settings, { [key]: value }),
                })
              }
            />
          </>
        ) : (
          <>
            <label className="field">
              <span>名称</span>
              <TextField
                label="节点名称"
                value={entity.name}
                onChange={(value) =>
                  mutate("重命名节点", (current) => {
                    current.name = value;
                  })
                }
              />
            </label>
            <label className="field">
              <span>父节点</span>
              <select
                aria-label="父节点"
                value={entity.parentId ?? ""}
                onChange={(event) =>
                  command(reparentEntity(entity.id, event.target.value || null))
                }
              >
                <option value="">场景根</option>
                {document.entities
                  .filter((e) => e.id !== entity.id)
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
              </select>
            </label>
            <details open>
              <summary>
                局部变换 <small>mm / °</small>
              </summary>
              <Field
                field={{ ...vectorField, title: "位置" }}
                value={transform!.position}
                path="position"
                onChange={(value) =>
                  mutate("修改位置", (current) => {
                    current.transform.position = value as [
                      number,
                      number,
                      number,
                    ];
                  })
                }
              />
              <Field
                field={{ ...vectorField, title: "旋转" }}
                value={[angles.x, angles.y, angles.z].map(
                  THREE.MathUtils.radToDeg,
                )}
                path="rotation"
                onChange={(value) =>
                  mutate("修改旋转", (current) => {
                    const degrees = value as number[];
                    current.transform.rotation = new THREE.Quaternion()
                      .setFromEuler(
                        new THREE.Euler(
                          ...(degrees.map(THREE.MathUtils.degToRad) as [
                            number,
                            number,
                            number,
                          ]),
                        ),
                      )
                      .normalize()
                      .toArray() as [number, number, number, number];
                  })
                }
              />
              <Field
                field={{ ...vectorField, title: "缩放" }}
                value={transform!.scale}
                path="scale"
                onChange={(value) =>
                  mutate("修改缩放", (current) => {
                    current.transform.scale = value as [number, number, number];
                  })
                }
              />
            </details>
            {entity.components.map((component) => {
              const definition = componentDefinitions.find(
                (d) => d.type === component.type,
              );
              if (!definition)
                return (
                  <details key={component.type}>
                    <summary>缺失扩展：{component.type}</summary>
                    <p>原始数据已保留，发布前须恢复扩展。</p>
                    <pre>{JSON.stringify(component.data, null, 2)}</pre>
                  </details>
                );
              const task = (
                {
                  Artwork: "content",
                  Hotspot: "content",
                  Cruise: "tour",
                  Zone: "tour",
                } as const
              )[component.type as "Artwork" | "Hotspot" | "Cruise" | "Zone"];
              return (
                <details open key={component.type}>
                  <summary>
                    {definition.title}
                    <label
                      className="component-enabled"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <input
                        aria-label={definition.title + " 启用"}
                        disabled={component.type === "ModelNode"}
                        type="checkbox"
                        checked={component.enabled}
                        onChange={(event) =>
                          mutate("切换组件", (current) => {
                            current.components.find(
                              (c) => c.type === component.type,
                            )!.enabled = event.target.checked;
                          })
                        }
                      />
                    </label>
                  </summary>
                  {task && (
                    <button
                      className="wide-button"
                      onClick={() =>
                        useStudio.getState().set({ workspace: task })
                      }
                    >
                      打开{task === "content" ? "热点内容" : "导览巡航"}工作区
                    </button>
                  )}
                  <Fields
                    fields={definition.fields}
                    value={component.data}
                    path={component.type}
                    onSpatialEdit={(path, _value, space, targetField) =>
                      useStudio.getState().set({
                        editingPoint: editablePoint(
                          document,
                          [
                            "entities",
                            { id: entity.id },
                            "components",
                            { type: component.type },
                            "data",
                            ...path,
                          ],
                          definition.title + " · 路径点",
                          space,
                          entity.id,
                          targetField,
                        ),
                        tool: "translate",
                      })
                    }
                    onChange={(key, value) =>
                      mutate("修改" + definition.title, (current) => {
                        editField(
                          current.components.find(
                            (c) => c.type === component.type,
                          )!.data,
                          definition.fields,
                          key,
                          value,
                        );
                      })
                    }
                  />
                  {component.type === "Panorama" && (
                    <button
                      className="wide-button"
                      onClick={() =>
                        void useStudio.getState().run("导出全景", async () => {
                          if (runtime)
                            saveBlob(
                              await runtime.snapshot(entity.id),
                              "panorama.png",
                            );
                        })
                      }
                    >
                      导出全景快照
                    </button>
                  )}
                  <button
                    disabled={component.type === "ModelNode"}
                    className="text-button danger"
                    onClick={() =>
                      mutate("移除组件", (current) => {
                        current.components = current.components.filter(
                          (c) => c.type !== component.type,
                        );
                      })
                    }
                  >
                    移除组件
                  </button>
                </details>
              );
            })}
            <select
              aria-label="添加组件"
              className="add-component"
              value=""
              onChange={(event) => {
                const type = event.target.value as ComponentType;
                if (type)
                  command({
                    label: "添加组件",
                    mutate: (doc) => {
                      declareExtension(doc, type);
                      doc.entities
                        .find((e) => e.id === entity.id)!
                        .components.push(createComponent(type));
                    },
                  });
              }}
            >
              <option value="">＋ 添加组件</option>
              {componentDefinitions
                .filter(
                  (d) => !entity.components.some((c) => c.type === d.type),
                )
                .map((d) => (
                  <option key={d.type} value={d.type}>
                    {d.title}
                  </option>
                ))}
            </select>
            {materialComponent && (
              <details open>
                <summary>材质</summary>
                {!material ? (
                  <button
                    className="wide-button"
                    onClick={() =>
                      command({
                        label: "创建材质",
                        mutate: (doc) => {
                          const target = createMaterial("新材质");
                          doc.materials.push(target);
                          doc.entities
                            .find((e) => e.id === entity.id)!
                            .components.find(
                              (c) => c.type === materialComponent.type,
                            )!.data.materialId = target.id;
                        },
                      })
                    }
                  >
                    创建独立材质
                  </button>
                ) : (
                  <>
                    <p className="hint">修改时自动分离共享材质</p>
                    <Fields
                      fields={Object.fromEntries(
                        Object.entries(materialFields).filter(
                          ([key]) =>
                            !["id", "maps", "envAssetIds"].includes(key),
                        ),
                      )}
                      value={material as unknown as Record<string, JsonValue>}
                      path="material"
                      onChange={updateMaterial}
                    />
                    {Object.entries(material.maps).map(([key, binding]) => (
                      <details key={key} open>
                        <summary>{key}</summary>
                        <Field
                          field={{
                            type: "string",
                            title: "贴图资源",
                            "x-reference": "asset",
                            "x-asset-kind": "image",
                          }}
                          value={binding.assetId}
                          path={"map." + key}
                          onChange={(value) =>
                            updateMaterial("maps", {
                              ...material.maps,
                              [key]: { ...binding, assetId: String(value) },
                            } as unknown as JsonValue)
                          }
                        />
                        {(["offset", "repeat"] as const).map((property) => (
                          <Field
                            key={property}
                            field={{
                              ...vectorField,
                              title: property === "offset" ? "偏移" : "平铺",
                            }}
                            value={binding[property]}
                            path={key + "." + property}
                            onChange={(value) =>
                              updateMaterial("maps", {
                                ...material.maps,
                                [key]: { ...binding, [property]: value },
                              } as unknown as JsonValue)
                            }
                          />
                        ))}
                        <button
                          className="text-button danger"
                          onClick={() => {
                            const maps = { ...material.maps };
                            delete maps[key];
                            updateMaterial(
                              "maps",
                              maps as unknown as JsonValue,
                            );
                          }}
                        >
                          移除贴图
                        </button>
                      </details>
                    ))}
                    <select
                      aria-label="添加材质贴图"
                      value=""
                      onChange={(event) => {
                        if (event.target.value)
                          updateMaterial("maps", {
                            ...material.maps,
                            [event.target.value]: {
                              assetId:
                                document.assets.find(
                                  (a) =>
                                    a.kind === "texture" || a.kind === "image",
                                )?.id ?? "",
                              offset: [0, 0],
                              repeat: [1, 1],
                              rotation: 0,
                              channel:
                                event.target.value === "lightMap" ? 1 : 0,
                              flipY: event.target.value !== "lightMap",
                              colorSpace:
                                event.target.value === "map"
                                  ? "srgb"
                                  : "linear",
                            },
                          } as unknown as JsonValue);
                      }}
                    >
                      <option value="">＋ 添加贴图通道</option>
                      {[
                        "map",
                        "normalMap",
                        "lightMap",
                        "emissiveMap",
                        "roughnessMap",
                        "metalnessMap",
                        "aoMap",
                        "alphaMap",
                      ]
                        .filter((key) => !material.maps[key])
                        .map((key) => (
                          <option key={key}>{key}</option>
                        ))}
                    </select>
                  </>
                )}
              </details>
            )}
            <p className="entity-id">
              ID {entity.id}
              {entity.legacyUuid && (
                <>
                  <br />
                  来源 UUID {entity.legacyUuid}
                </>
              )}
            </p>
          </>
        )}
      </fieldset>
      <button
        className="text-button"
        onClick={() => useStudio.getState().select([])}
      >
        编辑场景设置
      </button>
    </section>
  );
}
