import { create } from "zustand";
export type LayoutMode = "standard" | "compact" | "focus";
interface Preferences {
  layout: LayoutMode;
  previous: Exclude<LayoutMode, "focus">;
  leftOpen: boolean;
  rail: boolean;
  leftWidth: number;
  rightWidth: number;
  statistics: boolean;
  grid: boolean;
  characterKeys: boolean;
  bindings: Record<string, string[]>;
  patch: (patch: Partial<Preferences>) => void;
  restore: () => void;
  toggleFocus: () => void;
}
const defaults = {
  layout: "compact" as LayoutMode,
  previous: "compact" as const,
  leftOpen: false,
  rail: true,
  leftWidth: 285,
  rightWidth: 305,
  statistics: false,
  grid: true,
  characterKeys: true,
  bindings: {},
};
let saved: Partial<Preferences> = {};
try {
  saved = JSON.parse(localStorage.getItem("studio-preferences-v2") ?? "{}");
} catch {
  /* Invalid device preferences reset without touching the scene. */
}
const initial = { ...defaults, ...saved };
if (!["standard", "compact", "focus"].includes(initial.layout))
  initial.layout = "compact";
initial.leftWidth = Math.max(240, Math.min(500, initial.leftWidth));
initial.rightWidth = Math.max(240, Math.min(500, initial.rightWidth));
export const usePreferences = create<Preferences>((set, get) => ({
  ...initial,
  patch: (patch) => set(patch),
  restore: () => set(defaults),
  toggleFocus: () => {
    const p = get();
    set(
      p.layout === "focus"
        ? { layout: p.previous }
        : { previous: p.layout, layout: "focus" },
    );
  },
}));
usePreferences.subscribe((state) => {
  try {
    localStorage.setItem("studio-preferences-v2", JSON.stringify(state));
  } catch {
    /* Storage can be disabled by browser policy. */
  }
});
