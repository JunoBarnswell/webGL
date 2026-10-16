import {
  applyPatches,
  enablePatches,
  freeze,
  produceWithPatches,
  type Patch,
} from "immer";
enablePatches();
export interface DocumentCommand<T> {
  kind?: string;
  label: string;
  mutate(document: T): void;
}
export interface DocumentChange<T> {
  before: T;
  after: T;
  patches?: Patch[];
}
interface Entry {
  kind?: string;
  label: string;
  patches: Patch[];
  inverse: Patch[];
}
export interface HistoryTarget {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly history: string[];
  subscribe(listener: () => void): () => void;
  undo(): void;
  redo(): void;
}
/** One transaction engine for scenes and independent typed project/library documents. */
export class DocumentSession<
  T extends object,
  C extends DocumentChange<T> = DocumentChange<T>,
> implements HistoryTarget
{
  protected current: T;
  private undoEntries: Entry[] = [];
  private redoEntries: Entry[] = [];
  private listeners = new Set<(change: C, label: string) => void>();
  constructor(
    document: T,
    private validate: (doc: T) => void,
    private prepare?: (
      draft: T,
      before: T,
      command: DocumentCommand<T>,
    ) => void,
    private makeChange: (
      before: T,
      after: T,
      patches: Patch[],
      kind?: string,
    ) => C = (before, after, patches) => ({ before, after, patches }) as C,
  ) {
    validate(document);
    this.current = freeze(structuredClone(document), true);
  }
  get document(): T {
    return this.current;
  }
  get canUndo(): boolean {
    return this.undoEntries.length > 0;
  }
  get canRedo(): boolean {
    return this.redoEntries.length > 0;
  }
  get history(): string[] {
    return this.undoEntries.map((e) => e.label);
  }
  subscribe(listener: (change: C, label: string) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  execute(command: DocumentCommand<T>): void {
    const [after, patches, inverse] = produceWithPatches(
      this.current,
      (draft) => {
        command.mutate(draft as T);
        this.prepare?.(draft as T, this.current, command);
      },
    );
    if (!patches.length) return;
    this.validate(after as T);
    this.undoEntries.push({
      kind: command.kind,
      label: command.label,
      patches,
      inverse,
    });
    if (this.undoEntries.length > 100) this.undoEntries.shift();
    this.redoEntries = [];
    this.commit(after as T, command.label, patches, command.kind);
  }
  undo(): void {
    const entry = this.undoEntries.pop();
    if (entry) {
      this.redoEntries.push(entry);
      this.commit(
        applyPatches(this.current, entry.inverse),
        "撤销 " + entry.label,
        entry.inverse,
        entry.kind,
      );
    }
  }
  redo(): void {
    const entry = this.redoEntries.pop();
    if (entry) {
      this.undoEntries.push(entry);
      this.commit(
        applyPatches(this.current, entry.patches),
        "重做 " + entry.label,
        entry.patches,
        entry.kind,
      );
    }
  }
  private commit(
    after: T,
    label: string,
    patches: Patch[],
    kind?: string,
  ): void {
    const change = this.makeChange(this.current, after, patches, kind);
    this.current = after;
    for (const listener of this.listeners) listener(change, label);
  }
}
