import {
  orderExtensions,
  runtimeVersion,
} from "../packages/scene-schema/src/extensions";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const base = new URL("../", import.meta.url);
const read = async (path: string) =>
  JSON.parse(await readFile(new URL(path, base), "utf8"));
const units = await read("packages/scene-schema/unit-catalog.json");
const schema = await read("packages/scene-schema/core.schema.json");
schema.$defs.asset = structuredClone(schema.properties.assets.items);
const extensions = [];
const directoryById = new Map<string, string>();
for (const directory of (
  await readdir(new URL("packages/extensions/", base), { withFileTypes: true })
)
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()) {
  const extension = await read(
    `packages/extensions/${directory}/extension.json`,
  );
  extensions.push(extension);
  directoryById.set(extension.manifest.id, directory);
}
const ids = new Set<string>(),
  types = new Set<string>();
for (const extension of extensions) {
  const manifest = extension.manifest;
  if (ids.has(manifest.id)) throw Error("duplicate extension " + manifest.id);
  ids.add(manifest.id);
  for (const [kind, key] of [
    ["components", "component"],
    ["actions", "action"],
  ])
    for (const [type, raw] of Object.entries(extension[kind])) {
      if (!type.startsWith(manifest.id + ".") || types.has(type))
        throw Error("invalid type " + type);
      types.add(type);
      const definition = raw as {
        title: string;
        fields: Record<string, unknown>;
        target?: string;
        components?: string[];
        anchor?: boolean;
      };
      const template = structuredClone(schema.$defs[key].oneOf[0]);
      template.title = definition.title;
      if (definition.anchor) template["x-anchor"] = true;
      template.properties.type.const = type;
      template.properties.data = {
        type: "object",
        additionalProperties: false,
        properties: definition.fields,
        required: Object.entries(definition.fields)
          .filter(
            ([, field]) => !(field as Record<string, unknown>)["x-optional"],
          )
          .map(([key]) => key),
      };
      if (key === "action") {
        template.properties.targetId["x-reference"] = definition.target;
        template["x-target"] = definition.target;
        template["x-components"] = definition.components ?? [];
      }
      schema.$defs[key].oneOf.push(template);
    }
}
const libraryDocuments = [];
const widgets: string[] = [];
for (const extension of extensions) {
  for (const type of extension.manifest.contributions?.documentKinds ?? []) {
    const definition =
      extension.documents?.[type] ?? extension.components[type];
    if (!definition) throw Error("Missing document contribution " + type);
    libraryDocuments.push({
      type: "object",
      properties: {
        type: { const: type },
        data: {
          type: "object",
          properties: definition.fields,
          required: Object.entries(definition.fields)
            .filter(
              ([, field]) => !(field as Record<string, unknown>)["x-optional"],
            )
            .map(([key]) => key),
          additionalProperties: false,
        },
      },
      required: ["type", "data"],
      additionalProperties: false,
      title: definition.title,
    });
  }
  widgets.push(...(extension.manifest.contributions?.playerWidgets ?? []));
}
schema.$defs.libraryDocument = { oneOf: libraryDocuments };
schema.$defs.uiNode.properties.kind.enum.push(...widgets);
const manifests = orderExtensions(extensions.map((e) => e.manifest));
schema.properties.documentVersion = { const: 2 };
schema.required.push("documentVersion", "requiredExtensions");
schema.properties.requiredExtensions = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    properties: { id: { type: "string" }, version: { type: "string" } },
    required: ["id", "version"],
  },
};
// Unknown contributions are preserved at authoring boundaries; publication checks availability.
for (const kind of ["component", "action"]) {
  const known = schema.$defs[kind].oneOf.map(
    (v: { properties: { type: { const: string } } }) => v.properties.type.const,
  );
  const fallback = structuredClone(schema.$defs[kind].oneOf[0]);
  fallback.title = "缺失扩展";
  fallback.properties.type = {
    type: "string",
    pattern: "^[a-z][a-z0-9_-]*(\\.[A-Za-z][A-Za-z0-9_-]*){2,}$",
    not: { enum: known },
  };
  fallback.properties.data = { type: "object" };
  if (kind === "action") {
    delete fallback.properties.targetId["x-reference"];
    fallback["x-target"] = "";
    fallback["x-components"] = [];
  }
  schema.$defs[kind].oneOf.push(fallback);
}
const hash = createHash("sha256")
  .update(
    JSON.stringify({ runtimeBuild: runtimeVersion, schema, manifests, units }),
  )
  .digest("hex");
await writeFile(
  new URL("packages/scene-schema/scene-document.schema.json", base),
  JSON.stringify(schema, null, 2) + "\n",
);
await writeFile(
  new URL("packages/scene-schema/extension-catalog.json", base),
  JSON.stringify({ runtimeBuild: runtimeVersion, hash, manifests }, null, 2) +
    "\n",
);
console.log("Composed extension catalog " + hash);

const names = manifests.map((manifest) => directoryById.get(manifest.id)!);
const imports = names
  .map(
    (name, i) =>
      `import System${i} from '../../../extensions/${name}/runtime';`,
  )
  .join("\n");
await writeFile(
  new URL("packages/scene-runtime/src/systems/catalog.ts", base),
  `// Generated by scripts/compose-extensions.mts; trusted static registration only.\nimport type {SceneRuntime} from '../SceneRuntime';\nimport type {RuntimeSystem} from './RuntimeSystem';\n${imports}\nexport function createRuntimeSystems(runtime:SceneRuntime):RuntimeSystem[]{return [${names.map((_name, i) => `new System${i}(runtime)`).join(",")}];}\n`,
);

await writeFile(
  new URL("packages/extensions/editor-catalog.ts", base),
  "import type {ExtensionPanel,ExtensionEditorCommand} from './editor-contract';\n" +
    names
      .map(
        (name, i) =>
          `import {tools as tools${i},panels as panels${i},commands as commands${i}} from './${name}/editor';`,
      )
      .join("\n") +
    "\nexport const extensionTools=[" +
    names.map((_name, i) => `...tools${i}`).join(",") +
    "];\nexport const extensionPanels:ExtensionPanel[]=[" +
    names.map((_name, i) => `...panels${i}`).join(",") +
    "];\nexport const extensionCommands:ExtensionEditorCommand[]=[" +
    names.map((_name, i) => `...commands${i}`).join(",") +
    "];\n",
);

const known = (kind: string) =>
  schema.$defs[kind].oneOf
    .filter(
      (definition: { properties: { type: { const?: string } } }) =>
        definition.properties.type.const,
    )
    .map((definition: { properties: { type: { const: string } } }) =>
      JSON.stringify(definition.properties.type.const),
    )
    .join(" | ");
await writeFile(
  new URL("packages/scene-schema/src/known-types.ts", base),
  "// Generated from the canonical schema.\nexport type KnownComponentType = " +
    known("component") +
    ";\nexport type KnownActionType = " +
    known("action") +
    ";\n",
);

const validators: string[] = [],
  players: string[] = [];
for (const name of names) {
  const files = await readdir(
    new URL("packages/extensions/" + name + "/", base),
  );
  if (files.includes("contract.ts")) validators.push(name);
  if (files.includes("player.tsx")) players.push(name);
}
await writeFile(
  new URL("packages/extensions/validators.ts", base),
  validators
    .map(
      (name, i) =>
        `import {validate as validate${i}} from './${name}/contract';`,
    )
    .join("\n") +
    "\nexport const extensionValidators=[" +
    validators.map((_n, i) => `validate${i}`).join(",") +
    "];\n",
);
await writeFile(
  new URL("packages/player-ui/src/widgets.ts", base),
  players
    .map(
      (name, i) =>
        `import {widgets as widgets${i}} from '../../extensions/${name}/player';`,
    )
    .join("\n") +
    "\nexport const playerWidgets=[" +
    players.map((_n, i) => `...widgets${i}`).join(",") +
    "];\n",
);
