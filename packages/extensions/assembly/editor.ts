import {
  createComponent,
  createEntity,
  declareExtension,
  getComponent,
} from "../../scene-schema/src/index";
import type { ExtensionTool } from "../../editor-core/src/ExtensionTool";
export const tools: ExtensionTool[] = [
  {
    id: "assembly.template",
    title: "创建装配拆解",
    description: "将所选对象组成装配序列，按径向生成可调整的初始拆解方向",
    create: (_doc, selected) => ({
      label: "创建装配拆解",
      mutate: (doc) => {
        if (!selected.length) throw Error("先选择零件");
        const root = createEntity("装配拆解");
        root.components.push(createComponent("studio.assembly.Root"));
        declareExtension(doc, "studio.assembly.Root");
        doc.entities.push(root);
        selected.forEach((id, index) => {
          const part = doc.entities.find((e) => e.id === id);
          if (!part || part.locked) throw Error("零件被锁定");
          const c =
            getComponent(part, "studio.assembly.Part") ??
            createComponent("studio.assembly.Part");
          c.data.groupId = root.id;
          c.data.partNo = part.name;
          c.data.sourceElementId = String(
            getComponent(part, "ModelNode")?.data.sourceElementId || part.id,
          );
          c.data.stages = [
            {
              id: "initial",
              name: "初始拆解",
              start: 0,
              end: 1,
              path: [
                [
                  Math.cos((index / selected.length) * Math.PI * 2) * 500,
                  100,
                  Math.sin((index / selected.length) * Math.PI * 2) * 500,
                ],
              ],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
              easing: "smooth",
              trail: false,
              visibility: "inherit",
            },
          ];
          if (!part.components.includes(c)) part.components.push(c);
        });
      },
    }),
  },
];

import { AssemblyPanel } from "./panel";
export const panels = [
  { id: "assembly", title: "装配 BOM 与步骤", Component: AssemblyPanel },
];
