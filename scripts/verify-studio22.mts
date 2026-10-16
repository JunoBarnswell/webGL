import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import * as THREE from "three";
import { zipSync, unzipSync } from "fflate";
import { deflateSync } from "node:zlib";
import { Document, NodeIO } from "@gltf-transform/core";
import { KHRMaterialsVariants } from "@gltf-transform/extensions";
import {
  createDocument,
  createEntity,
  createComponent,
  createAction,
  declareExtension,
  sourceDocument,
  compilePrefabs,
  type JsonValue,
} from "@studio/scene-schema";
import {
  EditorSession,
  createPrefabRevision,
  instantiatePrefab,
  previewPrefabUpdate,
  updatePrefabInstances,
  revertPrefabOverride,
  detachPrefab,
  revisionFromInstance,
  duplicateEntities,
} from "@studio/editor-core";
import { VisualStateSystem } from "../packages/scene-runtime/src/systems/VisualStateSystem";
import ConfiguratorSystem from "../packages/extensions/configurator/runtime";
import { CameraOwnership } from "../packages/scene-runtime/src/CameraOwnership";
import {
  evaluateStoryboard,
  newClip,
  type Storyboard,
} from "../packages/extensions/storyboard/core";
import {
  resolveConfiguration,
  defaultConfiguration,
  optionAvailability,
  configurationOptionKey,
  validateCatalog,
  type ProductCatalog,
} from "../packages/extensions/configurator/core";
import {
  convertUnit,
  mapProperties,
  measure,
} from "../packages/extensions/industrial/core";
import {
  emptyProject,
  newTourNode,
  polygonContains,
  directionAngles,
  sphericalDirection,
  validateProject,
} from "../packages/extensions/virtual-tour/core";
import {
  assertIdentityPreserved,
  reconcileSourceIdentities,
} from "../packages/scene-schema/src/model-identity";
const evidence: string[] = [];
const pass = (s: string) => {
  evidence.push(s);
  console.log("Pass: " + s);
};
const source = createDocument("Source");
const root = createEntity("Root"),
  child = createEntity("Child", root.id);
source.entities.push(root, child);
const revision = createPrefabRevision(source, root.id, "Template");
const session = new EditorSession(createDocument());
const first = instantiatePrefab(revision),
  second = instantiatePrefab(revision);
session.execute(first.command);
session.execute(second.command);
const instanceId = first.instance.id,
  target = first.instance.bindings.entity[child.id];
session.execute({
  label: "Override",
  mutate(doc) {
    doc.entities.find((e) => e.id === target)!.name = "Local";
  },
});
assert.equal(session.document.prefabs![0].overrides.length, 1);
const latest = structuredClone(revision);
latest.revisionId = crypto.randomUUID();
latest.document.entities.find((e) => e.id === child.id)!.name = "Incoming";
const conflicts = previewPrefabUpdate(session.document.prefabs![0], latest);
assert.equal(conflicts.length, 1);
assert.equal(conflicts[0].base, "Child");
assert.throws(() =>
  session.execute(updatePrefabInstances([instanceId], latest)),
);
session.execute(
  updatePrefabInstances([instanceId], latest, {
    [instanceId + ":" + conflicts[0].key]: "instance",
  }),
);
assert.equal(
  session.document.entities.find((e) => e.id === target)!.name,
  "Local",
);
assert.equal(session.document.prefabs![1].revisionId, revision.revisionId);
session.execute(revertPrefabOverride(instanceId));
assert.equal(
  session.document.entities.find((e) => e.id === target)!.name,
  "Incoming",
);
session.undo();
assert.equal(
  session.document.entities.find((e) => e.id === target)!.name,
  "Local",
);
session.redo();
const authored = sourceDocument(session.document);
assert.equal(authored.entities.length, 0);
assert.deepEqual(
  compilePrefabs(authored),
  JSON.parse(JSON.stringify(session.document)),
);
const extracted = revisionFromInstance(
  session.document,
  session.document.prefabs![0],
  "Extracted",
);
assert.equal(extracted.document.entities.length, 2);
assert.equal(extracted.document.prefabs?.length ?? 0, 0);
session.execute(duplicateEntities([first.instance.bindings.entity[root.id]]));
assert.equal(session.document.prefabs!.length, 3);
session.undo();
session.execute(detachPrefab(instanceId));
assert.equal(session.document.prefabs!.length, 1);
assert.ok(session.document.entities.some((e) => e.id === target));
session.undo();
pass(
  "Prefab compile, ordinary-command overrides, 3-way conflict, selective atomic revision, undo/redo, duplicate, detach, source extraction",
);
const objects = new Map<string, THREE.Object3D>();
const original = new THREE.MeshStandardMaterial({ color: "#ffffff" });
const mesh = new THREE.Mesh(new THREE.BoxGeometry(), original);
objects.set("part", mesh);
let retained = 0;
const runtime = {
  generation: 1,
  getObject: (id: string) => objects.get(id),
  engine: {
    renderer: { localClippingEnabled: false },
    resourceRegistry: {
      retain: () => retained++,
      release: (r: THREE.Material) => {
        retained--;
        r.dispose();
      },
    },
    requestRender: () => {},
  },
  spatial: { invalidate: () => {} },
};
const visual = new VisualStateSystem(runtime as never);
visual.setScope(
  "config",
  [
    {
      targetId: "part",
      channel: "color",
      composition: "replace",
      value: "#ff0000",
    },
  ],
  "configuration",
);
const clone = mesh.material;
visual.setScope(
  "story",
  [
    {
      targetId: "part",
      channel: "opacity",
      composition: "replace",
      value: 0.3,
    },
  ],
  "storyboard",
);
assert.equal(mesh.material, clone);
assert.equal(mesh.material.opacity, 0.3);
assert.equal(original.opacity, 1);
visual.reset("story");
assert.equal(mesh.material.opacity, 1);
assert.equal(mesh.material.color.getHexString(), "ff0000");
visual.setScope(
  "assembly",
  [
    {
      targetId: "part",
      channel: "transform",
      composition: "add",
      value: { position: [4, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
  ],
  "assembly",
);
visual.rebase(() => {
  mesh.position.x = 10;
});
assert.equal(mesh.position.x, 14);
visual.reset("assembly");
assert.equal(mesh.position.x, 10);
visual.setScope(
  "stale",
  [
    {
      targetId: "part",
      channel: "visibility",
      composition: "replace",
      value: false,
    },
  ],
  "selection",
  0,
);
assert.equal(mesh.visible, true);
visual.reset();
assert.equal(mesh.material, original);
assert.equal(retained, 0);
mesh.geometry.dispose();
original.dispose();
const camera = new CameraOwnership();
let cameraCancelled = 0;
const a = camera.acquire("tour", "tour", () => cameraCancelled++),
  b = camera.acquire("story", "storyboard", () => {});
camera.release(a);
assert.equal(camera.owner, "story");
assert.equal(cameraCancelled, 1);
camera.release(b);
assert.equal(camera.owner, "navigation");
pass(
  "Visual ownership restores baseline, reuses material clones, rebases edits, rejects stale scopes; camera lease invalidates stale completion",
);
const clip = newClip();
clip.duration = 10;
clip.toTransform.position = [100, 0, 0];
const story: Storyboard = {
  name: "Story",
  duration: 10,
  fps: "30",
  loop: false,
  tracks: [
    {
      id: "track",
      name: "Move",
      channel: "transform",
      targetId: "part",
      contentId: "",
      muted: false,
      locked: false,
      priority: 0,
      clips: [clip],
    },
  ],
  snapshots: [],
  markers: [],
};
const expected = evaluateStoryboard(story, 3)[0].transform;
for (const t of [9, 1, 8, 0, 3]) evaluateStoryboard(story, t);
assert.deepEqual(evaluateStoryboard(story, 3)[0].transform, expected);
const split = structuredClone(story);
split.tracks[0].clips = [
  { ...clip, duration: 5, curveEnd: 0.5 },
  {
    ...structuredClone(clip),
    id: "second",
    start: 5,
    duration: 5,
    curveStart: 0.5,
  },
];
for (const t of [0, 1, 4.99, 5, 6, 10])
  assert.ok(
    Math.abs(
      evaluateStoryboard(split, t)[0].transform.position[0] -
        evaluateStoryboard(story, t)[0].transform.position[0],
    ) < 1e-9,
  );
pass(
  "Absolute Storyboard scrubbing/reverse sampling and nonlinear clip splitting preserve trajectory",
);
const option = (id: string) => ({
  id,
  name: id,
  sku: "SKU-" + id,
  color: "#ffffff",
  imageAssetId: "",
  description: "",
  bom: [{ partId: id, quantity: 2 }],
  visuals: [],
});
const catalog: ProductCatalog = {
  catalogId: "product",
  revision: "v1",
  name: "Product",
  market: "CN",
  groups: [
    {
      id: "size",
      name: "Size",
      control: "radio",
      min: 1,
      max: 1,
      defaultIds: ["large"],
      options: [option("large"), option("small")],
    },
    {
      id: "power",
      name: "Power",
      control: "radio",
      min: 1,
      max: 1,
      defaultIds: ["basic"],
      options: [option("basic"), option("pro")],
    },
    {
      id: "length",
      name: "Length",
      control: "number",
      min: 0,
      max: 1,
      defaultIds: [],
      options: [],
      numericMinimum: 0,
      numericMaximum: 100,
      numericDefault: 80,
      numericStep: 1,
      visuals: [],
    },
  ],
  rules: [
    {
      id: "power",
      type: "require",
      when: { groupId: "size", optionId: "large" },
      then: { groupId: "power", optionId: "pro" },
      minimum: 0,
      maximum: 1,
      priority: 0,
      reason: "Large requires pro",
    },
    {
      id: "range",
      type: "range",
      when: { groupId: "power", optionId: "pro" },
      then: { groupId: "length", optionId: "" },
      minimum: 10,
      maximum: 50,
      priority: 0,
      reason: "Pro length",
    },
  ],
  priceSource: "inquiry",
  priceCurrency: "CNY",
};
assert.deepEqual(validateCatalog(catalog), []);
const solved = resolveConfiguration(catalog, defaultConfiguration(catalog));
assert.deepEqual(solved.selections.power, ["pro"]);
assert.equal(solved.numericValues.length, 50);
assert.equal(solved.bom[0].quantity, 2);
assert.equal(solved.bom[0].sources[0].groupId, "size");
const availability = optionAvailability(catalog, defaultConfiguration(catalog));
assert.equal(availability[configurationOptionKey("size", "small")], undefined);
assert.equal(solved.priceStatus, "inquiry");
assert.ok(
  resolveConfiguration(catalog, {
    ...defaultConfiguration(catalog),
    size: ["missing"],
  }).errors.length,
);
pass(
  "Configurator deterministic cascades, numeric bounds, BOM/SKU and invalid selection gate",
);
assert.equal(convertUnit(1, "m", "mm"), 1000);
assert.equal(
  measure(
    "distance",
    [
      [0, 0, 0],
      [3000, 4000, 0],
    ],
    "m",
  ),
  5,
);
assert.equal(
  measure(
    "angle",
    [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
    ],
    "mm",
  ),
  90,
);
const mapped = mapProperties(
  {
    id: "1",
    sourceElementId: "external:1",
    name: "Part",
    classId: "",
    properties: { length: "1.2" },
    links: [],
    modelRevision: "v1",
  },
  [
    {
      id: "lengthMm",
      name: "Length",
      dataType: "number",
      unit: "mm",
      precision: 2,
      required: true,
      sourcePath: "length",
      sourceUnit: "m",
      emptyPolicy: "error",
      defaultValue: "",
    },
  ],
);
assert.equal((mapped.properties.lengthMm as { value: number }).value, 1200);
assert.deepEqual(mapped.errors, []);
assert.ok(
  polygonContains(
    [
      { yaw: 170, pitch: -10 },
      { yaw: -170, pitch: -10 },
      { yaw: -170, pitch: 10 },
      { yaw: 170, pitch: 10 },
    ],
    179,
    0,
  ),
);
const angles = directionAngles(sphericalDirection(45, 30));
assert.ok(
  Math.abs(angles.yaw - 45) < 1e-10 && Math.abs(angles.pitch - 30) < 1e-10,
);
assert.throws(() =>
  assertIdentityPreserved(reconcileSourceIdentities(["x"], ["x", "x"])),
);
pass(
  "Industrial units/anchored measures/property mapping, panorama seam and canonical source identity gate",
);
const draftGraph = emptyProject();
draftGraph.nodes = [newTourNode("Draft")];
draftGraph.routes = [
  {
    id: "draft",
    name: "Draft",
    loop: false,
    stops: [
      {
        id: "stop",
        nodeId: "",
        hold: 1,
        heading: 0,
        pitch: 0,
        actions: [],
        audioAssetId: "",
        waitForMedia: false,
      },
    ],
  },
];
assert.deepEqual(validateProject(draftGraph), []);
assert.ok(validateProject(draftGraph, true).length);
const raceCatalog = structuredClone(catalog);
raceCatalog.groups = [
  {
    ...raceCatalog.groups[0],
    defaultIds: ["large"],
    options: [
      {
        ...option("large"),
        visuals: [
          {
            id: "part",
            targetId: "mount",
            operation: "swapPart",
            assetId: "asset",
            value: "",
            variant: "",
            transform: {
              position: [0, 0, 0],
              rotation: [0, 0, 0, 1],
              scale: [1, 1, 1],
            },
            camera: { position: [0, 0, 1000], target: [0, 0, 0], fov: 60 },
          },
        ],
      },
    ],
  },
];
raceCatalog.rules = [];
const raceDoc = createDocument("Part race"),
  raceEntity = createEntity("Catalog"),
  mount = createEntity("Mount");
mount.id = "mount";
raceEntity.components.push({
  ...createComponent("studio.configurator.Catalog"),
  data: raceCatalog as unknown as Record<string, JsonValue>,
});
raceDoc.entities.push(raceEntity, mount);
let loads = 0,
  ownedParts = 0,
  resolvePart!: (part: { root: THREE.Group; clips: [] }) => void;
const partPromise = new Promise<{ root: THREE.Group; clips: [] }>((resolve) => {
    resolvePart = resolve;
  }),
  mountObject = new THREE.Group();
const raceRuntime = {
  generation: 1,
  entity: (id: string) => raceDoc.entities.find((e) => e.id === id),
  getObject: () => mountObject,
  getSnapshot: () => ({ extensions: {} }),
  state: { patch: () => {} },
  store: {
    instance: () => {
      loads++;
      return partPromise;
    },
  },
  engine: {
    resourceRegistry: {
      collect: (root: THREE.Group) => {
        const resources = new Set();
        root.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            resources.add(object.geometry);
            resources.add(object.material);
          }
        });
        return resources;
      },
      retain: () => {
        ownedParts++;
      },
      release: () => {
        ownedParts--;
      },
    },
  },
  visual: { setScope: () => {}, reset: () => {} },
};
const configSystem = new ConfiguratorSystem(raceRuntime as never);
configSystem.attach(raceDoc);
const raceResult = resolveConfiguration(
    raceCatalog,
    defaultConfiguration(raceCatalog),
  ),
  older = configSystem.apply(raceEntity.id, raceResult),
  newer = configSystem.apply(raceEntity.id, raceResult);
assert.equal(loads, 1);
const replacement = new THREE.Group();
replacement.add(
  new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()),
);
resolvePart({ root: replacement, clips: [] });
await Promise.all([older, newer]);
configSystem.detach();
assert.equal(ownedParts, 0);
replacement.traverse((object) => {
  if (object instanceof THREE.Mesh) {
    object.geometry.dispose();
    (object.material as THREE.Material).dispose();
  }
});
pass(
  "Concurrent configurator part preparation shares one pending instance and releases its resources on detach",
);
const base = process.env.STUDIO_API ?? "http://127.0.0.1:18080",
  config = JSON.parse(await readFile(".local/config.json", "utf8"));
let token = "";
async function api(path: string, method = "GET", body?: unknown, status = 200) {
  const response = await fetch(base + "/api" + path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(
    response.status,
    status,
    path + " " + (await response.clone().text()),
  );
  return status === 204 ? undefined : response.json();
}
token = (
  await api("/auth/login", "POST", {
    username: config.adminUser,
    password: config.adminPassword,
  })
).token;
async function upload(
  name: string,
  kind: string,
  entry: string,
  files: Record<string, Uint8Array>,
) {
  const response = await fetch(
    base + "/api/assets?" + new URLSearchParams({ name, kind, entry }),
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/zip",
      },
      body: zipSync(files),
    },
  );
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
const template = await api("/library/prefab/" + revision.id, "PUT", {
  name: revision.name,
  expectedRevision: 0,
  document: { rootLocalId: revision.rootLocalId, document: revision.document },
});
await api(
  "/library/prefab/" + revision.id,
  "PUT",
  { name: revision.name, expectedRevision: 0, document: template.document },
  409,
);
const linked = new EditorSession(createDocument("All G1"));
linked.execute(
  instantiatePrefab({ ...revision, revisionId: template.versionId }).command,
);
const catalogId = crypto.randomUUID(),
  savedCatalog = await api("/library/catalog/" + catalogId, "PUT", {
    name: catalog.name,
    expectedRevision: 0,
    document: { ...catalog, catalogId },
  });
assert.equal(savedCatalog.document.libraryVersionId, savedCatalog.versionId);
assert.equal(
  (await api("/library/catalog/" + catalogId)).document.libraryVersionId,
  savedCatalog.versionId,
);
const catalogEntity = createEntity("Product");
catalogEntity.components.push({
  ...createComponent("studio.configurator.Catalog"),
  data: savedCatalog.document as Record<string, JsonValue>,
});
const storyEntity = createEntity("Storyboard"),
  storyComponent = createComponent("studio.storyboard.Sequence");
const sequence = structuredClone(story);
sequence.tracks[0].targetId = linked.document.entities[0].id;
storyComponent.data = sequence as unknown as Record<string, JsonValue>;
storyEntity.components.push(storyComponent);
linked.execute({
  label: "Domains",
  mutate(doc) {
    doc.entities.push(catalogEntity, storyEntity);
  },
});
const project = await api("/projects", "POST", {
  name: "Studio 2.2 acceptance",
  document: sourceDocument(linked.document),
});
assert.equal(
  (await api("/library/prefab/" + revision.id + "/usage")).length,
  1,
);
await api("/library/prefab/" + revision.id, "DELETE", undefined, 409);
const published = await api("/scenes/" + project.sceneId + "/publish", "POST", {
  expectedRevision: project.revision,
});
const publicManifest = await (
  await fetch(base + "/api/player/" + project.sceneId + "/manifest")
).json();
assert.equal(publicManifest.versionId, published.versionId);
assert.equal(publicManifest.document.prefabs, undefined);
assert.equal(publicManifest.document.entities.length, 4);
const malformed = structuredClone(project.document);
malformed.prefabs[0].source.entities[0].name = "Forged";
await api(
  "/scenes/" + project.sceneId + "/draft",
  "PUT",
  { expectedRevision: project.revision, document: malformed },
  422,
);
await api("/library/catalog/" + catalogId, "DELETE", undefined, 409);
const dirtyCatalog = structuredClone(project.document);
dirtyCatalog.entities.find(
  (e: { id: string }) => e.id === catalogEntity.id,
).components[0].data.name = "Uncommitted catalog edits";
const dirtyDraft = await api("/scenes/" + project.sceneId + "/draft", "PUT", {
  expectedRevision: project.revision,
  document: dirtyCatalog,
});
await api(
  "/scenes/" + project.sceneId + "/publish",
  "POST",
  { expectedRevision: dirtyDraft.revision },
  422,
);
const cleanDraft = await api("/scenes/" + project.sceneId + "/draft", "PUT", {
  expectedRevision: dirtyDraft.revision,
  document: project.document,
});
project.revision = cleanDraft.revision;
const pngChunk = (kind: string, bytes: Uint8Array) => {
  const payload = Buffer.concat([Buffer.from(kind), bytes]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const header = Buffer.alloc(4),
    footer = Buffer.alloc(4);
  header.writeUInt32BE(bytes.length);
  footer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, payload, footer]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(32);
ihdr.writeUInt32BE(16, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const raw = Buffer.alloc(16 * (1 + 32 * 4));
for (let y = 0; y < 16; y++)
  for (let x = 0; x < 32; x++) {
    const i = y * 129 + 1 + x * 4;
    raw[i] = x * 8;
    raw[i + 1] = y * 16;
    raw[i + 2] = 128;
    raw[i + 3] = 255;
  }
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  pngChunk("IHDR", ihdr),
  pngChunk("IDAT", deflateSync(raw)),
  pngChunk("IEND", new Uint8Array()),
]);
const panoAsset = await upload(
  "Calibration panorama (synthetic)",
  "image",
  "panorama.png",
  { "panorama.png": png },
);
const graph = emptyProject(),
  node = newTourNode("First"),
  other = await api("/projects/" + project.projectId + "/scenes", "POST", {
    name: "Second",
    document: createDocument("Second"),
  });
node.sceneId = project.sceneId;
const next = newTourNode("Second");
next.sceneId = other.sceneId;
const pano = newTourNode("Calibration panorama", "panorama");
pano.assetId = panoAsset.id;
pano.hotspots = [
  {
    id: "back",
    name: "Return to 3D",
    kind: "point",
    yaw: 0,
    pitch: 0,
    points: [],
    toNodeId: node.id,
    contentId: "",
    assetId: "",
    text: "Return to 3D",
    alt: "Return to 3D",
    color: "#38caa6",
  },
];
graph.assets = [panoAsset];
graph.nodes = [node, next, pano];
graph.floors = [
  {
    id: "ground",
    name: "Calibration floor",
    assetId: panoAsset.id,
    calibrated: true,
    north: 0,
    mmPerPixel: 100,
    imageWidth:32,
    imageHeight:16,
  },
];
node.floorId = "ground";
pano.floorId = "ground";
graph.entryNodeId = node.id;
graph.skinSceneId = project.sceneId;
graph.links = [
  {
    id: "link",
    fromNodeId: node.id,
    toNodeId: next.id,
    reverseLinkId: "",
    transition: "fade",
  },
];
const show = createAction("Show");
show.targetId = linked.document.entities[0].id;
graph.routes = [
  {
    id: "route",
    name: "Acceptance route",
    loop: false,
    stops: [
      {
        id: "first",
        nodeId: node.id,
        hold: 1,
        heading: 0,
        pitch: 0,
        actions: [show],
        audioAssetId: "",
        waitForMedia: false,
      },
      {
        id: "pano",
        nodeId: pano.id,
        hold: 1,
        heading: 90,
        pitch: 0,
        actions: [],
        audioAssetId: "",
        waitForMedia: false,
      },
    ],
  },
];
const graphHead = await api("/library/project/" + project.projectId, "PUT", {
  name: graph.name,
  expectedRevision: 0,
  document: graph,
});
const projectPublished = await api(
  "/projects/" + project.projectId + "/publish",
  "POST",
  {
    expectedRevision: graphHead.revision,
    sceneRevisions: {
      [project.sceneId]: project.revision,
      [other.sceneId]: other.revision,
    },
  },
);
const manifest = await (
  await fetch(base + "/api/player/projects/" + project.projectId + "/manifest")
).json();
assert.equal(manifest.versionId, projectPublished.versionId);
assert.equal(Object.keys(manifest.sceneVersions).length, 2);
await api(
  "/projects/" + project.projectId + "/publish",
  "POST",
  { expectedRevision: 0, sceneRevisions: {} },
  409,
);
assert.equal(
  (
    await (
      await fetch(
        base + "/api/player/projects/" + project.projectId + "/manifest",
      )
    ).json()
  ).versionId,
  manifest.versionId,
);
const restored = await api(
  "/projects/" +
    project.projectId +
    "/publications/" +
    manifest.versionId +
    "/restore",
  "POST",
  { expectedRevision: graphHead.revision },
);
assert.ok(
  restored.document.nodes
    .filter((n: { kind: string }) => n.kind === "scene3d")
    .every((n: { sceneVersionId: string }) => n.sceneVersionId),
);
const changedDocument = structuredClone(other.document);
changedDocument.name = "Edited after publication";
const changedDraft = await api("/scenes/" + other.sceneId + "/draft", "PUT", {
  expectedRevision: other.revision,
  document: changedDocument,
});
other.revision = changedDraft.revision;
const pinnedPublication = await api(
  "/projects/" + project.projectId + "/publish",
  "POST",
  {
    expectedRevision: restored.revision,
    sceneRevisions: {
      [project.sceneId]: project.revision,
      [other.sceneId]: other.revision,
    },
  },
);
const historical = await (
  await fetch(
    base +
      "/api/player/projects/" +
      project.projectId +
      "/versions/" +
      pinnedPublication.versionId +
      "/scenes/" +
      other.sceneId,
  )
).json();
assert.equal(historical.document.name, "Second");
const exportResponse = await fetch(
  base + "/api/projects/" + project.projectId + "/export",
  { headers: { Authorization: "Bearer " + token } },
);
assert.equal(exportResponse.status, 200);
const archive = new Uint8Array(await exportResponse.arrayBuffer()),
  files = unzipSync(archive);
assert.ok(files["archive.json"]);
assert.ok(
  files[
    "library/catalog/" + catalogId + "/" + savedCatalog.versionId + ".json"
  ],
);
assert.ok(files["assets.json"]);
const importedResponse = await fetch(base + "/api/projects/import", {
  method: "POST",
  headers: {
    Authorization: "Bearer " + token,
    "Content-Type": "application/zip",
  },
  body: archive,
});
assert.equal(
  importedResponse.status,
  200,
  await importedResponse.clone().text(),
);
const imported = await importedResponse.json();
assert.equal(
  (await api("/projects/" + imported.projectId + "/scenes")).length,
  2,
);
const copy = await api("/projects/" + project.projectId + "/copy", "POST");
assert.equal((await api("/projects/" + copy.projectId + "/scenes")).length, 2);
pass(
  "Native AOT library CAS, authoritative prefab source, dependency delete gate, compiled public scene, atomic multi-scene project publish, previous-pointer preservation, complete ZIP import/export/copy",
);
const semantic = await upload(
  "Semantic fixture",
  "semantic",
  "semantics.json",
  {
    "semantics.json": new TextEncoder().encode(
      JSON.stringify({
        records: [
          {
            id: "a",
            sourceElementId: "external:part-a",
            name: "Part A",
            classId: "equipment",
            properties: { length: "1.2", system: "supply" },
            links: [],
            modelRevision: "v1",
          },
          {
            id: "b",
            sourceElementId: "external:part-b",
            name: "Part B",
            classId: "other",
            properties: { length: "bad", system: "return" },
            links: [],
            modelRevision: "v1",
          },
        ],
      }),
    ),
  },
);
await api("/semantics/" + semantic.id + "/index", "POST");
assert.equal((await api("/semantics/" + semantic.id + "?q=Part")).total, 2);
assert.equal(
  (
    await api(
      "/semantics/" +
        semantic.id +
        "?filters=" +
        encodeURIComponent(
          JSON.stringify([
            {
              id: "filter",
              field: "system",
              operator: "eq",
              value: "supply",
              join: "and",
            },
          ]),
        ),
    )
  ).total,
  1,
);
const field = {
  id: "lengthMm",
  name: "Length",
  dataType: "number",
  unit: "mm",
  sourceUnit: "m",
  sourcePath: "length",
  precision: 2,
  required: true,
  emptyPolicy: "error",
  defaultValue: "",
};
const preflight = await api("/semantics/" + semantic.id + "/map", "POST", {
  classId: "equipment",
  fields: [field],
  apply: false,
});
assert.equal(preflight.errorCount, 1);
await api(
  "/semantics/" + semantic.id + "/map",
  "POST",
  { classId: "equipment", fields: [field], apply: true },
  422,
);
const numericPage = await api(
  "/semantics/" + semantic.id + "?idsOnly=1&valueField=length",
);
assert.equal(numericPage.values["external:part-a"], 1.2);
assert.equal(numericPage.values["external:part-b"], null);
const scoped = await api("/semantics/" + semantic.id + "/map", "POST", {
  classId: "equipment-mapped",
  fields: [field],
  apply: true,
  sourceClassId: "equipment",
});
assert.equal(scoped.count, 1);
const scopedPage = await api("/semantics/" + scoped.asset.id);
assert.equal(
  scopedPage.items.find(
    (r: { sourceElementId: string }) => r.sourceElementId === "external:part-b",
  ).classId,
  "other",
);
const classDoc = createDocument("Industrial contract");
const reviewEntity = createEntity("Review"),
  reviewComponent = createComponent("studio.industrial.Review");
reviewComponent.data.semanticAssetId = semantic.id;
reviewComponent.data.colors = [
  {
    id: "gradient",
    field: "length",
    value: "",
    min: 0,
    max: 2,
    mode: "range",
    color: "#0000ff",
    colorEnd: "#ff0000",
    priority: 0,
  },
  {
    id: "missing",
    field: "absent",
    value: "",
    min: 0,
    max: 0,
    mode: "missing",
    color: "#888888",
    priority: 1,
  },
];
reviewEntity.components.push(reviewComponent);
classDoc.entities.push(reviewEntity);
classDoc.assets.push(semantic);
declareExtension(classDoc, reviewComponent.type);
const classDraft = await api("/projects", "POST", {
  name: classDoc.name,
  document: classDoc,
});
await api("/scenes/" + classDraft.sceneId + "/publish", "POST", {
  expectedRevision: 0,
});
await api("/projects/" + classDraft.projectId, "DELETE", undefined, 204);
pass(
  "Native indexed semantic search/filter and all-or-nothing typed mapping rejection",
);
const gltf = new Document(),
  buffer = gltf.createBuffer();
const position = gltf
  .createAccessor()
  .setType("VEC3")
  .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
  .setBuffer(buffer);
const primitive = gltf.createPrimitive().setAttribute("POSITION", position);
const modelMesh = gltf.createMesh().addPrimitive(primitive);
const modelNode = gltf
  .createNode("Part A")
  .setExtras({ sourceElementId: "part-a", system: "supply" })
  .setMesh(modelMesh);
const baseMaterial = gltf
  .createMaterial("Base")
  .setBaseColorFactor([1, 0, 0, 1]);
const variantExtension = gltf.createExtension(KHRMaterialsVariants),
  blueVariant = variantExtension.createVariant("Blue");
const bindVariant = (
  p: typeof primitive,
  color: [number, number, number, number],
) =>
  p
    .setMaterial(baseMaterial)
    .setExtension(
      "KHR_materials_variants",
      variantExtension
        .createMappingList()
        .addMapping(
          variantExtension
            .createMapping()
            .addVariant(blueVariant)
            .setMaterial(gltf.createMaterial().setBaseColorFactor(color)),
        ),
    );
bindVariant(primitive, [0, 0, 1, 1]);
const siblingPrimitive = gltf
  .createPrimitive()
  .setAttribute("POSITION", position);
bindVariant(siblingPrimitive, [0, 1, 0, 1]);
gltf
  .createScene()
  .addChild(modelNode)
  .addChild(
    gltf
      .createNode("Part B")
      .setExtras({ sourceElementId: "part-b" })
      .setTranslation([2, 0, 0])
      .setMesh(gltf.createMesh().addPrimitive(siblingPrimitive)),
  );
const bytes = await new NodeIO()
  .registerExtensions([KHRMaterialsVariants])
  .writeBinary(gltf);
const model = await upload("Processing fixture", "model", "model.glb", {
  "model.glb": bytes,
});
async function job(
  operation: string,
  settings: unknown = {
    useMeshopt: true,
    textureCodec: "retain",
    preserveSemantics: true,
    protectedSourceIds: ["external:part-a"],
  },
) {
  let result = await api("/jobs", "POST", {
    sourceAssetId: model.id,
    operation,
    settings,
  });
  for (
    let i = 0;
    i < 120 && ["Queued", "Running"].includes(result.status);
    i++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    result = await api("/jobs/" + result.id);
  }
  assert.equal(result.status, "Succeeded", JSON.stringify(result));
  return JSON.parse(result.resultJson);
}
const diagnostic = await job("diagnose");
assert.equal(diagnostic.report.before.triangles, 2);
const optimized = await job("optimize");
assert.equal(optimized.report.identityReport.matched.length, 1);
assert.equal(optimized.report.nodeTransformsPreserved, true);
assert.equal(optimized.report.materialVariantsPreserved, true);
assert.equal(optimized.report.after.meshes, 2);
assert.ok(optimized.assets.some((a: { kind: string }) => a.kind === "model"));
await api("/assets/" + model.id, "DELETE", undefined, 409);
const cancelled = await api("/jobs", "POST", {
  sourceAssetId: model.id,
  operation: "optimize",
  settings: {
    useMeshopt: true,
    textureCodec: "retain",
    preserveSemantics: true,
    protectedSourceIds: [],
  },
});
await api("/jobs/" + cancelled.id, "DELETE", undefined, 204);
let cancelledResult = await api("/jobs/" + cancelled.id);
for (
  let i = 0;
  i < 20 && ["Queued", "Running"].includes(cancelledResult.status);
  i++
) {
  await new Promise((resolve) => setTimeout(resolve, 250));
  cancelledResult = await api("/jobs/" + cancelled.id);
}
assert.equal(cancelledResult.status, "Cancelled");
pass(
  "Persistent native job queue invokes real Meshopt worker, diagnoses source, preserves distinct material variants and poses, gates identities, indexes derived semantics, cancellation and source dependency retention",
);
await mkdir(".local/acceptance", { recursive: true });
await writeFile(
  ".local/acceptance/studio22.json",
  JSON.stringify(
    {
      status: "Pass",
      evidence,
      fixtures: {
        projectId: project.projectId,
        sceneId: project.sceneId,
        secondSceneId: other.sceneId,
        templateId: revision.id,
        modelAssetId: model.id,
        semanticAssetId: semantic.id,
      },
      at: new Date().toISOString(),
    },
    null,
    2,
  ),
);
for (const id of [imported.projectId, copy.projectId])
  await api("/projects/" + id, "DELETE", undefined, 204);
console.log(
  "Pass: " +
    evidence.length +
    " Studio 2.2 contract/integration groups; published project retained for browser acceptance.",
);
