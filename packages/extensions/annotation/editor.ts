import {
  createComponent,
  createEntity,
  declareExtension,
} from "../../scene-schema/src/index";
import type { ExtensionTool } from "../../editor-core/src/ExtensionTool";
export const tools: ExtensionTool[] = [
  {
    id: "annotation.label",
    title: "添加附着标签",
    description: "标签跟随选中对象，使用共享空间标注系统",
    create: (_doc, selected) => ({
      label: "添加附着标签",
      mutate: (doc) => {
        if (!selected.length) throw Error("先选择附着对象");
        declareExtension(doc, "studio.annotation.Label");
        for (const id of selected) {
          const source = doc.entities.find((e) => e.id === id);
          if (!source) throw Error("对象不存在");
          const entity = createEntity(source.name + " 标签");
          const c = createComponent("studio.annotation.Label");
          c.data.entityId = id;
          c.data.label = source.name;
          entity.components.push(c);
          doc.entities.push(entity);
        }
      },
    }),
  },
];

import { AnnotationPanel } from "./panel";
export const panels = [
  { id: "annotation", title: "标注批量编辑与修复", Component: AnnotationPanel },
];

export const commands = [];
