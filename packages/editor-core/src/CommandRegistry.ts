export type FocusScope =
  | "editor"
  | "viewport"
  | "preview"
  | "dialog"
  | "text-input"
  | "interface"
  | "timeline";
export interface CommandContext {
  surface: FocusScope;
  owner?: string;
  editingAllowed: boolean;
  selectedIds: readonly string[];
  flying: boolean;
  dragging: boolean;
  signal: AbortSignal;
}
export interface StudioCommand {
  id: string;
  title: string;
  category: string;
  keywords?: string;
  shortcuts?: string[];
  allowInTextInput?: boolean;
  allowInDialog?: boolean;
  allowDuringNavigation?: boolean;
  commitText?: boolean;
  preventNativeWhenBlocked?: boolean;
  scope: "global" | "editor" | "viewport" | "preview" | "timeline";
  shortcutOwner?: string;
  enabled?: (ctx: CommandContext) => boolean;
  execute: (ctx: CommandContext) => void | Promise<void>;
}
export class CommandRegistry {
  readonly commands = new Map<string, StudioCommand>();
  readonly recent: string[] = [];
  private revision = 0;
  private readonly listeners = new Set<() => void>();
  readonly getVersion = () => this.revision;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private changed() {
    this.revision++;
    this.listeners.forEach((listener) => listener());
  }
  register(command: StudioCommand): () => void {
    if (this.commands.has(command.id)) throw Error("重复命令 " + command.id);
    this.commands.set(command.id, command);
    this.changed();
    return () => { this.commands.delete(command.id); this.changed(); };
  }
  allowed(command: StudioCommand, context: CommandContext): boolean {
    return !context.signal.aborted && (command.enabled?.(context) ?? true);
  }
  async execute(id: string, context: CommandContext): Promise<boolean> {
    const command = this.commands.get(id);
    if (!command || !this.allowed(command, context)) return false;
    await command.execute(context);
    this.recent.splice(
      0,
      this.recent.length,
      ...[id, ...this.recent.filter((v) => v !== id)].slice(0, 12),
    );
    this.changed();
    return true;
  }
  search(query: string): StudioCommand[] {
    const terms = query.toLocaleLowerCase().trim().split(/\s+/);
    return [...this.commands.values()]
      .filter((c) =>
        terms.every((t) =>
          (c.title + " " + c.category + " " + c.id + " " + (c.keywords ?? ""))
            .toLocaleLowerCase()
            .includes(t),
        ),
      )
      .sort((a, b) => {
        const rank = (id: string) =>
          this.recent.includes(id) ? this.recent.indexOf(id) : 99;
        return rank(a.id) - rank(b.id);
      });
  }
}
export function focusScope(target: EventTarget | null): FocusScope {
  if (!(target instanceof HTMLElement)) return "editor";
  if (target.closest('[role="dialog"][aria-modal="true"],.modal-backdrop')) return "dialog";
  if (target.closest('input,textarea,select,[contenteditable="true"]'))
    return "text-input";
  if (target.closest('[data-focus-scope="timeline"]')) return "timeline";
  if (target.closest('[data-console-window="interface"]')) return "interface";
  if (target.closest('button,a,summary,[role="button"]')) return "editor";
  if (target.closest(".viewport-panel")) return "viewport";
  return "editor";
}
export function chord(event: KeyboardEvent): string {
  return [
    event.ctrlKey || event.metaKey ? "Mod" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    event.key === " "
      ? "Space"
      : event.key.length === 1
        ? event.key.toUpperCase()
        : event.key,
  ]
    .filter(Boolean)
    .join("+");
}
const reserved = new Set([
  "F11",
  "Mod+L",
  "Mod+T",
  "Mod+W",
  "Mod+R",
  "Mod+Space",
]);
export function bindingConflicts(
  registry: CommandRegistry,
  bindings: Record<string, string[]>,
): string[] {
  const assignments: { scope: string; key: string; title: string; owner?: string }[] = [],
    errors: string[] = [];
  for (const command of registry.commands.values())
    for (const key of bindings[command.id] ?? command.shortcuts ?? []) {
      if (reserved.has(key)) errors.push("浏览器保留 " + key);
      for (const previous of assignments)
        if (
          previous.key === key &&
          (!previous.owner || !command.shortcutOwner || previous.owner === command.shortcutOwner) &&
          (previous.scope === command.scope ||
            ["global", "editor"].includes(previous.scope) ||
            ["global", "editor"].includes(command.scope))
        )
          errors.push(key + " 冲突：" + previous.title + " / " + command.title);
      assignments.push({ scope: command.scope, key, title: command.title, owner: command.shortcutOwner });
    }
  return errors;
}
export class ShortcutManager {
  constructor(
    private registry: CommandRegistry,
    private context: () => CommandContext,
    private bindings: () => Record<string, string[]>,
    private characterKeys: () => boolean,
    private feedback: (message: string) => void,
  ) {}
  attach(target: Window): () => void {
    const listener = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      const key = chord(event);
      if (reserved.has(key)) return;
      const context = this.context();
      for (const command of this.registry.commands.values()) {
        if (command.shortcutOwner && command.shortcutOwner !== context.owner) continue;
        if (
          !(this.bindings()[command.id] ?? command.shortcuts ?? []).includes(
            key,
          )
        )
          continue;
        const blocked =
          (context.surface === "text-input" && !command.allowInTextInput) ||
          (context.surface === "dialog" && !command.allowInDialog) ||
          ((context.flying ||
            context.dragging ||
            Boolean(document.pointerLockElement)) &&
            key !== "Escape" &&
            !command.allowDuringNavigation);
        if (blocked) {
          if (command.preventNativeWhenBlocked) {
            event.preventDefault();
            this.feedback("请先完成当前对话框或操作");
          }
          return;
        }
        if (command.scope === "timeline" && context.surface !== "timeline")
          continue;
        if (command.scope === "editor" && context.surface === "interface") continue;
        if (command.scope === "viewport" && context.surface !== "viewport")
          continue;
        if (command.scope === "preview" && context.editingAllowed) continue;
        if (
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          key !== "Escape" &&
          (!this.characterKeys() ||
            !["viewport", "timeline"].includes(context.surface))
        )
          continue;
        event.preventDefault();
        if (command.commitText && document.activeElement instanceof HTMLElement)
          document.activeElement.blur();
        void this.registry
          .execute(command.id, context)
          .then((ok) => {
            if (!ok) this.feedback("当前状态不可执行：" + command.title);
          })
          .catch((error) => this.feedback(String(error)));
        break;
      }
    };
    target.addEventListener("keydown", listener);
    return () => target.removeEventListener("keydown", listener);
  }
}
