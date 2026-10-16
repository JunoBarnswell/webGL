import { evaluatePose, stages } from "../packages/extensions/assembly/pose";
import {
  anchorProblem,
  resolveAnchor,
  surfaceAnchor,
} from "../packages/extensions/annotation/anchors";
import { AnnotationLayoutEngine } from "../packages/extensions/annotation/layout";
import { VisualStateSystem } from "../packages/scene-runtime/src/systems/VisualStateSystem";
import { modelEntities, modelImporter } from "@studio/asset-pipeline";
import { SamplePulseSystem } from "../packages/extensions/sample/runtime";
import { SpatialIndex } from "../packages/scene-runtime/src/systems/SpatialIndex";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  createDocument,
  createEntity,
  createComponent,
  declareExtension,
  validateDocument,
  migrateDocument,
  orderExtensions,
  extensionCatalog,
  modelIdentities,
  getComponent,
  actionDefinitions,
  fieldOptions,
  componentDefinitions,
  editField,
  type SceneAsset,
} from "@studio/scene-schema";
import {
  EditorSession,
  CommandRegistry,
  bindingConflicts,
  changesBetween,
  duplicateEntities,
  deleteEntities,
  replaceModelRevision,
  documentValue,
  writeDocumentValue,
} from "@studio/editor-core";
import { AssemblySystem } from "../packages/extensions/assembly/runtime";
import { PipingSystem } from "../packages/extensions/piping/runtime";
import { pipingCsv, extensionTools } from "../packages/extensions/editor";
import { EntityIndex } from "../packages/scene-runtime/src/systems/RuntimeSystem";
import { SceneRuntime } from "@studio/scene-runtime";
const passed: string[] = [];
const pass = (name: string) => {
  passed.push(name);
  console.log("Pass: " + name);
};
const original = createDocument();
const legacy = structuredClone(original) as Partial<typeof original>;
delete legacy.documentVersion;
delete legacy.requiredExtensions;
const migrated = migrateDocument(legacy);
assert.equal(migrated.report.from, 1);
assert.deepEqual(
  migrateDocument(migrated.document).document,
  migrated.document,
);
assert.deepEqual(original.entities, migrated.document.entities);
pass("v1 boundary migration preserves data and is idempotent");
assert.throws(
  () =>
    orderExtensions([
      extensionCatalog.manifests[0],
      extensionCatalog.manifests[0],
    ]),
  /重复/,
);
const m = extensionCatalog.manifests[0];
assert.throws(
  () => orderExtensions([{ ...m, dependsOn: { absent: "2.0.0" } }]),
  /缺失/,
);
assert.throws(
  () =>
    orderExtensions([
      { ...m, id: "a", dependsOn: { b: "2.0.0" } },
      { ...m, id: "b", dependsOn: { a: "2.0.0" } },
    ]),
  /循环/,
);
pass(
  "deterministic extension registration rejects duplicates, missing dependencies and cycles",
);
const doc = createDocument("Extension contract");
const entity = createEntity("Pulse");
entity.components.push(createComponent("studio.sample.Pulse"));
declareExtension(doc, "studio.sample.Pulse");
doc.entities.push(entity);
assert.deepEqual(validateDocument(doc, true), []);
const invalid = structuredClone(doc);
invalid.entities[0].components[0].data.amplitude = 2;
assert.ok(validateDocument(invalid).length);
const unknown = structuredClone(doc);
unknown.entities[0].components.push({
  type: "vendor.unknown.Component",
  enabled: true,
  data: { nested: ["preserved", 3] },
});
assert.deepEqual(validateDocument(unknown), []);
assert.ok(validateDocument(unknown, true).length);
const session = new EditorSession(unknown);
session.execute(duplicateEntities([entity.id]));
assert.deepEqual(session.document.entities[1].components[1].data, {
  nested: ["preserved", 3],
});
session.undo();
assert.equal(session.document.entities.length, 1);
session.redo();
assert.equal(session.document.entities.length, 2);
pass(
  "extension shape, unknown JSON preservation, clone, undo/redo and publication rejection",
);
const registry = new CommandRegistry();
let calls = 0;
registry.register({
  id: "save",
  title: "保存",
  scope: "global",
  category: "工程",
  shortcuts: ["Mod+S"],
  enabled: (c) => c.editingAllowed,
  execute: () => {
    calls++;
  },
});
const context = {
  surface: "editor" as const,
  editingAllowed: false,
  selectedIds: [],
  flying: false,
  dragging: false,
  signal: new AbortController().signal,
};
assert.equal(await registry.execute("save", context), false);
assert.equal(calls, 0);
await registry.execute("save", { ...context, editingAllowed: true });
assert.equal(calls, 1);
assert.ok(bindingConflicts(registry, { save: ["Mod+R"] }).length);
pass("one command execution gate and browser-reserved bindings");
const model = modelIdentities(
  [
    { name: "root", children: [1] },
    { name: "part", extras: { ElementId: "stable" } },
  ],
  [0],
);
assert.equal(model.get(1), "external:stable");
assert.throws(
  () =>
    modelIdentities(
      [{ extras: { ElementId: "same" } }, { extras: { ElementId: "same" } }],
      [0, 1],
    ),
  /不唯一/,
);
pass(
  "model identity uses stable metadata, rejects ambiguous source identities",
);
const assemblyDoc = createDocument();
const root = createEntity("Assembly"),
  part = createEntity("Part");
root.components.push(createComponent("studio.assembly.Root"));
const component = createComponent("studio.assembly.Part");
component.data.groupId = root.id;
part.components.push(component);
assemblyDoc.entities.push(root, part);
declareExtension(assemblyDoc, component.type);
const objects = new Map([
  [root.id, new THREE.Group()],
  [part.id, new THREE.Group()],
]);
objects.get(part.id)!.position.set(3, 5, 7);
const index = new EntityIndex();
index.reset(assemblyDoc);
const runtime = {
  generation: 1,
  spatial: { invalidate: () => {} },
  actionScopes: new Map(),
  mode: "play",
  document: assemblyDoc,
  index,
  getObject: (id: string) => objects.get(id),
  sourceUnits: () => 1,
  state: { patch: () => {} },
  getSnapshot: () => ({ extensions: {} }),
  engine: {
    renderer: { localClippingEnabled: false },
    scene: new THREE.Scene(),
    resourceRegistry: { retain: () => {}, release: () => {} },
    requestRender: () => {},
    onUpdate: () => () => {},
  },
} as unknown as SceneRuntime;
Object.assign(runtime, { visual: new VisualStateSystem(runtime) });
runtime.actionScope = SceneRuntime.prototype.actionScope.bind(runtime);
const assembly = new AssemblySystem(runtime);
assembly.attach(assemblyDoc);
for (let i = 0; i < 100; i++) {
  assembly.seek(root.id, 0.8);
  assembly.seek(root.id, 0.2);
  assembly.seek(root.id, 1);
  assembly.seek(root.id, 0);
}
assert.deepEqual(objects.get(part.id)!.position.toArray(), [3, 5, 7]);
const play = {
  id: "play",
  type: "studio.assembly.Play",
  targetId: root.id,
  data: {},
  wait: false,
};
await assembly.actions["studio.assembly.Play"](
  play,
  new AbortController().signal,
);
await assembly.actions["studio.assembly.Play"](
  play,
  new AbortController().signal,
);
assembly.update(0.1);
assert.ok(assembly.sequences.get(root.id)!.progress > 0);
assembly.detach();
assert.equal(assembly.sequences.size, 0);
pass("100 assembly seek/reverse/reset cycles do not accumulate pose drift");
const pipeDoc = createDocument();
const pipeRoot = createEntity("Pipe"),
  segment = createEntity("Segment");
pipeRoot.components.push(createComponent("studio.piping.Line"));
getComponentData(pipeRoot, "studio.piping.Line").lineNo = "L-1";
const seg = createComponent("studio.piping.Segment");
seg.data.lineId = pipeRoot.id;
seg.data.sourceElementId = "ELEMENT-1";
segment.components.push(seg);
pipeDoc.entities.push(pipeRoot, segment);
declareExtension(pipeDoc, seg.type);
const pipeSession = new EditorSession(pipeDoc);
const csv = pipingCsv(
  pipeDoc,
  'sourceElementId,lineNo,service\nELEMENT-1,L-2,"water, hot"\n',
);
assert.deepEqual(csv.report.errors, []);
pipeSession.execute(csv.command);
assert.equal(pipeSession.document.entities.length, 3);
pipeSession.undo();
assert.equal(pipeSession.document.entities.length, 2);
assert.ok(
  pipingCsv(pipeDoc, "sourceElementId,lineNo\nmissing,L\n").report.errors
    .length,
);
pass(
  "CSV mapped import is transactional, reports invalid matches, supports quoted cells and undo",
);
const label = extensionTools.find((t) => t.id === "annotation.label")!;
pipeSession.execute(label.create(pipeSession.document, [segment.id]));
assert.throws(() => pipeSession.execute(deleteEntities([segment.id])), /引用/);
pass("referenced annotation anchors prevent silent parent deletion");
const before = pipeSession.document;
pipeSession.execute({
  label: "rename",
  mutate: (d) => {
    d.entities[0].name = "rename";
  },
});
assert.deepEqual(changesBetween(before, pipeSession.document).entityIds, [
  pipeRoot.id,
]);
pass("dirty changes identify one entity");
const piping = new PipingSystem(runtime);
piping.attach(pipeDoc);
assert.deepEqual([...piping.segmentsByLine.get(pipeRoot.id)!], [segment.id]);
piping.detach();
pass("logical line to segment index lifecycle");

function getComponentData(entity: typeof pipeRoot, type: string) {
  return entity.components.find((c) => c.type === type)!.data;
}

const scene = new THREE.Group(),
  cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
scene.add(cube);
const spatial = new SpatialIndex();
const ray = new THREE.Raycaster(
  new THREE.Vector3(0, 0, 5),
  new THREE.Vector3(0, 0, -1),
);
assert.ok(spatial.raycast(scene, ray, () => true).length);
cube.position.x = 10;
spatial.invalidate();
assert.equal(spatial.raycast(scene, ray, () => true).length, 0);
cube.geometry.dispose();
(cube.material as THREE.Material).dispose();
pass(
  "spatial BVH follows invalidated transforms and rejects broad-phase misses",
);

const pulseDoc = createDocument();
const pulseEntity = createEntity("pulse");
pulseEntity.components.push(createComponent("studio.sample.Pulse"));
pulseDoc.entities.push(pulseEntity);
index.reset(pulseDoc);
objects.set(pulseEntity.id, new THREE.Group());
const pulse = new SamplePulseSystem(runtime);
pulse.attach(pulseDoc);
pulse.update(0.1);
assert.notEqual(objects.get(pulseEntity.id)!.scale.x, 1);
await pulse.actions["studio.sample.SetPulse"]({
  targetId: pulseEntity.id,
  data: { active: false },
});
pulse.update(0.1);
assert.equal(objects.get(pulseEntity.id)!.scale.x, 1);
pulse.detach();
assert.deepEqual(objects.get(pulseEntity.id)!.scale.toArray(), [1, 1, 1]);
pass(
  "sample action and system detach restore exact scale without GPU resources",
);

const basePose = {
  position: new THREE.Vector3(3, 5, 7),
  rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.3, 0.4)),
  scale: new THREE.Vector3(2, 3, 4),
  visible: true,
};
const recipe = stages(component.data.stages);
recipe[0].path = [
  [0, 200, 0],
  [400, 200, 100],
];
recipe[0].rotation = [0, 90, 0];
recipe[0].scale = [2, 1, 0.5];
recipe[0].visibility = "hide";
const pose = evaluatePose(basePose, recipe, 1);
assert.deepEqual(pose.position.toArray(), [403, 205, 107]);
assert.deepEqual(pose.scale.toArray(), [4, 3, 2]);
assert.equal(pose.visible, false);
assert.ok(pose.rotation.angleTo(basePose.rotation) > 0.1);
assert.ok(evaluatePose(basePose, recipe, 0.5).position.y > 100);
for (let i = 0; i < 100; i++) {
  evaluatePose(basePose, recipe, (i % 31) / 31);
  assert.deepEqual(evaluatePose(basePose, recipe, 0), basePose);
}
pass(
  "curved paths, local rotation/scale and visibility evaluate from immutable assembly poses",
);
const pathDoc = structuredClone(assemblyDoc),
  path = [
    "entities",
    { id: part.id },
    "components",
    { type: "studio.assembly.Part" },
    "data",
    "stages",
    { id: "initial" },
    "path",
    0,
  ];
writeDocumentValue(pathDoc, path, [22, 33, 44]);
assert.deepEqual(documentValue(pathDoc, path), [22, 33, 44]);
assert.throws(() => writeDocumentValue(pathDoc, ["__proto__", "polluted"], 1));
const optionSpec = actionDefinitions.find(
  (d) => d.type === "studio.assembly.SelectStep",
)!.fields.stepId;
assert.deepEqual(
  fieldOptions(pathDoc, optionSpec, root.id)?.map((o) => o.value),
  ["initial"],
);
pass(
  "generic spatial paths use stable entity and stage IDs and generated step options",
);
const modelAsset: SceneAsset = {
  id: crypto.randomUUID(),
  name: "Stable model",
  kind: "model",
  entry: "model.gltf",
  files: ["model.gltf"],
  sha256: "a".repeat(64),
};
const originalNodes = modelEntities(
  modelAsset,
  {
    nodes: [
      { name: "old root", children: [1, 2], extras: { ElementId: "root" } },
      { name: "part A", translation: [0.1, 0, 0], extras: { ElementId: "A" } },
      { name: "part B", extras: { ElementId: "B" } },
    ],
    roots: [0],
    animations: [],
  },
  null,
);
const revisionDoc = createDocument();
revisionDoc.assets.push(modelAsset);
revisionDoc.entities.push(...originalNodes);
const stablePart = originalNodes[2],
  removedPart = originalNodes[3];
stablePart.name = "Business part";
stablePart.transform.position = [777, 20, 30];
const nextAsset = {
  ...modelAsset,
  id: crypto.randomUUID(),
  sha256: "b".repeat(64),
};
const nextNodes = modelEntities(
  nextAsset,
  {
    nodes: [
      { name: "changed root", children: [1, 2], extras: { ElementId: "root" } },
      { name: "renamed A", translation: [1, 0, 0], extras: { ElementId: "A" } },
      { name: "new C", extras: { ElementId: "C" } },
    ],
    roots: [0],
    animations: [],
  },
  null,
);
const blockedRevision = replaceModelRevision(
  revisionDoc,
  originalNodes[0].id,
  nextAsset,
  nextNodes,
);
assert.throws(
  () => new EditorSession(revisionDoc).execute(blockedRevision.command),
  /未匹配/,
);
const accepted = replaceModelRevision(
  revisionDoc,
  originalNodes[0].id,
  nextAsset,
  nextNodes,
  { keepUnmatched: true, acceptNew: true },
);
const revisionSession = new EditorSession(revisionDoc);
revisionSession.execute(accepted.command);
assert.deepEqual(
  revisionSession.document.entities.find((e) => e.id === stablePart.id)!
    .transform.position,
  [777, 20, 30],
);
assert.equal(
  revisionSession.document.entities.find((e) => e.id === stablePart.id)!.name,
  "Business part",
);
assert.equal(
  getComponent(
    revisionSession.document.entities.find((e) => e.id === removedPart.id)!,
    "ModelNode",
  )!.data.sourceStatus,
  "unresolved",
);
assert.ok(validateDocument(revisionSession.document, true).length);
revisionSession.undo();
assert.deepEqual(revisionSession.document, revisionDoc);
assert.ok(modelImporter("test.gltf"));
assert.equal(modelImporter("test.ifc"), undefined);
pass(
  "model revision preserves entity identity and edited pose, accepts new hierarchy, blocks unresolved publication and undoes",
);
const anchorDoc = createDocument();
anchorDoc.assets.push({ ...modelAsset, kind: "mesh" });
const anchorEntity = createEntity("Surface");
const meshComponent = createComponent("Mesh");
meshComponent.data.assetId = modelAsset.id;
anchorEntity.components.push(meshComponent);
anchorDoc.entities.push(anchorEntity);
const anchorLabel = createComponent("studio.annotation.Label");
Object.assign(anchorLabel.data, {
  anchorKind: "surface",
  entityId: anchorEntity.id,
  sourceElementId: anchorEntity.id,
  meshRevision: modelAsset.sha256,
  triangleIndex: 0,
  barycentric: [0.2, 0.3, 0.5],
});
const anchorMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
anchorMesh.userData.entityId = anchorEntity.id;
anchorMesh.position.set(10, 20, 30);
anchorMesh.updateMatrixWorld(true);
const anchorRuntime = {
  document: anchorDoc,
  index: { entities: new Map([[anchorEntity.id, anchorEntity]]) },
  getObject: () => anchorMesh,
} as unknown as SceneRuntime;
assert.ok(resolveAnchor(anchorRuntime, "label", anchorLabel).world);
anchorLabel.data.meshRevision = "changed";
assert.match(anchorProblem(anchorDoc, anchorLabel)!, /版本/);
assert.equal(
  resolveAnchor(anchorRuntime, "label", anchorLabel).world,
  undefined,
);
const rayHit = new THREE.Raycaster(
  new THREE.Vector3(10, 20, 35),
  new THREE.Vector3(0, 0, -1),
).intersectObject(anchorMesh)[0];
const picked = surfaceAnchor(anchorRuntime, rayHit)!;
assert.equal(picked.entityId, anchorEntity.id);
assert.ok(Math.abs(picked.barycentric.reduce((a, b) => a + b, 0) - 1) < 0.001);
assert.equal(picked.primitiveIndex, 0);
const anchorFields = componentDefinitions.find(
  (d) => d.type === "studio.annotation.Label",
)!.fields;
editField(anchorLabel.data, anchorFields, "entityId", "new");
assert.equal(anchorLabel.data.meshRevision, "");
anchorMesh.geometry.dispose();
(anchorMesh.material as THREE.Material).dispose();
pass(
  "surface barycentrics, stable primitive identity, revision repair and target-change resets share one anchor contract",
);
const typed = pipingCsv(
  pipeDoc,
  "Element,Line,Temperature,Open\nELEMENT-1,L-2,95.5,true\n",
  {
    sourceElementId: { column: "Element" },
    lineNo: { column: "Line" },
    temperature: { column: "Temperature", type: "number", unit: "C" },
    open: { column: "Open", type: "boolean" },
  },
);
const typedSession = new EditorSession(pipeDoc);
typedSession.execute(typed.command);
const typedLine = typedSession.document.entities.find(
  (e) => getComponent(e, "studio.piping.Line")?.data.lineNo === "L-2",
)!;
assert.deepEqual(
  getComponent(typedLine, "studio.piping.Line")!.data.properties,
  { temperature: { value: 95.5, unit: "C" }, open: true },
);
assert.ok(
  pipingCsv(pipeDoc, "Element,Line,Temperature\nELEMENT-1,L-2,nope\n", {
    sourceElementId: { column: "Element" },
    lineNo: { column: "Line" },
    temperature: { column: "Temperature", type: "number" },
  }).report.errors.length,
);
pass(
  "CSV mappings retain typed custom properties and units and reject invalid numbers",
);
const layout = new AnnotationLayoutEngine();
const projected = [
  {
    id: "b",
    text: "B",
    x: 10,
    y: 10,
    anchorX: 0,
    anchorY: 0,
    color: "#fff",
    size: 14,
    cluster: true,
    distance: 2,
  },
  {
    id: "a",
    text: "A",
    x: 10,
    y: 10,
    anchorX: 0,
    anchorY: 0,
    color: "#fff",
    size: 14,
    cluster: true,
    distance: 1,
    selected: true,
  },
];
assert.deepEqual(
  layout.layout(projected),
  layout.layout([...projected].reverse()),
);
assert.deepEqual(layout.layout(projected)[0].ids, ["a", "b"]);
pass(
  "cluster layout is deterministic and selected labels have stable priority",
);
const visualMesh = new THREE.Mesh(
  new THREE.BoxGeometry(),
  new THREE.MeshStandardMaterial(),
);
const originalMaterial = visualMesh.material;
const retained = new Set();
const visualRuntime = {
  generation: 1,
  getObject: () => visualMesh,
  engine: {
    renderer: { localClippingEnabled: false },
    requestRender: () => {},
    resourceRegistry: {
      retain: (r: unknown) => retained.add(r),
      release: (r: unknown) => retained.delete(r),
    },
  },
} as unknown as SceneRuntime;
const visual = new VisualStateSystem(visualRuntime);
for (let i = 0; i < 20; i++) {
  visual.highlight("test", ["mesh"]);
  assert.notEqual(visualMesh.material, originalMaterial);
  visual.reset();
  assert.equal(visualMesh.material, originalMaterial);
}
visual.isolate("test", [], ["mesh"]);
visual.rebase(() => {
  visualMesh.visible = false;
});
visual.reset();
assert.equal(visualMesh.visible, false);
assert.equal(retained.size, 0);
visualMesh.geometry.dispose();
originalMaterial.dispose();
pass(
  "shared visual overlays release materials and restore current assembly visibility",
);
console.log(
  JSON.stringify({ status: "Pass", checks: passed.length, evidence: passed }),
);
