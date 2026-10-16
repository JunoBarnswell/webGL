import { useState } from "react";
import { getComponent, type SceneDocument } from "../../scene-schema/src/index";
import { EditorSession } from "../../editor-core/src/EditorSession";
import { replaceModelRevision } from "../../editor-core/src/modelRevision";
import {
  useProcessingJobs,
  JobMonitor,
  type ProcessingJob,
  type ProcessingResult,
} from "../jobs";
import type { ExtensionPanelProps } from "../editor-contract";
import { compareDocuments, type Comparison } from "./compare";
export function OptimizationPanel(props: ExtensionPanelProps) {
  const jobs = useProcessingJobs(props.services),
    [assetId, setAssetId] = useState(""),
    [profile, setProfile] = useState("industrial"),
    [meshopt, setMeshopt] = useState(true),
    [ktx2, setKtx2] = useState(false),
    [comparison, setComparison] = useState<Comparison | null>(null),
    [wipe, setWipe] = useState(50),
    [textureBudget, setTextureBudget] = useState(256),
    [triangleBudget, setTriangleBudget] = useState(2000000);
  const assets = props.document.assets.filter((a) => a.kind === "model"),
    asset = assets.find((a) => a.id === assetId) ?? assets[0],
    model =
      props.document.entities.find(
        (e) =>
          props.selectedIds.includes(e.id) &&
          getComponent(e, "Model")?.data.assetId === asset?.id,
      ) ??
      props.document.entities.find(
        (e) => getComponent(e, "Model")?.data.assetId === asset?.id,
      );
  const sourceNodes = props.document.entities.filter(
      (e) => getComponent(e, "ModelNode")?.data.modelEntityId === model?.id,
    ),
    sourceIds = new Set(sourceNodes.map((e) => e.id)),
    surfaceAnchors = props.document.entities
      .flatMap((e) => e.components)
      .filter(
        (c) =>
          c.enabled &&
          c.data.anchorKind === "surface" &&
          sourceIds.has(String(c.data.entityId)),
      );
  const submit = (operation: string) =>
    void props.services.run("提交资产处理", async () => {
      if (!asset) throw Error("选择模型资产");
      if (meshopt && surfaceAnchors.length)
        throw Error(
          "该模型有表面三角锚点；请关闭几何优化，或先明确修复为实体锚点",
        );
      await props.services.request("/jobs", {
        method: "POST",
        body: JSON.stringify({
          sourceAssetId: asset.id,
          operation,
          settings: {
            useMeshopt: meshopt,
            textureCodec: ktx2 ? "ktx2" : "retain",
            preserveSemantics: true,
            protectedSourceIds: sourceNodes.map((e) =>
              String(getComponent(e, "ModelNode")!.data.sourceElementId),
            ),
          },
        }),
      });
      await jobs.refresh();
    });
  const prepare = async (job: ProcessingJob, result: ProcessingResult) => {
    if (
      !model ||
      job.sourceAssetId !== getComponent(model, "Model")?.data.assetId
    )
      throw Error("先选择与作业源资产一致的模型实例");
    const derived = result.assets.find((a) => a.kind === "model");
    if (!derived) throw Error("此作业只诊断，未产生可替换模型");
    const nodes = await props.services.prepareModel(derived),
      revision = replaceModelRevision(
        props.document,
        model.id,
        derived,
        nodes,
        { acceptNew: true, preserveTransforms: true },
      );
    if (revision.report.unmatched.length || revision.report.conflicts.length)
      throw Error("来源身份门禁失败：" + JSON.stringify(revision.report));
    if (surfaceAnchors.length && !result.report.geometryUnchanged)
      throw Error("派生几何不能证明三角来源不变，禁止替换表面锚点");
    return { revision, derived };
  };
  const apply = async (job: ProcessingJob, result: ProcessingResult) => {
    const { revision, derived } = await prepare(job, result);
    props.command({
      label: "应用已核验的派生模型修订",
      mutate(doc) {
        revision.command.mutate(doc);
        if (result.report.geometryUnchanged)
          for (const e of doc.entities)
            for (const c of e.components)
              if (
                c.data.anchorKind === "surface" &&
                sourceIds.has(String(c.data.entityId))
              )
                c.data.meshRevision = derived.sha256;
      },
    });
  };
  return (
    <div className="domain-designer">
      <div className="designer-toolbar">
        <select
          aria-label="待优化资产"
          value={asset?.id ?? ""}
          onChange={(e) => setAssetId(e.target.value)}
        >
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          aria-label="优化预设"
          value={profile}
          onChange={(e) => {
            setProfile(e.target.value);
            setMeshopt(true);
            setKtx2(e.target.value === "mobile");
          }}
        >
          {[
            ["showroom", "展厅高画质"],
            ["car", "汽车产品"],
            ["industrial", "工业身份优先"],
            ["mobile", "移动设备"],
            ["custom", "自定义"],
          ].map(([id, title]) => (
            <option key={id} value={id}>
              {title}
            </option>
          ))}
        </select>
        <label>
          <input
            type="checkbox"
            checked={meshopt}
            onChange={(e) => setMeshopt(e.target.checked)}
          />
          Meshopt 几何
        </label>
        <label>
          <input
            type="checkbox"
            checked={ktx2}
            onChange={(e) => setKtx2(e.target.checked)}
          />
          KTX2 / BasisU
        </label>
        <button disabled={!asset} onClick={() => submit("diagnose")}>
          诊断资产
        </button>
        <button disabled={!asset} onClick={() => submit("optimize")}>
          创建不可变优化修订
        </button>
      </div>
      <p>
        固定源 SHA、策略 Hash 和稳定身份；原始资产始终保留。绑定表面三角锚点{" "}
        {surfaceAnchors.length} 项，来源节点 {sourceNodes.length}{" "}
        个。颜色空间不明确、扩展或身份丢失会阻止结果应用。
      </p>
      <div className="budget-toolbar">
        <label>
          纹理显存估算预算（MiB）
          <input
            type="number"
            min={1}
            value={textureBudget}
            onChange={(e) => setTextureBudget(Number(e.target.value))}
          />
        </label>
        <label>
          三角量预算
          <input
            type="number"
            min={1}
            value={triangleBudget}
            onChange={(e) => setTriangleBudget(Number(e.target.value))}
          />
        </label>
        <button
          onClick={() =>
            void props.services.run("记录当前运行统计", async () => {
              if (!props.runtime) throw Error("视口未就绪");
              props.services.downloadJson("runtime-budget.json", {
                stats: props.runtime.stats(),
                textureBudgetMiB: textureBudget,
                triangleBudget,
                userAgent: navigator.userAgent,
                dpr: window.devicePixelRatio,
                note: "CPU/GPU/RAF 分开记录；不支持 GPU timer 时保持 unavailable。",
              });
            })
          }
        >
          导出实际运行统计
        </button>
      </div>
      <JobMonitor
        services={props.services}
        jobs={jobs.jobs.filter((j) => j.operation !== "ifc")}
        onApply={apply}
      />
      <section>
        <h3>原始 / 优化质量比较</h3>
        <select
          aria-label="选择已完成作业进行比较"
          value=""
          onChange={(e) =>
            void props.services.run("同相机质量比较", async () => {
              const job = jobs.jobs.find((j) => j.id === e.target.value);
              if (!job?.resultJson || !props.runtime)
                throw Error("作业结果不可用");
              const result = JSON.parse(job.resultJson) as ProcessingResult,
                { revision } = await prepare(job, result),
                temporary = new EditorSession(props.document);
              temporary.execute(revision.command);
              setComparison(
                await compareDocuments(
                  props.runtime,
                  temporary.document as SceneDocument,
                ),
              );
            })
          }
        >
          <option value="">选择包含派生模型的已完成作业…</option>
          {jobs.jobs
            .filter(
              (j) => j.status === "Succeeded" && j.operation === "optimize",
            )
            .map((j) => (
              <option key={j.id} value={j.id}>
                {j.id.slice(0, 8)} · {j.updatedAt}
              </option>
            ))}
        </select>
        {comparison && (
          <>
            <div className="asset-comparison">
              <img src={comparison.source} alt="原始模型，同相机和曝光" />
              <img
                src={comparison.derived}
                alt="优化模型，同相机和曝光"
                style={{ clipPath: `inset(0 0 0 ${wipe}%)` }}
              />
            </div>
            <input
              aria-label="原始与派生对照分界"
              type="range"
              min={0}
              max={100}
              value={wipe}
              onChange={(e) => setWipe(Number(e.target.value))}
            />
            <p>像素 RMSE {comparison.rmse.toFixed(3)} / 255</p>
            <pre>
              {JSON.stringify(
                {
                  environment: comparison.environment,
                  sourceStats: comparison.sourceStats,
                  derivedStats: comparison.derivedStats,
                  note: comparison.note,
                },
                null,
                2,
              )}
            </pre>
          </>
        )}
      </section>
      {jobs.error && <p role="alert">{jobs.error}</p>}
    </div>
  );
}
