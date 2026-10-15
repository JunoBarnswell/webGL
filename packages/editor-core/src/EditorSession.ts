import { assertDocument, type ChangeSet, type SceneDocument } from '@studio/scene-schema';

export interface EditorCommand { label: string; mutate(document: SceneDocument): void }
interface HistoryEntry { label: string; before: SceneDocument; after: SceneDocument }
function freeze<T>(value:T):T { if(value && typeof value==='object'){Object.freeze(value);for(const child of Object.values(value)) freeze(child);}return value; }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function changesBetween(before: SceneDocument, after: SceneDocument): ChangeSet {
  const changed = <T extends { id: string }>(oldItems: T[], newItems: T[]) => {
    const oldMap = new Map(oldItems.map(item => [item.id, item]));
    const newMap = new Map(newItems.map(item => [item.id, item]));
    return [...new Set([...oldMap.keys(), ...newMap.keys()])].filter(id => !same(oldMap.get(id), newMap.get(id)));
  };
  return { before, after, entityIds: changed(before.entities, after.entities), materialIds: changed(before.materials, after.materials), settingsChanged: !same(before.settings, after.settings), behaviorsChanged: !same(before.behaviors, after.behaviors), assetsChanged: !same(before.assets, after.assets) };
}

export class EditorSession {
  private current: SceneDocument;
  private undoEntries: HistoryEntry[] = [];
  private redoEntries: HistoryEntry[] = [];
  private listeners = new Set<(change: ChangeSet, label: string) => void>();
  constructor(document: SceneDocument) { assertDocument(document); this.current = freeze(structuredClone(document)); }
  get document(): SceneDocument { return this.current; }
  get canUndo(): boolean { return this.undoEntries.length > 0; }
  get canRedo(): boolean { return this.redoEntries.length > 0; }
  get history(): string[] { return this.undoEntries.map(entry => entry.label); }
  subscribe(listener: (change: ChangeSet, label: string) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  execute(command: EditorCommand): void {
    const before = this.current;
    const after = structuredClone(before);
    command.mutate(after); assertDocument(after);
    if (same(before, after)) return;
    this.undoEntries.push({ label: command.label, before, after });
    if (this.undoEntries.length > 100) this.undoEntries.shift();
    this.redoEntries = []; this.commit(after, command.label);
  }
  undo(): void { const entry = this.undoEntries.pop(); if (entry) { this.redoEntries.push(entry); this.commit(entry.before, `撤销 ${entry.label}`); } }
  redo(): void { const entry = this.redoEntries.pop(); if (entry) { this.undoEntries.push(entry); this.commit(entry.after, `重做 ${entry.label}`); } }
  private commit(document: SceneDocument, label: string): void {
    const change = changesBetween(this.current, document); this.current = freeze(document);
    this.listeners.forEach(listener => listener(change, label));
  }
}

export * from './commands';
