import { RuleDesigner, ConfigurationAnalysis } from "./analysis-panel";
import { useState } from "react";
import {
  createUiNode,
  getComponent,
  type JsonValue,
} from "../../scene-schema/src/index";
import { useDomainEntity } from "../designer";
import type { ExtensionPanelProps } from "../editor-contract";
import { useLibrary, type LibraryRecord } from "../library";
import {
  validateCatalog,
  type ProductCatalog,
  type ProductOption,
} from "./core";
export function ConfiguratorPanel(props: ExtensionPanelProps) {
  const domain = useDomainEntity<ProductCatalog>(
      "studio.configurator.Catalog",
      props,
    ),
    { data, entity } = domain,
    [tab, setTab] = useState("groups"),
    library = useLibrary<ProductCatalog>("catalog", props.services),
    [version, setVersion] = useState<LibraryRecord<ProductCatalog> | null>(
      null,
    );
  const addSample = (name: string) =>
    domain.create(name, (d) => {
      d.name = name;
      d.catalogId = crypto.randomUUID();
      const groupId = crypto.randomUUID();
      d.groups = [
        {
          id: groupId,
          name: "外观颜色",
          control: "swatch",
          min: 1,
          max: 1,
          defaultIds: [],
          options: ["#db493f", "#306dcc", "#d7dee6"].map((color, i) => ({
            id: crypto.randomUUID(),
            name: ["红色", "蓝色", "银色"][i],
            color,
            sku: name + "-" + i,
            imageAssetId: "",
            description: "产品色卡",
            bom: [{ partId: name + "-BODY", quantity: 1 }],
            visuals: (props.selectedIds.filter((id) =>
              props.document.entities
                .find((e) => e.id === id)
                ?.components.some((c) =>
                  ["Mesh", "Model", "ModelNode"].includes(c.type),
                ),
            ).length
              ? props.selectedIds.filter((id) =>
                  props.document.entities
                    .find((e) => e.id === id)
                    ?.components.some((c) =>
                      ["Mesh", "Model", "ModelNode"].includes(c.type),
                    ),
                )
              : props.document.entities
                  .filter((e) =>
                    e.components.some((c) =>
                      ["Mesh", "Model"].includes(c.type),
                    ),
                  )
                  .slice(0, 1)
                  .map((e) => e.id)
            ).map((targetId) => ({
              id: crypto.randomUUID(),
              targetId,
              operation: "color" as const,
              value: color,
              assetId: "",
              variant: "",
              transform: {
                position: [0, 0, 0],
                rotation: [0, 0, 0, 1],
                scale: [1, 1, 1],
              },
              camera: { position: [0, 1000, 3000], target: [0, 0, 0], fov: 60 },
            })),
          })),
        },
      ];
      d.groups[0].defaultIds = [d.groups[0].options[0].id];
    });
  return (
    <div className="domain-designer">
      <div className="designer-toolbar">
        <select
          aria-label="产品目录"
          value={entity?.id ?? ""}
          onChange={(e) => domain.choose(e.target.value)}
        >
          {domain.entities.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <button onClick={() => domain.create("产品目录")}>新建产品</button>
        <button onClick={() => addSample("汽车外观")}>汽车产品档案</button>
        <button onClick={() => addSample("工业设备")}>设备产品档案</button>
      </div>
      <nav className="designer-tabs">
        {[
          ["groups", "属性与选项"],
          ["bindings", "模型绑定"],
          ["rules", "兼容规则"],
          ["ui", "配置器界面"],
          ["validation", "验证与版本"],
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
      {data && entity && (
        <>
          {tab === "groups" && (
            <>
              <p>目录修订 {data.libraryVersionId || "未保存目录库"}</p>
              {domain.fields(["name", "revision", "market", "groups"])}
            </>
          )}
          {tab === "bindings" && (
            <section>
              <p>
                先在视口或层级选择稳定实体，再绑定选项。材质、变体与零件替换均通过同一视觉态系统应用。
              </p>
              {data.groups.map((group) => (
                <fieldset key={group.id}>
                  <legend>{group.name}</legend>
                  {group.options.map((option: ProductOption) => (
                    <div key={option.id}>
                      <strong>{option.name}</strong>
                      <button
                        disabled={
                          !props.selectedIds.some((id) => id !== entity.id)
                        }
                        onClick={() =>
                          domain.mutate("绑定产品选项到实体", (catalog) => {
                            const target = catalog.groups
                              .find((g) => g.id === group.id)!
                              .options.find((o) => o.id === option.id)!;
                            for (const targetId of props.selectedIds.filter(
                              (id) => id !== entity.id,
                            ))
                              target.visuals.push({
                                id: crypto.randomUUID(),
                                targetId,
                                operation: "color",
                                value: option.color,
                                transform: structuredClone(
                                  props.document.entities.find(
                                    (e) => e.id === targetId,
                                  )!.transform,
                                ),
                                camera: props.runtime?.getCameraPose() ?? {
                                  position: [0, 1000, 3000],
                                  target: [0, 0, 0],
                                  fov: 60,
                                },
                                assetId: "",
                                variant: "",
                              });
                          })
                        }
                      >
                        绑定所选实体
                      </button>
                      <ul>
                        {option.visuals.map((v) => (
                          <li key={v.id}>
                            <button
                              onClick={() => {
                                props.select([v.targetId]);
                                props.focus([v.targetId]);
                              }}
                            >
                              {props.document.entities.find(
                                (e) => e.id === v.targetId,
                              )?.name ?? "丢失目标"}
                            </button>{" "}
                            · {v.operation}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </fieldset>
              ))}
              {domain.fields(["variantPolicy", "groups"])}
            </section>
          )}
          {tab === "rules" && (
            <RuleDesigner catalog={data} mutate={domain.mutate} />
          )}
          {tab === "ui" && (
            <section>
              <button
                onClick={() =>
                  props.command({
                    label: "创建配置器界面控件",
                    mutate(doc) {
                      const node = createUiNode("configurator", "hud-default");
                      node.targetId = entity.id;
                      Object.assign(node.style, {
                        anchor: "top-right",
                        x: 20,
                        y: 80,
                        width: 360,
                        height: "auto",
                        background: "var(--player-background)",
                        overflow: "auto",
                      });
                      node.mobile = {
                        anchor: "bottom-left",
                        x: 0,
                        y: 0,
                        width: "100%",
                        height: 260,
                      };
                      doc.ui.nodes.push(node);
                    },
                  })
                }
              >
                添加到 InterfaceCanvas
              </button>
              <p>
                色卡、缩略卡、单选、多选及规格清单由同一个 Player UI
                控件消费。可在界面工作区调整桌面和手机布局。
              </p>
              {domain.fields(["priceSource", "priceCurrency"])}
            </section>
          )}
          {tab === "validation" && (
            <section>
              <ConfigurationAnalysis
                catalog={data}
                entityId={entity.id}
                props={props}
              />
              <button
                onClick={() =>
                  void props.services.run("保存目录修订", async () => {
                    const errors = validateCatalog(data);
                    if (errors.length) throw Error(errors.join("；"));
                    const id = data.catalogId || crypto.randomUUID(),
                      base =
                        version?.id === id
                          ? version
                          : library.items.find((i) => i.id === id);
                    if (base && data.libraryVersionId !== base.versionId)
                      throw Error(
                        "目录源已变化，请先从目录库载入修订后再应用当前编辑",
                      );
                    const saved = await props.services.request<
                      LibraryRecord<ProductCatalog>
                    >("/library/catalog/" + id, {
                      method: "PUT",
                      body: JSON.stringify({
                        name: data.name,
                        expectedRevision: base?.revision ?? 0,
                        document: data,
                      }),
                    });
                    setVersion(saved);
                    props.command({
                      label: "记录目录固定修订",
                      mutate(doc) {
                        getComponent(
                          doc.entities.find((e) => e.id === entity.id)!,
                          "studio.configurator.Catalog",
                        )!.data = structuredClone(
                          saved.document,
                        ) as unknown as Record<string, JsonValue>;
                      },
                    });
                    await library.refresh();
                  })
                }
              >
                保存不可变目录修订
              </button>
              <select
                aria-label="恢复产品目录"
                value=""
                onChange={(event) => {
                  const item = library.items.find(
                    (i) => i.id === event.target.value,
                  );
                  if (!item) return;
                  setVersion(item);
                  props.command({
                    label: "恢复目录为新草稿",
                    mutate(doc) {
                      getComponent(
                        doc.entities.find((e) => e.id === entity.id)!,
                        "studio.configurator.Catalog",
                      )!.data = structuredClone(
                        item.document,
                      ) as unknown as Record<string, JsonValue>;
                    },
                  });
                }}
              >
                <option value="">从目录库恢复…</option>
                {library.items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} @ {i.revision}
                  </option>
                ))}
              </select>
              <p>
                未连接价格服务时只显示“需询价”；BOM/SKU
                来自当前目录中的实际映射。
              </p>
            </section>
          )}
        </>
      )}
      {library.error && <p role="alert">{library.error}</p>}
    </div>
  );
}
