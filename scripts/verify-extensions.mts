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
} from "@studio/scene-schema";
import {
  EditorSession,
  CommandRegistry,
  bindingConflicts,
  changesBetween,
  duplicateEntities,
  deleteEntities,
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
  spatial: { invalidate: () => {} },
  actionScopes: new Map(),
  mode: "play",
  document: assemblyDoc,
  index,
  getObject: (id: string) => objects.get(id),
  sourceUnits: () => 1,
  engine: { requestRender: () => {}, onUpdate: () => () => {} },
} as unknown as SceneRuntime;
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
console.log(
  JSON.stringify({ status: "Pass", checks: passed.length, evidence: passed }),
);
