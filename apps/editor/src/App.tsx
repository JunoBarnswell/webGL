import {
  workspaceCatalog,
  WorkspaceSidebar,
  WorkspaceDesigner,
} from "./workspaces/WorkspaceHost";
import { DockResize } from "./shell/DockResize";
import { ContextMenu } from "./shell/ContextMenu";
import { usePreferences } from "./shell/preferences";
import { execute, shortcuts } from "./shell/commands";
import { CommandPanel } from "./shell/CommandPanel";
import { useEffect, useRef, useState } from "react";
import { InterfaceCanvas } from "./panels/InterfaceCanvas";
import { clearAssetCache } from "@studio/scene-runtime";
import { runAssetTask } from "@studio/asset-pipeline";
import { localDraft, resolveLocalDraft } from "./state/journal";
import {
  Box,
  CloudUpload,
  FolderOpen,
  History,
  Play,
  Redo2,
  Save,
  Square,
  Undo2,
  Upload,
  X,
  LayoutDashboard,
  MoreHorizontal,
} from "lucide-react";
import { assertDocument, migrateDocument } from "@studio/scene-schema";
import { Inspector } from "./panels/Inspector";
import { Viewport } from "./panels/Viewport";
import { Resources } from "./panels/Resources";
import { Interactions } from "./panels/Interactions";
import {
  Login,
  ProjectsDialog,
  RecoveryDialog,
  VersionsDialog,
} from "./components/Dialogs";
import { useStudio } from "./state/studio";
import {
  ApiError,
  download,
  request,
  saveBlob,
  token,
  type CloudDraft,
} from "./state/api";

export default function App() {
  const [authenticated, setAuthenticated] = useState(Boolean(token())),
    [dialog, setDialog] = useState<"projects" | "versions" | null>(null),
    [published, setPublished] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const document = useStudio((s) => s.document),
    session = useStudio((s) => s.session),
    historyTarget = useStudio((s) => s.historyTarget),
    editingLibrary = useStudio((s) => s.editingLibrary),
    mode = useStudio((s) => s.mode),
    saveState = useStudio((s) => s.saveState),
    message = useStudio((s) => s.message),
    busy = useStudio((s) => s.busy),
    issues = useStudio((s) => s.issues),
    revision = useStudio((s) => s.revision);
  const [, refreshHistory] = useState(0);
  const activeHistory = historyTarget ?? session;
  useEffect(
    () => activeHistory?.subscribe(() => refreshHistory((value) => value + 1)),
    [activeHistory],
  );
  const workspace = useStudio((s) => s.workspace),
    assetsOpen = useStudio((s) => s.assetsOpen),
    inspectorOpen = useStudio((s) => s.inspectorOpen);
  const preferences = usePreferences();
  const leftOpen = preferences.leftOpen;
  const setLeftOpen = (value: boolean) =>
    preferences.patch({ leftOpen: value });
  useEffect(() => {
    const resize = () => {
      if (window.innerWidth < 1024)
        useStudio.getState().set({ inspectorOpen: false });
      if (window.innerWidth < 768) setLeftOpen(false);
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    if (!authenticated) return;
    void useStudio.getState().run("载入工作空间", async () => {
      try {
        await useStudio.getState().refreshProjects();
        const state = useStudio.getState();
        if (!state.session) {
          const last = localStorage.getItem("studio-last-scene");
          let reopened = false;
          if (last) {
            try {
              await state.open(
                await request<CloudDraft>("/scenes/" + last + "/draft"),
              );
              reopened = true;
            } catch (error) {
              if (!(error instanceof ApiError) || error.status !== 404)
                throw error;
              localStorage.removeItem("studio-last-scene");
            }
          }
          if (!reopened) {
            const project = state.projects[0];
            if (project)
              await state.open(
                await request<CloudDraft>(
                  "/scenes/" + project.sceneId + "/draft",
                ),
              );
            else setDialog("projects");
          }
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 401)
          setAuthenticated(false);
        else throw error;
      }
    });
    const online = () => {
      if (useStudio.getState().saveState === "offline")
        void useStudio.getState().save();
    };
    const expired = () => setAuthenticated(false);
    window.addEventListener("online", online);
    window.addEventListener("studio-auth-expired", expired);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("studio-auth-expired", expired);
    };
  }, [authenticated]);
  useEffect(() => shortcuts.attach(window), []);
  const importProject = async (files: FileList | null) => {
    if (!files?.length) return;
    const selected = files[0];
    await useStudio.getState().run("导入工程", async () => {
      let draft: CloudDraft;
      if (selected.name.endsWith(".zip"))
        draft = await request("/projects/import", {
          method: "POST",
          body: selected,
          headers: { "Content-Type": "application/zip" },
        });
      else {
        const document = migrateDocument(
          await runAssetTask<unknown>(
            "json",
            new Uint8Array(await selected.arrayBuffer()),
          ),
        ).document;
        assertDocument(document);
        draft = await request("/projects", {
          method: "POST",
          body: JSON.stringify({ name: document.name, document }),
        });
      }
      await useStudio.getState().open(draft, true);
      await useStudio.getState().refreshProjects();
    });
    if (file.current) file.current.value = "";
  };
  if (!authenticated) return <Login onLogin={() => setAuthenticated(true)} />;
  return (
    <div
      className={
        "studio-shell layout-" +
        preferences.layout +
        (mode === "play" ? " preview-shell" : "")
      }
      style={
        {
          "--studio-left-w": preferences.leftWidth + "px",
          "--studio-right-w": preferences.rightWidth + "px",
        } as React.CSSProperties
      }
    >
      <header className="app-header">
        <button
          className="brand"
          aria-label="打开工程管理"
          onClick={() => {
            void useStudio.getState().refreshProjects();
            setDialog("projects");
          }}
        >
          <span className="brand-symbol">
            <Box />
          </span>
          <span>
            WebGL <strong>Studio</strong>
          </span>
        </button>
        <span className="header-divider" />
        <button className="project-title" onClick={() => setDialog("projects")}>
          <FolderOpen size={15} />
          <span>{document?.name ?? "选择工程"}</span>
        </button>
        <details className="file-menu">
          <summary aria-label="工程菜单">
            <MoreHorizontal size={18} />
          </summary>
          <nav
            onClick={(event) =>
              event.currentTarget.parentElement?.removeAttribute("open")
            }
          >
            <button onClick={() => setDialog("projects")}>
              新建 / 打开 / 复制工程
            </button>
            <button
              disabled={!document}
              onClick={() => useStudio.getState().close()}
            >
              关闭工程
            </button>
            <button onClick={() => file.current?.click()}>
              <Upload />
              导入工程包
            </button>
            <button
              disabled={!document}
              onClick={() =>
                void useStudio.getState().run("导出工程", async () => {
                  await useStudio.getState().save();
                  if (useStudio.getState().saveState !== "saved")
                    throw new Error("当前修改未成功保存，导出已取消");
                  await download(
                    "/projects/" + useStudio.getState().projectId + "/export",
                    (document?.name ?? "project") + ".studio.zip",
                  );
                })
              }
            >
              导出完整工程包
            </button>
            <button
              disabled={!document}
              onClick={() => {
                if (document)
                  window.open(
                    "/player/?scene=" + document.sceneId,
                    "_blank",
                    "noopener",
                  );
              }}
            >
              打开独立 Player
            </button>
            <button
              disabled={!document}
              onClick={() =>
                void useStudio.getState().run("取消发布", async () => {
                  await request("/scenes/" + document!.sceneId + "/publish", {
                    method: "DELETE",
                  });
                  useStudio.getState().set({ message: "已取消发布" });
                })
              }
            >
              取消发布
            </button>
            <button
              disabled={!document}
              onClick={() => {
                if (document)
                  saveBlob(
                    new Blob([JSON.stringify(document, null, 2)], {
                      type: "application/json",
                    }),
                    document.name + ".scene.json",
                  );
              }}
            >
              导出场景文档
            </button>
            <button onClick={() => execute("layout.restore")}>
              <LayoutDashboard />
              重置面板布局
            </button>
            <button
              onClick={() => {
                useStudio.getState().close();
                clearAssetCache();
                sessionStorage.removeItem("studio-token");
                setAuthenticated(false);
              }}
            >
              退出登录
            </button>
          </nav>
        </details>
        <input
          ref={file}
          type="file"
          accept=".zip,.json"
          hidden
          aria-label="导入工程文件"
          onChange={(event) => void importProject(event.target.files)}
        />
        <button
          title="搜索命令 Ctrl+."
          aria-label="搜索命令"
          onClick={() => execute("palette.open")}
        >
          ⌕
        </button>
        <button aria-label="专注模式" onClick={() => execute("view.focus")}>
          ⛶
        </button>
        <label className="workspace-switcher">
          工作空间{" "}
          <select
            aria-label="工作空间"
            value={workspace}
            disabled={mode === "play"}
            onChange={(event) => execute("workspace." + event.target.value)}
          >
            {workspaceCatalog.map((w) => (
              <option key={w.id} value={w.id}>
                {w.icon} {w.title}
              </option>
            ))}
          </select>
        </label>
        <select
          aria-label="工作台布局"
          value={preferences.layout}
          onChange={(e) => {
            preferences.patch({
              layout: e.target.value as typeof preferences.layout,
              leftOpen: e.target.value === "standard",
            });
            useStudio
              .getState()
              .set({ inspectorOpen: e.target.value === "standard" });
          }}
        >
          <option value="standard">标准</option>
          <option value="compact">紧凑</option>
          <option value="focus">专注</option>
        </select>
        <div className="header-spacer" />
        <div className="history-controls">
          <button
            className="icon-button"
            aria-label="撤销"
            title="撤销 Ctrl+Z"
            disabled={!activeHistory?.canUndo || mode === "play"}
            onClick={() => execute("document.undo")}
          >
            <Undo2 />
          </button>
          <button
            className="icon-button"
            aria-label="重做"
            title="重做 Ctrl+Shift+Z"
            disabled={!activeHistory?.canRedo || mode === "play"}
            onClick={() => execute("document.redo")}
          >
            <Redo2 />
          </button>
        </div>
        <button
          className={"preview-button " + (mode === "play" ? "active" : "")}
          disabled={!document || Boolean(busy)}
          onClick={() => execute("view.preview")}
        >
          {mode === "play" ? <Square size={14} /> : <Play size={14} />}
          <span>{mode === "play" ? "停止预览" : "预览"}</span>
        </button>
        <button
          className="save-button"
          disabled={!document || saveState === "saving" || Boolean(busy)}
          onClick={() => execute("document.save")}
        >
          <Save size={15} />
          <span>保存</span>
        </button>
        <button
          className="icon-button"
          title="版本历史"
          aria-label="版本历史"
          disabled={!document}
          onClick={() => setDialog("versions")}
        >
          <History />
        </button>
        <button
          className="primary publish-button"
          disabled={
            !document ||
            Boolean(busy) ||
            mode === "play" ||
            Boolean(editingLibrary)
          }
          onClick={() =>
            void useStudio.getState().run("发布场景", async () => {
              await useStudio.getState().save();
              if (useStudio.getState().saveState !== "saved")
                throw new Error("草稿尚未成功保存，请先处理保存状态");
              const result = await request<{
                versionId: string;
                playerUrl: string;
              }>("/scenes/" + document!.sceneId + "/publish", {
                method: "POST",
                body: JSON.stringify({
                  expectedRevision: useStudio.getState().revision,
                }),
              });
              setPublished(result.playerUrl);
            })
          }
        >
          <CloudUpload size={16} />
          发布
        </button>
      </header>
      {saveState === "conflict" && (
        <div className="conflict-bar">
          <span>保存冲突：本地修改已保留。</span>
          <button
            onClick={() =>
              void useStudio.getState().run("另存工程", async () => {
                const draft = await request<CloudDraft>("/projects", {
                  method: "POST",
                  body: JSON.stringify({
                    name: document!.name + " 本地副本",
                    document,
                  }),
                });
                if (useStudio.getState().document !== document)
                  throw new Error(
                    "副本已创建；另存期间工程又发生变化，当前本地事务已保留",
                  );
                const pending = await localDraft(document!.sceneId);
                if (pending)
                  await resolveLocalDraft(
                    pending.sceneId,
                    pending.workspaceId,
                    pending.committedAt,
                  );
                await useStudio.getState().open(draft, true);
              })
            }
          >
            另存为工程
          </button>
          <button
            onClick={() =>
              void useStudio.getState().run("读取云端", async () => {
                const draft = await request<CloudDraft>(
                  "/scenes/" + document!.sceneId + "/draft",
                );
                await useStudio.getState().open(draft, true);
              })
            }
          >
            读取云端草稿
          </button>
        </div>
      )}
      <nav
        hidden={!preferences.rail}
        className="task-navigation"
        aria-label="创作任务"
      >
        <div className="header-spacer" />
        <button
          className={leftOpen ? "active" : ""}
          disabled={workspace === "interface"}
          onClick={() => {
            setLeftOpen(!leftOpen);
            if (window.innerWidth < 1024)
              useStudio.getState().set({ inspectorOpen: false });
          }}
        >
          {mode === "play" && workspace === "interaction"
            ? "调试面板"
            : "任务面板"}
        </button>
        <button
          className={assetsOpen ? "active" : ""}
          onClick={() => useStudio.getState().set({ assetsOpen: !assetsOpen })}
        >
          资源库
        </button>
        <button
          className={inspectorOpen ? "active" : ""}
          disabled={workspace === "interface"}
          onClick={() => {
            useStudio.getState().set({ inspectorOpen: !inspectorOpen });
            if (window.innerWidth < 1024) setLeftOpen(false);
          }}
        >
          属性
        </button>
      </nav>
      <main
        className={
          "creation-workspace task-" +
          workspace +
          (mode === "play" ? " is-preview" : "")
        }
      >
        {workspace !== "interface" && leftOpen && mode === "edit" && (
          <aside className="task-sidebar">
            <DockResize side="left" />
            <WorkspaceSidebar />
          </aside>
        )}
        <div className="creation-main">
          <div
            className={
              "persistent-viewport " +
              (workspace === "interface" && mode === "edit"
                ? "behind-canvas"
                : "")
            }
          >
            <Viewport />
          </div>
          {workspace === "interface" && mode === "edit" && <InterfaceCanvas />}
          {mode === "edit" && <WorkspaceDesigner />}
          {assetsOpen && mode === "edit" && (
            <div className="resource-drawer">
              <Resources />
            </div>
          )}
        </div>
        {workspace !== "interface" && inspectorOpen && mode === "edit" && (
          <aside className="properties-sidebar">
            <DockResize side="right" />
            <Inspector />
          </aside>
        )}
        {mode === "play" && workspace === "interaction" && leftOpen && (
          <aside className="preview-debug">
            <Interactions />
          </aside>
        )}
      </main>
      <ContextMenu />
      <CommandPanel />
      {preferences.layout === "focus" && mode === "edit" && (
        <div className="focus-exit">
          <button onClick={() => execute("view.focus")}>退出专注 Space</button>
          <button onClick={() => execute("layout.restore")}>恢复布局</button>
        </div>
      )}
      {busy && (
        <div className="operation-status" role="status">
          {busy}…
        </div>
      )}
      <footer className="status-bar">
        <div>
          <span className={"status-dot " + saveState} />
          <span>
            {!document
              ? "未打开工程"
              : (
                  {
                    saved: "已保存到云端",
                    dirty: "本地已提交 · 等待保存",
                    saving: "正在保存…",
                    offline: "云端保存失败 · 本地事务已保留",
                    conflict: "版本冲突",
                  } as const
                )[saveState]}
          </span>
          <small>修订 {revision}</small>
        </div>
        <span>
          {busy ||
            (Object.keys(issues).length
              ? Object.keys(issues).length + " 项资源加载问题"
              : "SceneDocument · 毫米")}
        </span>
      </footer>
      {message && (
        <aside className="notification" role="alert">
          <button
            className="icon-button"
            aria-label="关闭消息"
            onClick={() => useStudio.getState().set({ message: "" })}
          >
            <X />
          </button>
          <strong>操作信息</strong>
          <pre>{message}</pre>
          {saveState === "offline" && (
            <button onClick={() => execute("document.save")}>重新保存</button>
          )}
        </aside>
      )}
      {Object.keys(issues).length > 0 && (
        <details className="runtime-issues">
          <summary>资源加载问题 · {Object.keys(issues).length}</summary>
          {Object.entries(issues).map(([id, error]) => (
            <p key={id}>
              {document?.entities.find((e) => e.id === id)?.name ?? id}：{error}
            </p>
          ))}
        </details>
      )}
      {dialog === "projects" && (
        <ProjectsDialog close={() => setDialog(null)} />
      )}{" "}
      {dialog === "versions" && (
        <VersionsDialog close={() => setDialog(null)} />
      )}
      <RecoveryDialog />
      {published && (
        <div className="modal-backdrop">
          <section
            className="modal compact"
            role="dialog"
            aria-modal="true"
            aria-label="发布完成"
          >
            <h2>场景已发布</h2>
            <p>独立 Player 已就绪，公开访问已发布版本。</p>
            <div className="button-group">
              <a
                className="button primary"
                href={published}
                target="_blank"
                rel="noreferrer"
              >
                打开 Player
              </a>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(
                    location.origin + published,
                  );
                }}
              >
                复制地址
              </button>
              <button onClick={() => setPublished("")}>完成</button>
            </div>
            <button
              className="text-button danger"
              onClick={() =>
                void useStudio.getState().run("取消发布", async () => {
                  await request("/scenes/" + document!.sceneId + "/publish", {
                    method: "DELETE",
                  });
                  setPublished("");
                })
              }
            >
              取消发布
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
