export interface ProjectedLabel {
  id: string;
  text: string;
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
  color: string;
  size: number;
  cluster: boolean;
  distance: number;
  selected?: boolean;
}
export interface LabelGroup extends ProjectedLabel {
  ids: string[];
  texts: string[];
}
export class AnnotationLayoutEngine {
  layout(labels: readonly ProjectedLabel[]): LabelGroup[] {
    const cells = new Map<string, LabelGroup>();
    const result: LabelGroup[] = [];
    for (const label of [...labels].sort(
      (a, b) =>
        Number(Boolean(b.selected)) - Number(Boolean(a.selected)) ||
        a.distance - b.distance ||
        a.id.localeCompare(b.id),
    )) {
      const cell = Math.floor(label.x / 110) + ":" + Math.floor(label.y / 38);
      const existing = label.cluster ? cells.get(cell) : undefined;
      if (existing) {
        existing.ids.push(label.id);
        existing.texts.push(label.text);
        continue;
      }
      const group = { ...label, ids: [label.id], texts: [label.text] };
      if (label.cluster) cells.set(cell, group);
      result.push(group);
    }
    return result;
  }
}
