import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import {
  getComponent,
  createEntity,
  createComponent,
  type SceneAsset,
} from "../../scene-schema/src/index";
import type { ExtensionPanelProps } from "../editor-contract";
import { useDomainEntity, captureThumbnail, AssetThumbnail } from "../designer";
import {
  useProcessingJobs,
  JobMonitor,
  type ProcessingResult,
  type ProcessingJob,
} from "../jobs";
import {
  type IndustrialReview,
  type SemanticPage,
  type Measurement,
  measure,
  effectiveClassFields,
  classCompleteness,
  type PropertyTemplate,
  type AssetClass,
  type SemanticSystem,
} from "./core";
import { TopologyView } from "./TopologyView";
import type IndustrialSystem from "./runtime";
export function IndustrialPanel(props: ExtensionPanelProps) {
  const domain = useDomainEntity<IndustrialReview>(
      "studio.industrial.Review",
      props,
    ),
    { entity, data, mutate } = domain,
    [tab, setTab] = useState("inventory"),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(0),
    [records, setRecords] = useState<SemanticPage | null>(null),
    [recordId, setRecordId] = useState(""),
    [scrollTop, setScrollTop] = useState(0),
    [classId, setClassId] = useState(""),
    [sourceClassId, setSourceClassId] = useState(""),
    [systemId, setSystemId] = useState(""),
    [mapping, setMapping] = useState<{
      count: number;
      emptyCount: number;
      errorCount: number;
      errors: string[];
    } | null>(null),
    [kind, setKind] = useState<Measurement["kind"]>("distance"),
    [anchors, setAnchors] = useState<NonNullable<Measurement["anchorRefs"]>>(
      [],
    ),
    jobs = useProcessingJobs(props.services);
  useEffect(
    () => () => props.runtime?.visual.reset("inventory:selection"),
    [props.runtime],
  );
  const selectedClass =
    data?.classes.find((c) => c.id === classId) ?? data?.classes[0];
  const effective = useMemo(() => {
    try {
      return {
        fields:
          data && selectedClass
            ? effectiveClassFields(
                data.classes,
                selectedClass.id,
                data.propertyTemplates,
              )
            : [],
        error: "",
      };
    } catch (error) {
      return { fields: [], error: String(error) };
    }
  }, [data?.classes, data?.propertyTemplates, selectedClass]);
  const completeness = useMemo(
    () =>
      new Map(
        records?.items.map((record) => {
          try {
            return [
              record.sourceElementId,
              classCompleteness(
                record,
                data?.classes ?? [],
                record.classId,
                data?.propertyTemplates,
              ),
            ] as const;
          } catch {
            return [record.sourceElementId, null] as const;
          }
        }),
      ),
    [records, data?.classes, data?.propertyTemplates],
  );
  const measuring = props.services.activeTool === "industrial.measure",
    setMeasuring = (value: boolean) =>
      props.services.activateTool(value ? "industrial.measure" : "");
  const system = props.runtime?.systems.find(
      (s) => s.id === "studio.industrial",
    ) as IndustrialSystem | undefined,
    record = records?.items.find((r) => r.sourceElementId === recordId);
  useEffect(() => {
    if (!data?.semanticAssetId) return;
    const abort = new AbortController(),
      timer = setTimeout(() => {
        void props.services
          .request<SemanticPage>(
            "/semantics/" +
              data.semanticAssetId +
              "?" +
              new URLSearchParams({
                q: search,
                page: String(page),
                pageSize: "100",
                filters: JSON.stringify(data.filters),
              }),
            { signal: abort.signal },
          )
          .then(setRecords)
          .catch((error) => {
            if (!abort.signal.aborted)
              void props.services.run("读取属性清单", async () => {
                throw error;
              });
          });
      }, 180);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [data?.semanticAssetId, data?.filters, search, page]);
  useEffect(() => {
    if (!measuring || !props.runtime) return;
    const runtime = props.runtime,
      canvas = runtime.engine.renderer.domElement;
    const pick = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const rect = canvas.getBoundingClientRect(),
        hit = runtime.pickIntersection(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1,
        );
      if (!hit) return;
      let object: THREE.Object3D | null = hit.object;
      while (object && !object.userData.entityId) object = object.parent;
      const entityId = String(object?.userData.entityId ?? "");
      if (!entityId) return;
      const target = runtime.entity(entityId),
        binding = target && getComponent(target, "ModelNode");
      let point = hit.point.clone();
      if (event.shiftKey && hit.face && hit.object instanceof THREE.Mesh) {
        const position = hit.object.geometry.getAttribute("position");
        const candidates = [hit.face.a, hit.face.b, hit.face.c].map((index) =>
          new THREE.Vector3()
            .fromBufferAttribute(position, index)
            .applyMatrix4(hit.object.matrixWorld),
        );
        point = candidates.sort(
          (a, b) =>
            a.distanceToSquared(hit.point) - b.distanceToSquared(hit.point),
        )[0];
      }
      const local = point.applyMatrix4(
        runtime.getEntityFrame(entityId).invert(),
      );
      setAnchors((previous) => [
        ...previous,
        {
          entityId,
          position: local.toArray(),
          sourceRevision: String(binding?.data.meshRevision ?? ""),
          sourceElementId: String(binding?.data.sourceElementId ?? ""),
        },
      ]);
    };
    canvas.addEventListener("pointerup", pick, { capture: true });
    return () =>
      canvas.removeEventListener("pointerup", pick, { capture: true });
  }, [measuring, props.runtime]);
  const addSection = (kind: "plane" | "box", three = false) => {
    if (!entity) return;
    const created = (three ? [0, 1, 2] : [0]).map((axis) => {
      const section = createEntity(
        kind === "box" ? "剖切盒" : "剖切平面 " + "XYZ"[axis],
      );
      const component = createComponent("studio.industrial.Section");
      component.data.kind = kind;
      section.components.push(component);
      if (axis === 1)
        section.transform.rotation = new THREE.Quaternion()
          .setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)
          .toArray() as [number, number, number, number];
      if (axis === 2)
        section.transform.rotation = new THREE.Quaternion()
          .setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
          .toArray() as [number, number, number, number];
      return section;
    });
    props.command({
      label: "创建剖切体积与引用",
      mutate(doc) {
        doc.entities.push(...created);
        const review = getComponent(
          doc.entities.find((e) => e.id === entity.id)!,
          "studio.industrial.Review",
        )!.data as unknown as IndustrialReview;
        review.sections.push(
          ...created.map((e) => ({ entityId: e.id, enabled: true })),
        );
      },
    });
    props.select(created.map((e) => e.id));
    props.services.activateTool("industrial.section");
  };
  const attach = async (job: ProcessingJob, result: ProcessingResult) => {
    const model = result.assets.find((a) => a.kind === "model"),
      semantic = result.assets.find((a) => a.kind === "semantic");
    if (!model || !semantic) throw Error("IFC 作业结果未包含几何和语义");
    const source = await props.services.request<SceneAsset>(
      "/assets/" + job.sourceAssetId,
    );
    const nodes = await props.services.prepareModel(model);
    const metadata = semantic.files.includes("semantic-model.json")
      ? (JSON.parse(
          new TextDecoder().decode(
            await props.services.assetBytes(semantic.id, "semantic-model.json"),
          ),
        ) as {
          classes: AssetClass[];
          systems: SemanticSystem[];
          propertyTemplates: PropertyTemplate[];
        })
      : null;
    props.command({
      label: "原子导入 IFC 几何与来源属性",
      mutate(doc) {
        for (const asset of [source, model, semantic])
          if (!doc.assets.some((a) => a.id === asset.id))
            doc.assets.push(asset);
        doc.entities.push(...nodes);
        if (entity) {
          const review = getComponent(
            doc.entities.find((e) => e.id === entity.id)!,
            "studio.industrial.Review",
          )!.data as unknown as IndustrialReview;
          review.semanticAssetId = semantic.id;
          if (metadata) {
            review.classes = metadata.classes;
            review.systems = metadata.systems;
            review.propertyTemplates = metadata.propertyTemplates;
          }
        }
      },
    });
  };
  return (
    <div className="domain-designer">
      <div className="designer-toolbar">
        <select
          aria-label="工业审阅"
          value={entity?.id ?? ""}
          onChange={(e) => domain.choose(e.target.value)}
        >
          {domain.entities.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <button onClick={() => domain.create("工业审阅")}>新建工业审阅</button>
        <label className="button">
          IFC 只读导入
          <input
            type="file"
            accept=".ifc"
            hidden
            disabled={!entity}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file)
                void props.services.run("提交 IFC 转换", async () => {
                  const source = await props.services.upload(
                    file.name,
                    "source",
                    file.name,
                    new Map([
                      [file.name, new Uint8Array(await file.arrayBuffer())],
                    ]),
                  );
                  await props.services.request("/jobs", {
                    method: "POST",
                    body: JSON.stringify({
                      sourceAssetId: source.id,
                      operation: "ifc",
                      settings: {
                        useMeshopt: false,
                        textureCodec: "retain",
                        preserveSemantics: true,
                        protectedSourceIds: [],
                      },
                    }),
                  });
                  setTab("import");
                  await jobs.refresh();
                });
            }}
          />
        </label>
      </div>
      <nav className="designer-tabs">
        {[
          ["inventory", "资产清单"],
          ["mapping", "分类与映射"],
          ["systems", "系统与端口"],
          ["filters", "筛选与着色"],
          ["section", "剖切与测量"],
          ["views", "保存视图"],
          ["import", "导入报告"],
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
      {entity && data && (
        <>
          {tab === "inventory" && (
            <div className="designer-columns">
              <section>
                <label className="button">
                  导入属性 JSON
                  <input
                    type="file"
                    accept=".json"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file)
                        void props.services.run("导入来源属性", async () => {
                          const asset = await props.services.upload(
                            file.name,
                            "semantic",
                            "semantics.json",
                            new Map([
                              [
                                "semantics.json",
                                new Uint8Array(await file.arrayBuffer()),
                              ],
                            ]),
                          );
                          await props.services.request(
                            "/semantics/" + asset.id + "/index",
                            { method: "POST" },
                          );
                          props.command({
                            label: "绑定来源属性资产",
                            mutate(doc) {
                              doc.assets.push(asset);
                              getComponent(
                                doc.entities.find((e) => e.id === entity.id)!,
                                "studio.industrial.Review",
                              )!.data.semanticAssetId = asset.id;
                            },
                          });
                        });
                    }}
                  />
                </label>
                <input
                  aria-label="搜索资产清单"
                  placeholder="编号 / 名称 / 系统 / 来源字段"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(0);
                  }}
                />
                <p>{records?.total ?? 0} 项 · 服务器分页 100 条</p>
                <div
                  className="inventory-table"
                  style={{ height: 300, overflow: "auto" }}
                  onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
                  role="grid"
                  aria-label="工业资产清单"
                >
                  <table>
                    <thead>
                      <tr>
                        <th>名称</th>
                        <th>来源 ID</th>
                        <th>分类</th>
                        <th>必填完整性</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        aria-hidden="true"
                        style={{
                          height:
                            Math.max(0, Math.floor(scrollTop / 32) - 3) * 32,
                        }}
                      />
                      <>
                        {records?.items
                          .slice(
                            Math.max(0, Math.floor(scrollTop / 32) - 3),
                            Math.floor(scrollTop / 32) + 14,
                          )
                          .map((r) => (
                            <tr
                              key={r.sourceElementId}
                              tabIndex={0}
                              aria-selected={recordId === r.sourceElementId}
                              onClick={() => {
                                setRecordId(r.sourceElementId);
                                const ids = props.document.entities
                                  .filter(
                                    (e) =>
                                      getComponent(e, "ModelNode")?.data
                                        .sourceElementId === r.sourceElementId,
                                  )
                                  .map((e) => e.id);
                                props.select(ids);
                                props.runtime?.visual.highlight(
                                  "inventory:selection",
                                  ids,
                                );
                              }}
                              onDoubleClick={() => {
                                const ids = props.document.entities
                                  .filter(
                                    (e) =>
                                      getComponent(e, "ModelNode")?.data
                                        .sourceElementId === r.sourceElementId,
                                  )
                                  .map((e) => e.id);
                                props.focus(ids);
                              }}
                            >
                              <td>{r.name}</td>
                              <td>{r.sourceElementId}</td>
                              <td>{r.classId}</td>
                              <td>
                                {completeness.get(r.sourceElementId)
                                  ? `${completeness.get(r.sourceElementId)!.present}/${completeness.get(r.sourceElementId)!.required}${completeness.get(r.sourceElementId)!.complete ? " ✓" : " 待完善"}`
                                  : "分类未配置"}
                              </td>
                            </tr>
                          ))}
                      </>
                      <tr
                        aria-hidden="true"
                        style={{
                          height:
                            Math.max(
                              0,
                              (records?.items.length ?? 0) -
                                (Math.floor(scrollTop / 32) + 14),
                            ) * 32,
                        }}
                      />
                    </tbody>
                  </table>
                </div>
                <button
                  disabled={!page}
                  onClick={() => {
                    setPage(page - 1);
                    setScrollTop(0);
                  }}
                >
                  上一页
                </button>
                <button
                  disabled={
                    !records || (page + 1) * records.pageSize >= records.total
                  }
                  onClick={() => {
                    setPage(page + 1);
                    setScrollTop(0);
                  }}
                >
                  下一页
                </button>
              </section>
              <section>
                <h3>{record?.name ?? "选择资产查看属性"}</h3>
                {record && (
                  <>
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
                    <p>来源模型修订 {record.modelRevision || "未提供"}</p>
                    <h4>来源关系</h4>
                    {record.links.map((link, i) => (
                      <p key={i}>
                        {link.kind} → {link.targetId}
                      </p>
                    ))}
                  </>
                )}
              </section>
            </div>
          )}
          {tab === "systems" && (
            <section>
              <select
                aria-label="工业系统"
                value={systemId || data.systems?.[0]?.id || ""}
                onChange={(event) => setSystemId(event.target.value)}
              >
                {data.systems?.map((system) => (
                  <option value={system.id} key={system.id}>
                    {system.name}
                  </option>
                ))}
              </select>
              {data.systems
                ?.filter(
                  (system) => system.id === (systemId || data.systems?.[0]?.id),
                )
                .map((system) => (
                  <TopologyView
                    key={system.id}
                    system={system}
                    select={(sourceId) => {
                      const ids = props.document.entities
                        .filter(
                          (e) =>
                            getComponent(e, "ModelNode")?.data
                              .sourceElementId === sourceId,
                        )
                        .map((e) => e.id);
                      props.select(ids);
                      props.focus(ids);
                      props.runtime?.visual.highlight(
                        "inventory:selection",
                        ids,
                      );
                    }}
                  />
                ))}
              {domain.fields(["systems"])}
            </section>
          )}
          {tab === "mapping" && (
            <section>
              {domain.fields([
                "semanticAssetId",
                "propertyTemplates",
                "classes",
              ])}
              <button
                onClick={() =>
                  mutate("添加设备属性模板", (review) => {
                    (review.propertyTemplates ??= []).push({
                      id: crypto.randomUUID(),
                      name: "设备运行参数",
                      fields: [
                        {
                          id: "pressure",
                          name: "压力",
                          dataType: "number",
                          unit: "Pa",
                          precision: 2,
                          required: true,
                          sourcePath: "Pressure",
                          sourceUnit: "kPa",
                          emptyPolicy: "reject",
                          defaultValue: "",
                        },
                        {
                          id: "flow",
                          name: "流量",
                          dataType: "number",
                          unit: "m3/s",
                          precision: 4,
                          required: false,
                          sourcePath: "Flow",
                          sourceUnit: "L/min",
                          emptyPolicy: "keep",
                          defaultValue: "",
                        },
                      ],
                    });
                  })
                }
              >
                添加设备属性模板
              </button>
              <p>
                有效继承字段 {effective.fields.length}{" "}
                项；继承的必填约束继续生效。映射保留原值、原单位、路径和来源修订。
              </p>
              {effective.error && (
                <p className="danger" role="alert">
                  {effective.error}
                </p>
              )}
              <label>
                来源分类（留空映射全部）
                <input
                  value={sourceClassId}
                  onChange={(e) => setSourceClassId(e.target.value)}
                />
              </label>
              <label>
                目标分类
                <select
                  value={selectedClass?.id ?? ""}
                  onChange={(e) => setClassId(e.target.value)}
                >
                  {data.classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="button-group">
                <button
                  disabled={!data.classes.length || Boolean(effective.error)}
                  onClick={() =>
                    void props.services.run("字段映射预检", async () =>
                      setMapping(
                        await props.services.request(
                          "/semantics/" + data.semanticAssetId + "/map",
                          {
                            method: "POST",
                            body: JSON.stringify({
                              classId: selectedClass!.id,
                              fields: effective.fields,
                              sourceClassId,
                              apply: false,
                            }),
                          },
                        ),
                      ),
                    )
                  }
                >
                  预览全量映射
                </button>
                <button
                  disabled={!data.classes.length || Boolean(effective.error)}
                  onClick={() =>
                    void props.services.run(
                      "应用映射为派生属性修订",
                      async () => {
                        const result = await props.services.request<{
                          asset: SceneAsset;
                        }>("/semantics/" + data.semanticAssetId + "/map", {
                          method: "POST",
                          body: JSON.stringify({
                            classId: selectedClass!.id,
                            fields: effective.fields,
                            sourceClassId,
                            apply: true,
                          }),
                        });
                        props.command({
                          label: "原子切换分类属性修订",
                          mutate(doc) {
                            doc.assets.push(result.asset);
                            getComponent(
                              doc.entities.find((e) => e.id === entity.id)!,
                              "studio.industrial.Review",
                            )!.data.semanticAssetId = result.asset.id;
                          },
                        });
                      },
                    )
                  }
                >
                  应用为可回滚新修订
                </button>
              </div>
              {mapping && <pre>{JSON.stringify(mapping, null, 2)}</pre>}
              <p>源数据不可变；类型、单位或必填校验失败时不创建替换修订。</p>
            </section>
          )}
          {tab === "filters" && (
            <section>
              {domain.fields(["filters", "colors"])}
              <button
                onClick={() =>
                  void props.services.run("应用工业筛选", async () => {
                    await system?.apply(entity.id);
                  })
                }
              >
                筛选、着色并隔离
              </button>
              <button onClick={() => system?.reset(entity.id)}>
                恢复全部显示
              </button>
              <div className="color-legend">
                {data.colors.map((color) => (
                  <button
                    key={color.id}
                    style={{ borderColor: color.color }}
                    onClick={() =>
                      mutate("从图例筛选", (d) => {
                        d.filters = [
                          {
                            id: crypto.randomUUID(),
                            field: color.field,
                            operator: "eq",
                            value: color.value,
                            join: "and",
                          },
                        ];
                      })
                    }
                  >
                    {color.mode === "missing"
                      ? "未填写"
                      : color.value || color.min + "～" + color.max}
                  </button>
                ))}
              </div>
            </section>
          )}
          {tab === "section" && (
            <section>
              <div className="designer-toolbar">
                <button onClick={() => addSection("plane")}>添加平面</button>
                <button onClick={() => addSection("plane", true)}>
                  三向正交平面
                </button>
                <button onClick={() => addSection("box")}>添加剖切盒</button>
              </div>
              <p>
                选择剖切实体后复用视口移动、旋转、缩放
                Gizmo；数值、吸附及撤销与普通节点一致。
              </p>
              {domain.fields(["sections"])}
              <button
                onClick={() =>
                  void props.services.run("应用剖切", async () => {
                    await system?.apply(entity.id);
                  })
                }
              >
                应用剖切平面 / 盒体
              </button>
              <div className="designer-toolbar">
                <select
                  aria-label="测量类型"
                  value={kind}
                  onChange={(e) =>
                    setKind(e.target.value as Measurement["kind"])
                  }
                >
                  {["distance", "angle", "path", "bounds"].map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    setMeasuring(!measuring);
                    if (!measuring) setAnchors([]);
                  }}
                >
                  {measuring ? "停止拾取" : "在视口拾取测量点"}
                </button>
                <span>已拾取 {anchors.length} 点 · Shift 吸附顶点</span>
                <button onClick={() => setAnchors(anchors.slice(0, -1))}>
                  撤回一点
                </button>
                <button
                  disabled={
                    kind !== "bounds" &&
                    anchors.length < (kind === "angle" ? 3 : 2)
                  }
                  onClick={() => {
                    mutate("保存测量标注", (review) =>
                      review.measurements.push({
                        id: crypto.randomUUID(),
                        name: "测量 " + (review.measurements.length + 1),
                        kind,
                        entityId:
                          props.selectedIds[0] ?? anchors[0]?.entityId ?? "",
                        points: [],
                        anchorRefs: anchors,
                        sourceRevision: anchors[0]?.sourceRevision ?? "",
                        unit: "mm",
                        tolerance: 1,
                      }),
                    );
                    setAnchors([]);
                    setMeasuring(false);
                  }}
                >
                  保存测量
                </button>
              </div>
              {data.measurements.map((m) => {
                let result = "";
                try {
                  const points = system?.measurementPoints(m) ?? [];
                  if (points.length)
                    result =
                      measure(
                        m.kind,
                        points.map((p) => p.toArray()),
                        m.unit,
                      ).toFixed(2) + (m.kind === "angle" ? "°" : m.unit);
                } catch (error) {
                  result = String(error);
                }
                return (
                  <p key={m.id}>
                    {m.name}：{result}
                  </p>
                );
              })}
              <p>
                可视三角网格测量，精度受来源网格和版本影响；不作为工程认证尺寸。
              </p>
              {domain.fields(["measurements"])}
            </section>
          )}
          {tab === "views" && (
            <section>
              <button
                onClick={() =>
                  void props.services.run("保存工业视图", async () => {
                    if (!props.runtime) return;
                    const asset = await captureThumbnail(props, "工业视图");
                    props.command({
                      label: "归档工业视图缩略图",
                      mutate(doc) {
                        doc.assets.push(asset);
                      },
                    });
                    mutate("保存工业视图", (d) =>
                      d.views.push({
                        id: crypto.randomUUID(),
                        name: "保存视图 " + (d.views.length + 1),
                        camera: props.runtime!.getCameraPose(),
                        filters: structuredClone(d.filters),
                        colors: structuredClone(d.colors),
                        sections: system?.captureSections(entity.id) ?? [],
                        hiddenIds: props.document.entities
                          .filter((e) => !e.visible)
                          .map((e) => e.id),
                        thumbnailAssetId: asset.id,
                      }),
                    );
                  })
                }
              >
                保存当前相机 / 筛选 / 剖切
              </button>
              {data.views.map((view) => (
                <button
                  key={view.id}
                  onClick={() =>
                    void props.services.run("恢复保存视图", async () => {
                      await system?.apply(entity.id, view);
                    })
                  }
                >
                  <AssetThumbnail
                    id={view.thumbnailAssetId}
                    assets={props.document.assets}
                    services={props.services}
                    alt={view.name}
                  />
                  {view.name}
                </button>
              ))}
              {domain.fields(["views"])}
            </section>
          )}
        </>
      )}
      {tab === "import" && (
        <>
          <p>
            IFC 通过隔离转换进程生成 glTF 与 GUID/Pset 索引，运行内核不解析
            CAD。导入报告列出缺失和不支持的几何。
          </p>
          <JobMonitor
            services={props.services}
            jobs={jobs.jobs.filter((j) => j.operation === "ifc")}
            onApply={attach}
          />
        </>
      )}
    </div>
  );
}
