import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import * as THREE from "three";
import { zipSync } from "fflate";
import {
  createDocument,
  createEntity,
  createComponent,
  createMaterial,
  declareExtension,
  assertDocument,
  type SceneDocument,
  type Vec3,
  type SceneAsset,
} from "@studio/scene-schema";
const base = process.env.STUDIO_API ?? "http://127.0.0.1:18080";
const config = JSON.parse(await readFile(".local/config.json", "utf8"));
const token = (
  await (
    await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: config.adminUser,
        password: config.adminPassword,
      }),
    })
  ).json()
).token;
const headers = { Authorization: "Bearer " + token };
const geometry = new THREE.BufferGeometry().copy(
  new THREE.BoxGeometry(1, 1, 1),
);
const upload = await fetch(
  base +
    "/api/assets?" +
    new URLSearchParams({
      name: "Synthetic sample shared cube",
      kind: "mesh",
      entry: "cube.json",
    }),
  {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/zip" },
    body: zipSync({
      "cube.json": new TextEncoder().encode(JSON.stringify(geometry.toJSON())),
    }),
  },
);
assert.equal(upload.status, 200);
const asset = (await upload.json()) as SceneAsset;
function init(name: string): SceneDocument {
  const doc = createDocument(name);
  doc.assets.push(asset);
  doc.settings.position = [6000, 4500, 8000];
  doc.settings.target = [0, 500, 0];
  doc.settings.far = 100000;
  doc.settings.collision = false;
  return doc;
}
function mesh(
  doc: SceneDocument,
  name: string,
  position: Vec3,
  scale: Vec3,
  color: string,
) {
  const e = createEntity(name);
  e.transform.position = position;
  e.transform.scale = scale;
  const c = createComponent("Mesh");
  c.data.assetId = asset.id;
  let material = doc.materials.find((m) => m.color === color);
  if (!material) {
    material = createMaterial(color);
    material.color = color;
    doc.materials.push(material);
  }
  c.data.materialId = material.id;
  e.components.push(c);
  doc.entities.push(e);
  return e;
}
function label(doc: SceneDocument, targetId: string, text: string) {
  const e = createEntity(text + " 标签"),
    c = createComponent("studio.annotation.Label");
  c.data.entityId = targetId;
  c.data.label = text;
  c.data.offset = [30, -30, 0];
  e.components.push(c);
  doc.entities.push(e);
  declareExtension(doc, c.type);
}
const car = init("汽车装配 · 合成教学样例");
const root = createEntity("汽车装配序列");
root.components.push(createComponent("studio.assembly.Root"));
car.entities.push(root);
declareExtension(car, "studio.assembly.Root");
const parts = [
  { name: "底盘", p: [0, 300, 0], s: [1800, 250, 4200], c: "#40576d" },
  { name: "车身", p: [0, 1100, 0], s: [1850, 500, 3600], c: "#429fbc" },
  { name: "电池", p: [0, 550, 0], s: [1400, 180, 2400], c: "#57b79a" },
  { name: "电机", p: [0, 650, 1600], s: [800, 550, 600], c: "#d5ae68" },
];
for (const x of [-1050, 1050])
  for (const z of [-1450, 1450])
    parts.push({
      name: "轮组 " + x + "/" + z,
      p: [x, 450, z],
      s: [300, 850, 850],
      c: "#414953",
    });
for (let i = 0; i < 42; i++)
  parts.push({
    name: "连接件 " + (i + 1),
    p: [((i % 7) - 3) * 230, 700, Math.floor(i / 7) * 450 - 1125],
    s: [80, 150, 80],
    c: "#a9b4c0",
  });
parts.forEach((part, index) => {
  const entity = mesh(car, part.name, part.p as Vec3, part.s as Vec3, part.c);
  const c = createComponent("studio.assembly.Part");
  c.data.partNo = "PART-" + index;
  c.data.sourceElementId = "synthetic-car:" + index;
  c.data.groupId = root.id;
  c.data.direction = [
    part.p[0] === 0 ? 0 : Math.sign(part.p[0]),
    index < 4 ? 1 : 0.2,
    part.p[2] === 0 ? 0 : Math.sign(part.p[2]),
  ];
  c.data.distance = index < 4 ? 1000 : 600;
  entity.components.push(c);
  if (index < 8) label(car, entity.id, part.name);
});
const pipes = init("工业管网 · 100 管线 / 1000 管段 / 500 标签");
pipes.settings.position = [14000, 18000, 24000];
pipes.settings.target = [7000, 1000, 7000];
for (let lineIndex = 0; lineIndex < 100; lineIndex++) {
  const line = createEntity("管线 " + lineIndex),
    c = createComponent("studio.piping.Line");
  c.data.lineNo = "LINE-" + lineIndex;
  c.data.service = lineIndex % 2 ? "冷却水" : "空气";
  c.data.sourceSystem = "ZONE-" + Math.floor(lineIndex / 20);
  line.components.push(c);
  pipes.entities.push(line);
  declareExtension(pipes, c.type);
  for (let i = 0; i < 10; i++) {
    const entity = mesh(
      pipes,
      "管段 " + lineIndex + "/" + i,
      [
        (lineIndex % 10) * 1500,
        500 + Math.floor(lineIndex / 10) * 200,
        i * 1500,
      ],
      [100, 100, 1350],
      lineIndex % 2 ? "#60bca3" : "#6da3c6",
    );
    const segment = createComponent("studio.piping.Segment");
    segment.data.lineId = line.id;
    segment.data.sourceElementId = "synthetic-pipe:" + lineIndex + ":" + i;
    segment.data.start = [0, 0, -0.5];
    segment.data.end = [0, 0, 0.5];
    entity.components.push(segment);
    if (i % 2 === 0) label(pipes, entity.id, String(c.data.lineNo));
  }
}
await mkdir(".local/examples", { recursive: true });
const result = [];
for (const [name, document] of [
  ["assembly", car],
  ["piping", pipes],
] as const) {
  assertDocument(document, true);
  const created = await fetch(base + "/api/projects", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name: document.name, document }),
  });
  assert.equal(created.status, 200, await created.clone().text());
  const draft = await created.json();
  const publish = await fetch(
    base + "/api/scenes/" + draft.sceneId + "/publish",
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: draft.revision }),
    },
  );
  assert.equal(publish.status, 200, await publish.clone().text());
  const exported = await fetch(
    base + "/api/projects/" + draft.projectId + "/export",
    { headers },
  );
  assert.equal(exported.status, 200);
  await writeFile(
    ".local/examples/" + name + ".studio.zip",
    new Uint8Array(await exported.arrayBuffer()),
  );
  result.push({
    name,
    projectId: draft.projectId,
    sceneId: draft.sceneId,
    entities: document.entities.length,
    archive: ".local/examples/" + name + ".studio.zip",
  });
}
await writeFile(".local/examples/index.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
