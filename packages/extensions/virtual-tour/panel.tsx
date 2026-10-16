import { ProjectDiagram } from "./ProjectDiagram";
import { HotspotCanvas } from "./HotspotCanvas";
import { FloorEditor } from "./FloorEditor";
import { useEffect, useState } from "react";
import {
  createDocument,
  type SceneDocument,
  type JsonValue,
} from "../../scene-schema/src/index";
import type { ExtensionPanelProps } from "../editor-contract";
import { captureThumbnail } from "../designer";
import { useLibraryDocument, type LibraryRecord } from "../library";
import {
  emptyProject,
  newTourNode,
  validateProject,
  type ProjectGraph,
  type TourHotspot,
} from "./core";
export function VirtualTourPanel(props: ExtensionPanelProps) {
  const { services } = props,
    initial = () => {
      const graph = emptyProject(),
        node = newTourNode(props.document.name);
      node.sceneId = props.document.sceneId;
      node.camera = {
        position: props.document.settings.position,
        target: props.document.settings.target,
        fov: props.document.settings.fov,
      };
      graph.name = props.document.name;
      graph.skinSceneId = props.document.sceneId;
      graph.nodes = [node];
      graph.entryNodeId = node.id;
      return graph;
    };
  const editor = useLibraryDocument<ProjectGraph>(
    "project",
    services.projectId,
    props.document.name,
    initial,
    (graph) => {
      const errors = validateProject(graph);
      if (errors.length) throw Error(errors.join("；"));
    },
    services,
  );
  const [tab, setTab] = useState("nodes"),
    [active, setActive] = useState(""),
    [scenes, setScenes] = useState<
      { sceneId: string; revision: number; document: SceneDocument }[]
    >([]),
    [hotspotKind, setHotspotKind] = useState<TourHotspot["kind"]>("point"),
    [polygon, setPolygon] = useState<{ yaw: number; pitch: number }[]>([]),
    [published, setPublished] = useState(""),
    [history, setHistory] = useState<{ id: string; createdAt: string }[]>([]),
    [scenesError, setScenesError] = useState("");
  const graph = editor.document,
    node = graph?.nodes.find((n) => n.id === active) ?? graph?.nodes[0];
  useEffect(() => {
    const abort = new AbortController();
    setScenesError("");
    void services
      .request<
        typeof scenes
      >("/projects/" + services.projectId + "/scenes", { signal: abort.signal })
      .then((value) => { if (!abort.signal.aborted) setScenes(value); })
      .catch((error) => { if (!abort.signal.aborted) setScenesError("读取项目场景失败：" + String(error)); });
    return () => abort.abort();
  }, [services.projectId, props.document.sceneId]);
  const edit = (label: string, change: (g: ProjectGraph) => void) =>
    editor.execute(label, change);
  const fields = (keys: string[]) =>
    graph
      ? props.renderDocumentFields(
          "studio.virtualTour.Project",
          graph as unknown as Record<string, JsonValue>,
          keys,
          (key, value) =>
            edit("编辑项目编排", (g) => {
              (g as unknown as Record<string, JsonValue>)[key] = value;
            }),
        )
      : null;
  const uploadMedia = (files: FileList | null, kind: "panorama" | "floor") => {
    const file = files?.[0];
    if (!file) return;
    void services.run("导入项目媒体", async () => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const video =
        /^video\//.test(file.type) || /\.(mp4|webm)$/i.test(file.name);
      if (kind === "panorama" && video) {
        const url = URL.createObjectURL(file),
          element = document.createElement("video");
        try {
          await new Promise<void>((resolve, reject) => {
            element.onloadedmetadata = () => resolve();
            element.onerror = () => reject(Error("视频元数据无法读取"));
            element.preload = "metadata";
            element.src = url;
          });
          if (element.videoWidth !== element.videoHeight * 2)
            throw Error("全景视频必须为 2:1 等距柱状投影");
        } finally {
          element.removeAttribute("src");
          element.load();
          URL.revokeObjectURL(url);
        }
      } else if (kind === "panorama") {
        const image = await createImageBitmap(file);
        const valid = image.width === image.height * 2;
        image.close();
        if (!valid) throw Error("标准 360×180 全景图必须采用 2:1 等距柱状投影");
      }
      const asset = await services.upload(
        file.name,
        video ? "video" : "image",
        file.name,
        new Map([[file.name, bytes]]),
      );
      edit("归档项目媒体", (g) => {
        g.assets.push(asset);
        if (kind === "panorama") {
          const n = newTourNode(file.name, video ? "pano-video" : "panorama");
          n.assetId = asset.id;
          g.nodes.push(n);
          setActive(n.id);
        } else
          g.floors.push({
            id: crypto.randomUUID(),
            name: file.name,
            assetId: asset.id,
            calibrated: false,
            north: 0,
            mmPerPixel: 1,
          });
      });
    });
  };
  return (
    <div className="domain-designer">
      <div className="designer-toolbar">
        <strong>
          Project 多场景编排 · 修订 {editor.revision}
          {editor.dirty ? " · 未保存" : ""}
        </strong>
        <button
          onClick={() =>
            void services.run("保存项目", async () => {
              await editor.save();
            })
          }
        >
          保存项目编排
        </button>
        <button
          disabled={!graph}
          onClick={() =>
            graph &&
            void services.run("项目预览", () => services.previewProject(graph))
          }
        >
          预览整个项目
        </button>
        <button
          onClick={() =>
            void services.run("发布项目", async () => {
              if (!graph) throw Error("项目未载入");
              const errors = validateProject(graph, true);
              if (errors.length) throw Error(errors.join("；"));
              await services.saveScene();
              const saved = await editor.save(),
                current = await services.request<typeof scenes>(
                  "/projects/" + services.projectId + "/scenes",
                );
              const result = await services.request<{ playerUrl: string }>(
                "/projects/" + services.projectId + "/publish",
                {
                  method: "POST",
                  body: JSON.stringify({
                    expectedRevision: saved.revision,
                    sceneRevisions: Object.fromEntries(
                      current.map((s) => [s.sceneId, s.revision]),
                    ),
                  }),
                },
              );
              setPublished(result.playerUrl);
            })
          }
        >
          发布固定项目版本
        </button>
        {published && (
          <a href={published} target="_blank" rel="noreferrer">
            打开项目 Player
          </a>
        )}
      </div>
      <nav className="designer-tabs">
        {[
          ["nodes", "节点目录"],
          ["graph", "连接图"],
          ["hotspots", "全景热点"],
          ["floors", "楼层地图"],
          ["routes", "自动导览"],
          ["skin", "皮肤与历史"],
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
      {graph && (
        <>
          {tab === "nodes" && (
            <div className="designer-columns">
              <section>
                <div className="button-group">
                  <button
                    onClick={() =>
                      void services.run("新建项目场景", async () => {
                        await services.saveScene();
                        const scene = await services.request<{
                          sceneId: string;
                          document: SceneDocument;
                          revision: number;
                        }>("/projects/" + services.projectId + "/scenes", {
                          method: "POST",
                          body: JSON.stringify({
                            name: "新 3D 场景",
                            document: createDocument("新 3D 场景"),
                          }),
                        });
                        setScenes([...scenes, scene]);
                        edit("增加 3D 场景节点", (g) => {
                          const node = newTourNode(scene.document.name);
                          node.sceneId = scene.sceneId;
                          g.nodes.push(node);
                          setActive(node.id);
                        });
                      })
                    }
                  >
                    新建 3D 场景
                  </button>
                  <label className="button">
                    导入 2:1 全景
                    <input
                      type="file"
                      accept="image/*,video/mp4,video/webm"
                      hidden
                      onChange={(e) => uploadMedia(e.target.files, "panorama")}
                    />
                  </label>
                </div>
                {graph.nodes.map((n, index) => (
                  <div
                    className={
                      "tour-node-row " + (n.id === node?.id ? "active" : "")
                    }
                    key={n.id}
                  >
                    <button
                      onClick={() => {
                        setActive(n.id);
                        props.select([n.id]);
                      }}
                    >
                      {n.kind === "scene3d" ? "◈" : "◉"} {n.name}
                      {graph.entryNodeId === n.id ? " · 入口" : ""}
                    </button>
                    <button
                      onClick={() =>
                        edit("设为项目入口", (g) => {
                          g.entryNodeId = n.id;
                        })
                      }
                    >
                      设入口
                    </button>
                    <button
                      disabled={!index}
                      onClick={() =>
                        edit("调整场景顺序", (g) => {
                          const i = g.nodes.findIndex((x) => x.id === n.id);
                          [g.nodes[i - 1], g.nodes[i]] = [
                            g.nodes[i],
                            g.nodes[i - 1],
                          ];
                        })
                      }
                    >
                      上移
                    </button>
                    {n.sceneId === props.document.sceneId && (
                      <button
                        onClick={() =>
                          void services.run("记录节点缩略图", async () => {
                            const asset = await captureThumbnail(props, n.name);
                            edit("设置节点缩略图", (g) => {
                              g.assets.push(asset);
                              g.nodes.find(
                                (x) => x.id === n.id,
                              )!.thumbnailAssetId = asset.id;
                            });
                          })
                        }
                      >
                        记录缩略图
                      </button>
                    )}
                    {n.kind === "scene3d" && (
                      <button
                        onClick={() =>
                          void services.run("打开项目场景", () =>
                            services.openScene(n.sceneId),
                          )
                        }
                      >
                        打开编辑
                      </button>
                    )}
                  </div>
                ))}
              </section>
              <section>{fields(["name", "entryNodeId", "nodes"])}</section>
            </div>
          )}
          {tab === "graph" && (
            <section>
              <ProjectDiagram
                graph={graph}
                active={node?.id ?? ""}
                onSelect={setActive}
                edit={edit}
              />
              {node && (
                <label>
                  从 {node.name} 双向连接到
                  <select
                    value=""
                    onChange={(e) =>
                      edit("创建双向场景连接", (g) => {
                        const forward = crypto.randomUUID(),
                          reverse = crypto.randomUUID();
                        g.links.push(
                          {
                            id: forward,
                            fromNodeId: node.id,
                            toNodeId: e.target.value,
                            transition: "fade",
                            reverseLinkId: reverse,
                          },
                          {
                            id: reverse,
                            fromNodeId: e.target.value,
                            toNodeId: node.id,
                            transition: "fade",
                            reverseLinkId: forward,
                          },
                        );
                      })
                    }
                  >
                    <option value="">选择目标节点</option>
                    {graph.nodes
                      .filter((n) => n.id !== node.id)
                      .map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {fields(["links", "diagram"])}
            </section>
          )}
          {tab === "hotspots" && node && (
            <section>
              <select
                aria-label="热点所属节点"
                value={node.id}
                onChange={(e) => setActive(e.target.value)}
              >
                {graph.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="热点类型"
                value={hotspotKind}
                onChange={(e) => {
                  setHotspotKind(e.target.value as TourHotspot["kind"]);
                  setPolygon([]);
                }}
              >
                {["point", "text", "image", "polygon", "video"].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
              <p>
                在等距柱状图上点击放置。多边形逐点添加后闭合；±180°
                拼接点按球面坐标保存。
              </p>
              <HotspotCanvas
                node={node}
                edit={edit}
                assetId={node.assetId}
                graph={graph}
                services={services}
                onPoint={(x, y) => {
                  const point = {
                    yaw: (x - 0.5) * 360,
                    pitch: (0.5 - y) * 180,
                  };
                  if (hotspotKind === "polygon") {
                    setPolygon([...polygon, point]);
                    return;
                  }
                  edit("放置球面热点", (g) =>
                    g.nodes
                      .find((n) => n.id === node.id)!
                      .hotspots.push({
                        id: crypto.randomUUID(),
                        name: "热点",
                        kind: hotspotKind,
                        ...point,
                        points: [],
                        toNodeId: "",
                        contentId: "",
                        assetId: "",
                        text: "热点",
                        alt: "热点",
                        color: "#38caa6",
                      }),
                  );
                }}
              />
              {hotspotKind === "polygon" && (
                <>
                  <span>已放置 {polygon.length} 个顶点</span>
                  <button
                    disabled={polygon.length < 3}
                    onClick={() => {
                      edit("闭合球面多边形热点", (g) =>
                        g.nodes
                          .find((n) => n.id === node.id)!
                          .hotspots.push({
                            id: crypto.randomUUID(),
                            name: "多边形热点",
                            kind: "polygon",
                            yaw: polygon[0].yaw,
                            pitch: polygon[0].pitch,
                            points: polygon,
                            toNodeId: "",
                            contentId: "",
                            assetId: "",
                            text: "区域",
                            alt: "区域",
                            color: "#38caa6",
                          }),
                      );
                      setPolygon([]);
                    }}
                  >
                    闭合
                  </button>
                </>
              )}
              {fields(["nodes"])}
            </section>
          )}
          {tab === "floors" && (
            <section>
              <label className="button">
                上传楼层图
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => uploadMedia(e.target.files, "floor")}
                />
              </label>
              {graph.floors.map((f) => (
                <FloorEditor
                  key={f.id}
                  floor={f}
                  graph={graph}
                  activeNode={node?.id ?? ""}
                  services={services}
                  edit={edit}
                />
              ))}
              {fields(["floors", "nodes"])}
            </section>
          )}
          {tab === "routes" && (
            <>
              {fields(["routes"])}
              <p>
                路线共享节点导航状态机：暂停、手动打断、继续与结束均有独立状态。
              </p>
            </>
          )}
          {tab === "skin" && (
            <section>
              {fields([
                "skinSceneId",
                "skinLayoutId",
                "locales",
                "releasePolicy",
              ])}
              <p>
                场景皮肤使用当前
                InterfaceCanvas。项目导航、楼层雷达和缩略导航由同一 Player
                widget 注册表渲染。
              </p>
              <button
                onClick={() =>
                  void services.run("查询项目版本", async () =>
                    setHistory(
                      await services.request(
                        "/projects/" + services.projectId + "/publications",
                      ),
                    ),
                  )
                }
              >
                项目发布历史
              </button>
              {history.map((v) => (
                <div key={v.id}>
                  {v.createdAt}
                  <button
                    onClick={() =>
                      void services.run("恢复项目编排", async () => {
                        const restored = await services.request<
                          LibraryRecord<ProjectGraph>
                        >(
                          "/projects/" +
                            services.projectId +
                            "/publications/" +
                            v.id +
                            "/restore",
                          {
                            method: "POST",
                            body: JSON.stringify({
                              expectedRevision: editor.revision,
                            }),
                          },
                        );
                        await editor.adopt(restored);
                      })
                    }
                  >
                    恢复为新项目草稿
                  </button>
                </div>
              ))}
              <button
                onClick={() =>
                  void services.run("取消项目发布", async () => {
                    await services.request(
                      "/projects/" + services.projectId + "/publish",
                      { method: "DELETE" },
                    );
                  })
                }
              >
                取消发布
              </button>
            </section>
          )}
        </>
      )}
      {editor.error && <p role="alert">{editor.error}</p>}
      {scenesError && <p role="alert">{scenesError}</p>}
    </div>
  );
}
