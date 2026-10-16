import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { bindingConflicts } from "@studio/editor-core";
import { commands, execute, context } from "./commands";
import { usePreferences } from "./preferences";
import { useStudio } from "../state/studio";
import { useConsoleLayout } from "./layout";
import type { ReactNode } from "react";
export function CommandButton({ id, children, icon = false }: { id: string; children?: ReactNode; icon?: boolean }) {
  useSyncExternalStore(commands.subscribe, commands.getVersion);
  useStudio((s) => s.document);
  useStudio((s) => s.selected);
  useStudio((s) => s.mode);
  useStudio((s) => s.busy);
  useStudio((s) => s.saveState);
  useStudio((s) => s.historyTarget);
  useConsoleLayout((s) => s.activeWindow);
  const command = commands.commands.get(id);
  if (!command) return null;
  const binding = usePreferences.getState().bindings[id] ?? command.shortcuts ?? [];
  return <button className={icon ? "console-icon-command" : "console-command"} aria-label={command.title} title={command.title + (binding.length ? " · " + binding.join(" / ") : "")} disabled={!commands.allowed(command, context())} onClick={() => execute(id)}>{children ?? command.title}</button>;
}
export function CommandPanel() {
  useSyncExternalStore(commands.subscribe, commands.getVersion);
  const kind = useStudio((s) => s.commandPanel),
    preferences = usePreferences();
  const [query, setQuery] = useState(""),
    [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string,string>>({});
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!kind) return;
    const previous = document.activeElement as HTMLElement | null;
    host.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => previous?.focus();
  }, [kind]);
  if (!kind) return null;
  return (
    <div
      className="modal-backdrop"
      ref={host}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          useStudio.getState().set({ commandPanel: null });
        }
      }}
    >
      <section
        className="modal command-panel"
        role="dialog"
        aria-modal="true"
        aria-label={kind === "search" ? "搜索命令" : "快捷键设置"}
      >
        <header>
          <h2>{kind === "search" ? "搜索命令" : "快捷键设置"}</h2>
          <button
            onClick={() => useStudio.getState().set({ commandPanel: null })}
          >
            关闭 Esc
          </button>
        </header>
        <input
          aria-label="查找命令"
          placeholder="名称 / 分类 / command"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {kind === "shortcuts" && (
          <label>
            <input
              type="checkbox"
              checked={preferences.characterKeys}
              onChange={(e) =>
                preferences.patch({ characterKeys: e.target.checked })
              }
            />
            启用视口字符快捷键
          </label>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="command-results">
          {commands.search(query).map((command) => (
            <div key={command.id} className="command-row" data-command-id={command.id}>
              <button
                disabled={!commands.allowed(command, context())}
                onClick={() => {
                  useStudio.getState().set({ commandPanel: null });
                  execute(command.id);
                }}
              >
                {command.title}
                <small>{command.category}</small>
              </button>
              {kind === "search" ? (
                <kbd>
                  {(
                    preferences.bindings[command.id] ??
                    command.shortcuts ??
                    []
                  ).join(" / ")}
                </kbd>
              ) : (
                <input
                  aria-label={command.title + " 快捷键"}
                  value={drafts[command.id] ?? (
                    preferences.bindings[command.id] ??
                    command.shortcuts ??
                    []
                  ).join(",")}
                  onChange={event => setDrafts({...drafts,[command.id]:event.target.value})}
                  onBlur={(e) => {
                    const bindings = {
                      ...preferences.bindings,
                      [command.id]: e.target.value
                        .split(",")
                        .map((v) => v.trim())
                        .filter(Boolean),
                    };
                    const errors = bindingConflicts(commands, bindings);
                    setError(errors.join("；"));
                    if (!errors.length) preferences.patch({ bindings });
                  }}
                />
              )}
            </div>
          ))}
        </div>
        {kind === "shortcuts" && (
          <button
            onClick={() => {
              preferences.patch({ bindings: {}, characterKeys: true });
              setError("");
              setDrafts({});
            }}
          >
            恢复默认快捷键
          </button>
        )}
      </section>
    </div>
  );
}
