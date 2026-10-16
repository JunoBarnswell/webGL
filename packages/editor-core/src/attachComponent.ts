import {
  createComponent,
  declareExtension,
  type Entity,
} from "@studio/scene-schema";
import type { EditorCommand } from "./EditorSession";
export function attachComponent(
  type: string,
  selected: string[],
  configure?: (e: Entity) => void,
): EditorCommand {
  return {
    label: "添加 " + type,
    mutate: (document) => {
      if (!selected.length) throw Error("先选择模型或节点");
      declareExtension(document, type);
      for (const id of selected) {
        const entity = document.entities.find((e) => e.id === id);
        if (!entity || entity.locked) throw Error("选择包含锁定或失效节点");
        if (!entity.components.some((c) => c.type === type))
          entity.components.push(createComponent(type));
        configure?.(entity);
      }
    },
  };
}
