import { useEffect, useState } from "react";
import { componentDefinitions } from "@studio/scene-schema";
import { JobMonitor, useProcessingJobs } from "../../../../packages/extensions/jobs";
import type { ExtensionPanelProps } from "../../../../packages/extensions/editor-contract";
import { extensionTools } from "../../../../packages/extensions/editor";
import { useRuntime } from "@studio/player-ui";
import { SceneTree } from "../panels/SceneTree";
import { Inspector } from "../panels/Inspector";
import { Resources } from "../panels/Resources";
import { ContentPanel } from "../panels/ContentPanel";
import { TourPanel } from "../panels/TourPanel";
import { Interactions } from "../panels/Interactions";
import { InterfaceCanvas } from "../panels/InterfaceCanvas";
import { ProjectsDialog, VersionsDialog } from "../components/Dialogs";
import { ExtensionWindow, useExtensionProps } from "../extensions/ExtensionHost";
import { useStudio } from "../state/studio";
import { useConsoleLayout } from "./layout";
import { CommandButton } from "./CommandPanel";

const categories = [
  ["create", "+", "创建"], ["modify", "◈", "修改"], ["hierarchy", "⑂", "层级"],
  ["motion", "▷", "运动"], ["display", "◉", "显示"], ["utilities", "⚒", "实用工具"],
] as const;
function PropertiesPanel() {
  const category = useConsoleLayout((s) => s.category), selected = useStudio((s) => s.selected), document = useStudio((s) => s.document);
  const entity = document?.entities.find((item) => item.id === selected[0]);
  return <div className="console-properties">
    <div className="console-category-tabs" role="tablist" aria-label="通用命令分类">{categories.map(([id, icon, title]) => <button key={id} role="tab" aria-selected={category === id} aria-label={title} title={title} onClick={() => useConsoleLayout.getState().patch({ category: id })}><span>{icon}</span><small>{title}</small></button>)}</div>
    <div className="console-selection-summary"><span>{selected.length > 1 ? selected.length + " 个对象" : entity?.name || "场景设置"}</span><small>{entity?.components.map((item) => componentDefinitions.find((d) => d.type === item.type)?.title ?? item.type).join(" · ") || "共享选择 · 所有窗口同步"}</small></div>
    {(category === "modify" || category === "hierarchy") && <Inspector />}
    {category === "create" && <div className="console-tool-content"><h3>场景对象</h3>{["create.node", "create.light", "window.tour", "create.hotspot"].map((id) => <CommandButton key={id} id={id} />)}<h3>模板与扩展</h3>{extensionTools.map((tool) => <CommandButton key={tool.id} id={"extension." + tool.id} />)}<CommandButton id="window.extension.prefab" /><CommandButton id="window.resources" /></div>}
    {category === "motion" && <div className="console-tool-content"><h3>镜头与编排</h3>{["window.tour", "window.extension.storyboard", "window.extension.assembly"].map((id) => <CommandButton key={id} id={id} />)}<p>在原设计器中编辑全部镜头、轨道、曲线与步骤。</p></div>}
    {category === "display" && <div className="console-tool-content"><h3>视口显示</h3>{["view.grid", "view.statistics", "view.all", "view.selection", "view.focus", "view.fullscreen", "window.extension.industrial"].map((id) => <CommandButton key={id} id={id} />)}</div>}
    {category === "utilities" && <div className="console-tool-content"><h3>检查与处理</h3>{["window.problems", "window.jobs", "window.extension.optimization", "window.extension.annotation", "window.extension.piping", "studio.readiness", "window.performance"].map((id) => <CommandButton key={id} id={id} />)}</div>}
  </div>;
}
function ProblemsPanel() {
  const issues = useStudio((s) => s.issues), document = useStudio((s) => s.document), report = useStudio((s) => s.releaseReport);
  return <section className="console-tool-content"><div className="console-section-heading"><h3>问题与发布检查</h3><CommandButton id="studio.readiness" /></div>
    {!Object.keys(issues).length && <p>当前运行层未报告资源加载错误。发布依赖检查请运行“发布检查”。</p>}
    {Object.entries(issues).map(([id, error]) => <article className="console-problem" key={id}><button onClick={() => { useStudio.getState().select([id]); useConsoleLayout.getState().open("properties"); }}>{document?.entities.find((e) => e.id === id)?.name ?? id}</button><p role="alert">{error}</p></article>)}
    {report?.checks.map((check, index) => <p key={index}>{check.status} · {check.message}</p>)}
  </section>;
}
function OutputPanel() {
  const [rows, setRows] = useState<{ time: string; message: string }[]>([]);
  useEffect(() => useStudio.subscribe((state, old) => {
    const message = state.message !== old.message ? state.message : state.busy !== old.busy && state.busy ? state.busy + "…" : "";
    if (message) setRows((items) => [...items, { time: new Date().toLocaleTimeString(), message }].slice(-100));
  }), []);
  return <section className="console-tool-content"><div className="console-section-heading"><h3>本窗口操作记录</h3><button onClick={() => setRows([])}>清空显示</button></div>{rows.length ? <ol className="console-output">{rows.map((row, i) => <li key={i}><time>{row.time}</time><pre>{row.message}</pre></li>)}</ol> : <p>打开此窗口后的实际操作与错误会记录在这里。</p>}</section>;
}
function PerformancePanel() {
  const runtime = useStudio((s) => s.runtime), snapshot = useRuntime(runtime);
  const [metrics, setMetrics] = useState("");
  useEffect(() => {
    if (!runtime) return;
    const sample = () => setMetrics(JSON.stringify({ resources: runtime.stats(), renderer: { memory: runtime.engine.renderer.info.memory, render: runtime.engine.renderer.info.render }, systems: Object.fromEntries(runtime.systemMetrics) }, null, 2));
    sample();
    const timer = setInterval(sample, 1000);
    return () => clearInterval(timer);
  }, [runtime]);
  return <section className="console-tool-content"><h3>当前场景运行状态</h3><p>{snapshot.load.phase} · {snapshot.load.message}</p><pre className="console-metrics">{metrics || "视口尚未初始化"}</pre></section>;
}
function ProcessingJobs({ props }: { props: ExtensionPanelProps }) {
  const { jobs, error } = useProcessingJobs(props.services);
  return <section className="console-tool-content"><div className="console-section-heading"><h3>处理作业</h3><CommandButton id="window.extension.optimization">打开优化、对比与应用</CommandButton></div>{error && <p role="alert">{error}</p>}<JobMonitor services={props.services} jobs={jobs} />{!jobs.length && !error && <p>没有处理作业；在资产优化设计器中创建。</p>}</section>;
}
function JobsPanel() {
  const props = useExtensionProps("jobs");
  return props ? <ProcessingJobs props={props} /> : <div className="empty-state">打开工程后查看处理作业</div>;
}
export function WindowContent({ id }: { id: string }) {
  if (id.startsWith("extension.")) return <ExtensionWindow id={id.slice(10)} />;
  switch (id) {
    case "scene": return <SceneTree />;
    case "resources": return <Resources />;
    case "properties": return <PropertiesPanel />;
    case "content": return <ContentPanel />;
    case "tour": return <TourPanel />;
    case "interaction": return <Interactions />;
    case "interface": return <InterfaceCanvas />;
    case "projects": return <ProjectsDialog embedded close={() => useConsoleLayout.getState().close(id)} />;
    case "versions": return <VersionsDialog embedded close={() => useConsoleLayout.getState().close(id)} />;
    case "problems": return <ProblemsPanel />;
    case "output": return <OutputPanel />;
    case "performance": return <PerformancePanel />;
    case "jobs": return <JobsPanel />;
    default: throw Error("未注册的窗口内容：" + id);
  }
}
