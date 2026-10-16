import { useEffect, useRef } from "react";
import { commands, context, execute } from "./commands";
import { useStudio } from "../state/studio";
export function ContextMenu() {
  const menu = useStudio((s) => s.contextMenu);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (menu) ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [menu]);
  if (!menu) return null;
  return (
    <div
      ref={ref}
      className="object-context-menu"
      role="menu"
      aria-label="对象操作"
      style={{
        left: Math.min(menu.x, innerWidth - 220),
        top: Math.min(menu.y, innerHeight - 290),
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
        "view.selection",
        "document.duplicate",
        "workspace.prefab",
        "document.delete",
        "panel.inspector",
        "annotation.label",
      ].map((id) => {
        const command = commands.commands.get(
          id === "annotation.label" ? "extension.annotation.label" : id,
        );
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
      })}
    </div>
  );
}
