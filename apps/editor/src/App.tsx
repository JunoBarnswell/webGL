import { useEffect, useRef, useState } from "react";
import { clearAssetCache } from "@studio/scene-runtime";
import { runAssetTask } from "@studio/asset-pipeline";
import { assertDocument, migrateDocument } from "@studio/scene-schema";
import type { StudioCommand } from "@studio/editor-core";
import { localDraft, resolveLocalDraft } from "./state/journal";
import { Login, RecoveryDialog } from "./components/Dialogs";
import { ReleaseReadinessDialog } from "./components/ReleaseReadinessDialog";
import { useStudio } from "./state/studio";
import { ApiError, download, request, saveBlob, token, type CloudDraft } from "./state/api";
import { ContextMenu } from "./shell/ContextMenu";
import { CommandPanel } from "./shell/CommandPanel";
import { commands, execute, shortcuts } from "./shell/commands";
import { useConsoleLayout } from "./shell/layout";
import { ConsoleDock } from "./shell/ConsoleDock";
import { ConsoleChrome, ConsoleStatusBar } from "./shell/ConsoleChrome";
import { useExtensionCommands } from "./extensions/ExtensionHost";
import "./shell/console.css";

export default function App() {
  const [authenticated, setAuthenticated] = useState(Boolean(token())), [published, setPublished] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const document = useStudio((s) => s.document), mode = useStudio((s) => s.mode), saveState = useStudio((s) => s.saveState), message = useStudio((s) => s.message), busy = useStudio((s) => s.busy);
  const layout = useConsoleLayout();
  useExtensionCommands();
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
            else useConsoleLayout.getState().open("projects");
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
  useEffect(() => {
    const current = () => {
      const state = useStudio.getState();
      if (!state.document) throw Error("未打开工程");
      return { ...state, document: state.document };
    };
    const hasDocument = () => Boolean(useStudio.getState().document) && !useStudio.getState().busy;
    const items: StudioCommand[] = [
      { id: "project.manage", title: "新建 / 打开 / 复制工程", execute: async () => { await useStudio.getState().run("读取工程", () => useStudio.getState().refreshProjects()); useConsoleLayout.getState().open("projects"); } },
      { id: "project.close", title: "关闭工程", enabled: hasDocument, execute: () => useStudio.getState().close() },
      { id: "project.import", title: "导入工程包 / 场景文档", execute: () => file.current?.click() },
      { id: "project.export", title: "导出完整工程包", enabled: hasDocument, execute: async () => {
        const state = current();
        await state.save();
        if (useStudio.getState().saveState !== "saved") throw Error("当前修改未成功保存，导出已取消");
        await download("/projects/" + state.projectId + "/export", state.document.name + ".studio.zip");
      } },
      { id: "project.documentExport", title: "导出场景文档", enabled: hasDocument, execute: () => {
        const { document } = current();
        saveBlob(new Blob([JSON.stringify(document, null, 2)], { type: "application/json" }), document.name + ".scene.json");
      } },
      { id: "project.player", title: "打开独立 Player", enabled: hasDocument, execute: () => { window.open("/player/?scene=" + current().document.sceneId, "_blank", "noopener"); } },
      { id: "project.unpublish", title: "取消场景发布", enabled: hasDocument, execute: async () => {
        await useStudio.getState().run("取消发布", async () => { await request("/scenes/" + current().document.sceneId + "/publish", { method: "DELETE" }); useStudio.getState().set({ message: "已取消发布" }); });
      } },
      { id: "scene.publish", title: "发布场景", enabled: () => hasDocument() && useStudio.getState().mode === "edit" && !useStudio.getState().editingLibrary, execute: async () => {
        await useStudio.getState().run("发布场景", async () => {
          const state = current();
          await state.save();
          if (useStudio.getState().saveState !== "saved") throw Error("草稿尚未成功保存，请先处理保存状态");
          const result = await request<{ versionId: string; playerUrl: string }>("/scenes/" + state.document.sceneId + "/publish", { method: "POST", body: JSON.stringify({ expectedRevision: useStudio.getState().revision }) });
          setPublished(result.playerUrl);
        });
      } },
      { id: "project.logout", title: "退出登录", execute: () => { useStudio.getState().close(); clearAssetCache(); sessionStorage.removeItem("studio-token"); setAuthenticated(false); } },
    ].map((item) => ({ ...item, category: "工程", scope: "global" } as StudioCommand));
    const remove = items.map((item) => commands.register(item));
    return () => remove.forEach((unregister) => unregister());
  }, []);
  if (!authenticated) return <Login onLogin={() => setAuthenticated(true)} />;
  return <div className="console-shell" data-mode={mode} data-immersive={layout.focus || mode === "play"} data-density={layout.density} onKeyDownCapture={(event) => {
    if (event.key !== "Tab" || event.nativeEvent.isComposing) return;
    const target = event.target as HTMLElement;
    const modal = target.closest<HTMLElement>('[role="dialog"][aria-modal="true"]') ?? [...event.currentTarget.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')].at(-1);
    if (!modal) return;
    const items = [...modal.querySelectorAll<HTMLElement>('input,select,textarea,button,a[href],[tabindex]:not([tabindex="-1"])')].filter((item) => !item.matches(":disabled") && item.getClientRects().length > 0);
    const first = items[0], last = items.at(-1);
    if (!modal.contains(target) || event.shiftKey && target === first || !event.shiftKey && target === last) {
      event.preventDefault(); (event.shiftKey ? last : first)?.focus();
    }
  }}>
    <ConsoleChrome />
    <input ref={file} type="file" accept=".zip,.json" hidden aria-label="导入工程文件" onChange={(event) => void importProject(event.target.files)} />
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
    {layout.notice && <div className="console-layout-notice" role="alert"><span>{layout.notice}</span><button onClick={() => layout.patch({ notice: "" })}>关闭</button><button onClick={() => layout.restore()}>恢复展厅布局</button></div>}
    <ConsoleDock />
    <ConsoleStatusBar />
    <ContextMenu /><CommandPanel /><ReleaseReadinessDialog />
    {layout.focus && mode === "edit" && <div className="console-immersive-exit"><button onClick={() => execute("view.focus")}>退出专注 Space</button><button onClick={() => execute("layout.restore")}>恢复布局</button></div>}
    {busy && <div className="operation-status" role="status">{busy}…</div>}
    {message && <aside className="notification" role="alert"><button className="icon-button" aria-label="关闭消息" onClick={() => useStudio.getState().set({ message: "" })}>×</button><strong>操作信息</strong><pre>{message}</pre>{saveState === "offline" && <button onClick={() => execute("document.save")}>重新保存</button>}</aside>}
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
  </div>;
}
