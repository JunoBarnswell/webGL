import { usePreferences } from "./preferences";
export function DockResize({ side }: { side: "left" | "right" }) {
  const field = side === "left" ? "leftWidth" : "rightWidth";
  const resize = (value: number) =>
    usePreferences
      .getState()
      .patch({ [field]: Math.max(240, Math.min(500, value)) });
  return (
    <div
      role="separator"
      aria-label={side === "left" ? "任务面板宽度" : "属性面板宽度"}
      aria-orientation="vertical"
      tabIndex={0}
      className={"dock-resize resize-" + side}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          resize(
            usePreferences.getState()[field] +
              (e.key === "ArrowRight" ? 10 : -10) * (side === "left" ? 1 : -1),
          );
        }
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        const initial = usePreferences.getState()[field],
          start = e.clientX;
        const controller = new AbortController();
        window.addEventListener(
          "pointermove",
          (event) =>
            resize(
              initial + (event.clientX - start) * (side === "left" ? 1 : -1),
            ),
          { signal: controller.signal },
        );
        window.addEventListener("pointerup", () => controller.abort(), {
          once: true,
          signal: controller.signal,
        });
        window.addEventListener("blur", () => controller.abort(), {
          once: true,
          signal: controller.signal,
        });
      }}
    />
  );
}
