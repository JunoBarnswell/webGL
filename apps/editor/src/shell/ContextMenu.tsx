import { useEffect, useRef } from "react";
import { commands, context, execute } from "./commands";
import { useStudio } from "../state/studio";
export function ContextMenu() {
  const menu = useStudio((s) => s.contextMenu);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) useStudio.getState().set({ contextMenu: null }); };
    window.addEventListener("pointerdown", outside);
    return () => { window.removeEventListener("pointerdown", outside); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [menu]);
  if (!menu) return null;
  return (
    <div
      ref={ref}
      className="object-context-menu console-quad-menu"
      role="menu"
      aria-label="对象操作"
      style={{
        left: Math.max(6, Math.min(menu.x, innerWidth - 376)),
        top: Math.max(6, Math.min(menu.y, innerHeight - 380)),
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          useStudio.getState().set({ contextMenu: null });
          e.stopPropagation();
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const items = [
            ...ref.current!.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ),
          ];
          const index = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          items[
            (index + (e.key === "ArrowDown" ? 1 : items.length - 1)) %
              items.length
          ]?.focus();
        }
      }}
    >
      {[
        { title: "变换与视角", ids: ["tool.select", "tool.translate", "tool.rotate", "tool.scale", "view.selection"] },
        { title: "对象与层级", ids: ["document.duplicate", "document.delete", "panel.inspector", "workspace.prefab"] },
        { title: "内容与行为", ids: ["workspace.content", "workspace.tour", "workspace.interaction", "extension.annotation.label"] },
        { title: "显示与审阅", ids: ["view.grid", "view.statistics", "view.focus", "workspace.industrial"] },
      ].map((group) => <section key={group.title}><h3>{group.title}</h3>{group.ids.map((id) => {
        const command = commands.commands.get(id);
        return (
          command && (
            <button
              role="menuitem"
              key={id}
              disabled={!commands.allowed(command, context())}
              onClick={() => {
                useStudio.getState().set({ contextMenu: null });
                execute(command.id);
              }}
            >
              {command.title}
            </button>
          )
        );
      })}</section>)}
    </div>
  );
}
