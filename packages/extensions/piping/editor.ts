import {
  createComponent,
  createEntity,
  declareExtension,
  getComponent,
} from "../../scene-schema/src/index";
import type { ExtensionTool } from "../../editor-core/src/ExtensionTool";
export const tools: ExtensionTool[] = [
  {
    id: "piping.template",
    title: "绑定逻辑管线",
    description: "将所选模型管段绑定到一条新的逻辑管线",
    create: (_doc, selected) => ({
      label: "绑定逻辑管线",
      mutate: (doc) => {
        if (!selected.length) throw Error("先选择管段");
        const line = createEntity("新管线");
        const c = createComponent("studio.piping.Line");
        c.data.lineNo = "LINE-" + line.id.slice(0, 8);
        line.components.push(c);
        declareExtension(doc, "studio.piping.Line");
        doc.entities.push(line);
        for (const id of selected) {
          const segment = doc.entities.find((e) => e.id === id);
          if (!segment || segment.locked) throw Error("管段被锁定");
          const c =
            getComponent(segment, "studio.piping.Segment") ??
            createComponent("studio.piping.Segment");
          c.data.lineId = line.id;
          c.data.sourceElementId = String(
            getComponent(segment, "ModelNode")?.data.sourceElementId ||
              segment.id,
          );
          if (!segment.components.includes(c)) segment.components.push(c);
        }
      },
    }),
  },
];
export { pipingCsv, parseCsv } from "./csv";
import { PipingPanel } from "./panel";
export const panels = [
  { id: "piping", title: "管网查询与 CSV 映射", Component: PipingPanel },
];

export const commands = [];
