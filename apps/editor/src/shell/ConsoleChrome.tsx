import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Box, Search, Undo2, Redo2, MousePointer2, Move, RotateCw, Maximize, Magnet, Focus, Save, Play, Square, CloudUpload, PanelLeft, ChevronsUpDown, X, Settings2 } from "lucide-react";
import { useStudio } from "../state/studio";
import { saveBlob } from "../state/api";
import { commands, execute } from "./commands";
import { CommandButton } from "./CommandPanel";
import { useConsoleLayout } from "./layout";
import { windows, windowById, layoutPresets } from "./windows";

const menus = [
  ["文件", "File", ["project.manage", "project.close", "project.import", "project.export", "project.documentExport", "document.save", "window.versions", "project.logout"]],
  ["编辑", "Edit", ["document.undo", "document.redo", "document.duplicate", "document.delete", "palette.open"]],
  ["工具", "Tools", ["tool.select", "tool.translate", "tool.rotate", "tool.scale", "view.space", "view.snap", "layout.tools"]],
  ["层级", "Group", ["window.scene", "window.properties", "window.extension.prefab"]],
  ["视图", "View", ["view.selection", "view.all", "view.grid", "view.statistics", "view.focus", "view.fullscreen", "window.performance"]],
  ["创建", "Create", ["create.node", "create.light", "create.hotspot", "window.resources", "window.tour"]],
  ["修改", "Modify", ["window.properties", "window.extension.prefab", "window.extension.annotation"]],
  ["动画", "Animation", ["window.extension.storyboard", "window.extension.assembly", "window.tour"]],
  ["渲染", "Rendering", ["view.preview", "project.player", "window.performance", "window.extension.optimization"]],
  ["展厅", "Exhibition", ["window.content", "window.tour", "window.interaction", "window.interface", "window.extension.virtual-tour", "studio.readiness", "scene.publish", "project.unpublish"]],
  ["扩展", "Extensions", windows.filter((item) => item.id.startsWith("extension.")).map((item) => "window." + item.id)],
  ["窗口", "Window", []],
  ["帮助", "Help", ["palette.open", "shortcuts.open"]],
] as const;
const toolIcons: Record<string, React.ReactNode> = {
  "tool.select": <MousePointer2 />, "tool.translate": <Move />, "tool.rotate": <RotateCw />, "tool.scale": <Maximize />,
  "view.selection": <Focus />, "view.snap": <Magnet />, "view.space": <ChevronsUpDown />,
};
export function ConsoleChrome() {
  useSyncExternalStore(commands.subscribe, commands.getVersion);
  const layout = useConsoleLayout(), name = useStudio((s) => s.document?.name), mode = useStudio((s) => s.mode), session = useStudio((s) => s.historyTarget ?? s.session), tool = useStudio((s) => s.tool), snap = useStudio((s) => s.snap), saveState = useStudio((s) => s.saveState);
  const [, historyChanged] = useState(0);
  const [customize, setCustomize] = useState(false), [filter, setFilter] = useState("");
  const [layoutName, setLayoutName] = useState<string | null>(null), [layoutError, setLayoutError] = useState("");
  const layoutFile = useRef<HTMLInputElement>(null);
  useEffect(() => session?.subscribe(() => historyChanged((value) => value + 1)), [session]);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!(event.target as HTMLElement).closest(".console-menubar")) document.querySelectorAll(".console-menu[open]").forEach((menu) => menu.removeAttribute("open")); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, []);
  useEffect(() => {
    const remove = [
      commands.register({ id: "layout.export", title: "导出窗口布局", category: "窗口", scope: "global", execute: () => {
        const value = useConsoleLayout.getState().api?.toJSON();
        if (!value) throw Error("窗口未就绪");
        saveBlob(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }), "studio-console.layout.json");
      } }),
      commands.register({ id: "layout.import", title: "导入窗口布局", category: "窗口", scope: "global", execute: () => layoutFile.current?.click() }),
      commands.register({ id: "layout.save", title: "保存为私人布局", category: "窗口", scope: "global", execute: () => {
        setLayoutName("我的布局"); setLayoutError("");
      } }),
      commands.register({ id: "layout.tools", title: "自定义快捷工具组", category: "窗口", scope: "global", execute: () => setCustomize(true) }),
    ];
    return () => remove.forEach((unregister) => unregister());
  }, []);
  return <>
    <header className="console-titlebar"><button className="console-brand" onClick={() => execute("project.manage")}><Box size={19} /><span>WEBGL <b>STUDIO</b></span></button><span className="console-title-divider" /><span className="console-document-name">{name ?? "创作控制台"}{saveState === "dirty" ? " •" : ""}</span><span className="console-title-spacer" /><button className="console-quick-search" onClick={() => execute("palette.open")}><Search size={14} /><span>搜索命令与窗口</span><kbd>Ctrl + .</kbd></button></header>
    <nav className="console-menubar" aria-label="主菜单" onKeyDown={(event) => {
      if (event.isDefaultPrevented() || event.nativeEvent.isComposing) return;
      const target = event.target as HTMLElement, menu = target.closest<HTMLDetailsElement>("details.console-menu");
      if (!menu) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); menu.open = false; menu.querySelector<HTMLElement>("summary")?.focus(); }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault(); menu.open = true;
        const buttons = [...menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        const index = buttons.indexOf(target as HTMLButtonElement);
        buttons[(index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const menus = [...event.currentTarget.querySelectorAll<HTMLDetailsElement>("details.console-menu")];
        const index = menus.indexOf(menu), next = menus[(index + (event.key === "ArrowRight" ? 1 : menus.length - 1)) % menus.length];
        menu.open = false; next.open = true; next.querySelector<HTMLElement>("summary")?.focus();
      }
    }}>{menus.map(([title, en, ids]) => <details key={en} className="console-menu" onToggle={(event) => {
      if (event.currentTarget.open) event.currentTarget.parentElement?.querySelectorAll("details[open]").forEach((other) => { if (other !== event.currentTarget) other.removeAttribute("open"); });
    }}><summary>{title}<small>{en}</small></summary><div className="console-menu-content" role="menu" aria-label={title} onClick={(event) => { if ((event.target as HTMLElement).closest("button")) event.currentTarget.parentElement?.removeAttribute("open"); }}>
      {en === "Window" ? <><strong>布局预设</strong>{layoutPresets.map((preset) => <CommandButton key={preset.id} id={"layout." + preset.id} />)}<strong>所有窗口</strong>{windows.map((item) => <CommandButton key={item.id} id={"window." + item.id} />)}<strong>管理布局</strong>{["window.float", "window.dock", "window.autoHide", "window.close", "layout.save", "layout.import", "layout.export", "layout.restore", "window.next", "window.previous"].map((id) => <CommandButton key={id} id={id} />)}{layout.saved.map((saved) => <div className="console-saved-layout" key={saved.name}><button onClick={() => { try { layout.importLayout(saved.layout); } catch (error) { useStudio.getState().set({ message: String(error) }); } }}>{saved.name}</button><button aria-label={"删除私人布局 " + saved.name} onClick={() => layout.patch({ saved: layout.saved.filter((item) => item.name !== saved.name) })}><X size={12} /></button></div>)}</> : ids.map((id) => <CommandButton key={id} id={id} />)}
    </div></details>)}</nav>
    <div className="console-main-toolbar" role="toolbar" aria-label="主工具栏">
      <div className="console-tool-cluster"><CommandButton id="project.manage" icon><PanelLeft /></CommandButton><CommandButton id="document.save" icon><Save /></CommandButton></div>
      <div className="console-tool-cluster"><CommandButton id="document.undo" icon><Undo2 /></CommandButton><CommandButton id="document.redo" icon><Redo2 /></CommandButton></div>
      <div className="console-tool-cluster">{layout.tools.map((id) => <span key={id} className={id === "tool." + tool || id === "view.snap" && snap ? "is-selected" : ""}><CommandButton id={id} icon={Boolean(toolIcons[id])}>{toolIcons[id]}</CommandButton></span>)}<button aria-label="自定义工具组" title="自定义工具组" onClick={() => setCustomize(true)}><Settings2 size={13} /></button></div>
      <label className="console-preset-select"><span>工作区</span><select aria-label="控制台布局预设" value={layout.preset} onChange={(e) => execute("layout." + e.target.value)}>{layoutPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.title}</option>)}</select></label>
      <div className="console-title-spacer" />
      <CommandButton id="view.preview">{mode === "play" ? <Square size={13} /> : <Play size={13} />}{mode === "play" ? "停止预览" : "预览"}</CommandButton>
      <span className="console-publish"><CommandButton id="scene.publish"><CloudUpload size={14} />发布</CommandButton></span>
    </div>
    {layout.rail && <nav className="console-task-strip" aria-label="创作任务"><span className="console-section-label">创作</span>{[["scene", "场景"], ["content", "热点内容"], ["tour", "导览巡航"], ["interaction", "事件交互"], ["interface", "界面设计"]].map(([id, title]) => <button key={id} className={layout.activeWindow === id ? "active" : ""} onClick={() => execute("workspace." + id)}>{title}</button>)}<span className="console-title-spacer" /><CommandButton id="window.resources">资产</CommandButton><CommandButton id="window.projects">项目</CommandButton><CommandButton id="window.properties">属性</CommandButton><select aria-label="界面密度" value={layout.density} onChange={(e) => layout.patch({ density: e.target.value as typeof layout.density })}><option value="compact">专业密度</option><option value="comfortable">舒适密度</option></select></nav>}
    <input ref={layoutFile} hidden type="file" accept=".json" aria-label="导入窗口布局文件" onChange={(event) => {
      const file = event.target.files?.[0];
      if (file) void file.text().then((text) => layout.importLayout(JSON.parse(text))).catch((error) => useStudio.getState().set({ message: "导入布局失败：" + String(error) }));
      event.target.value = "";
    }} />
    {layoutName !== null && <div className="modal-backdrop"><form className="modal compact" role="dialog" aria-modal="true" aria-label="保存私人布局" onSubmit={(event) => {
      event.preventDefault();
      try { useConsoleLayout.getState().saveLayout(layoutName); setLayoutName(null); } catch (error) { setLayoutError(String(error)); }
    }} onKeyDown={(event) => { if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.stopPropagation(); setLayoutName(null); } }}><h2>保存私人布局</h2><p>保存当前窗口的位置、标签与浮动状态。</p><label>布局名称<input autoFocus aria-label="布局名称" value={layoutName} maxLength={60} onChange={(event) => setLayoutName(event.target.value)} required /></label>{layoutError && <p role="alert">{layoutError}</p>}<div className="button-group"><button type="button" onClick={() => setLayoutName(null)}>取消保存</button><button type="submit" className="primary">保存布局</button></div></form></div>}
    {customize && <div className="modal-backdrop"><section className="modal compact" role="dialog" aria-modal="true" aria-label="自定义快捷工具组" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setCustomize(false); } }}><div className="modal-header"><h2>快捷工具组</h2><button onClick={() => setCustomize(false)}>完成</button></div><p>选择需要常驻工具栏的命令，最多 16 项。</p><input autoFocus aria-label="筛选工具命令" value={filter} onChange={(e) => setFilter(e.target.value)} /><div className="console-customize-list">{commands.search(filter).map((command) => <label key={command.id}><input type="checkbox" checked={layout.tools.includes(command.id)} disabled={layout.tools.length >= 16 && !layout.tools.includes(command.id)} onChange={(e) => layout.patch({ tools: e.target.checked ? [...layout.tools, command.id] : layout.tools.filter((id) => id !== command.id) })} /><span>{command.title}<small>{command.category}</small></span></label>)}</div></section></div>}
  </>;
}
export function ConsoleStatusBar() {
  const activeWindow = useConsoleLayout((s) => s.activeWindow);
  const saveState = useStudio((s) => s.saveState), revision = useStudio((s) => s.revision), document = useStudio((s) => s.document), busy = useStudio((s) => s.busy), issues = useStudio((s) => s.issues), selected = useStudio((s) => s.selected), snap = useStudio((s) => s.snap), transforms = useStudio((s) => s.transforms);
  const entity = document?.entities.find((item) => item.id === selected[0]);
  const position = entity ? (transforms[entity.id] ?? entity.transform).position : null;
  const labels = { saved: "已保存到云端", dirty: "本地事务已保留 · 等待保存", saving: "正在保存…", offline: "保存失败 · 本地事务已保留", conflict: "版本冲突" };
  return <footer className="console-statusbar"><span className={"status-dot " + saveState} /><button onClick={() => execute(saveState === "offline" ? "document.save" : "window.versions")}>{document ? labels[saveState] : "未打开工程"}</button><span>修订 {revision}</span><span className="console-status-selection">{selected.length ? selected.length + " 个对象" : "未选择"}</span><span className="console-title-spacer" /><span className="console-active-window" title="当前命令与快捷键作用窗口">{windowById.get(activeWindow)?.title}</span>{position && <code className="console-coordinates">{position.map((value, index) => "XYZ"[index] + " " + value.toFixed(1)).join("　")}</code>}<span>毫米</span><span>{snap ? "吸附开启" : "自由变换"}</span><button onClick={() => execute("window.problems")}>{busy || (Object.keys(issues).length ? Object.keys(issues).length + " 项问题" : "问题 0")}</button><button onClick={() => execute("window.performance")}>运行性能</button></footer>;
}
