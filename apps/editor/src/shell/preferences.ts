import { create } from "zustand";
interface Preferences {
  statistics: boolean;
  grid: boolean;
  characterKeys: boolean;
  bindings: Record<string, string[]>;
  patch: (patch: Partial<Preferences>) => void;
}
let saved: Record<string, unknown> = {};
try {
  saved = JSON.parse(localStorage.getItem("studio-preferences-v2") ?? "{}");
} catch { /* Device preferences do not alter scene data. */ }
export const usePreferences = create<Preferences>((set) => ({
  statistics: saved.statistics === true,
  grid: saved.grid !== false,
  characterKeys: saved.characterKeys !== false,
  bindings: saved.bindings && typeof saved.bindings === "object" ? saved.bindings as Record<string, string[]> : {},
  patch: (patch) => set(patch),
}));
usePreferences.subscribe((state) => {
  try {
    // Preserve old layout preferences for rollback to the former shell.
    localStorage.setItem("studio-preferences-v2", JSON.stringify({ ...saved, statistics: state.statistics, grid: state.grid, characterKeys: state.characterKeys, bindings: state.bindings }));
  } catch { /* Device storage can be disabled by browser policy. */ }
});
