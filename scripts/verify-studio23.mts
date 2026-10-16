import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as THREE from "three";
import {
  createDocument,
  createEntity,
  createComponent,
  documentReferences,
  releaseReadiness,
  type SceneDocument,
} from "@studio/scene-schema";
import {
  EditorSession,
  createPrefabRevision,
  instantiatePrefab,
  planPrefabUpdate,
  applyPrefabUpdatePlan,
  prefabSourcePath,
  revisionFromInstance,
} from "@studio/editor-core";
import { freeze } from "immer";
import { unitCatalog, strictNumber } from "@studio/scene-schema";
import {
  convertUnit,
  mapProperties,
  effectiveClassFields,
  classCompleteness,
  systemTopology,
  type PropertyDefinition,
  type SemanticRecord,
  type SemanticSystem,
  type AssetClass,
} from "../packages/extensions/industrial/core";
import {
  emptyProject,
  newTourNode,
  validateProject,
  directionAngles,
  type ProjectManifest,
} from "../packages/extensions/virtual-tour/core";
import {
  calibrateFloor,
  floorToWorld,
  worldToFloor,
  ensureDiagram,
  removeProjectNodes,
} from "../packages/extensions/virtual-tour/spatial";
import {
  readProjectLocation,
  projectLocationUrl,
  locationPose,
} from "../packages/extensions/virtual-tour/location";
import {
  compileStoryboard,
  evaluateStoryboard,
  newClip,
  rippleStory,
  subtitles,
  validateStory,
  type Storyboard,
} from "../packages/extensions/storyboard/core";
import { CameraOwnership } from "../packages/scene-runtime/src/CameraOwnership";
import { VisualStateSystem } from "../packages/scene-runtime/src/systems/VisualStateSystem";
import {
  compileRuleGraph,
  resolveConfiguration,
  type ProductCatalog,
  type ConfigRule,
} from "../packages/extensions/configurator/core";
const evidence: string[] = [];
const pass = (message: string) => {
  evidence.push(message);
  console.log("Pass: " + message);
};
const source = createDocument("Source"),
  root = createEntity("Root"),
  child = createEntity("Child", root.id);
source.entities.push(root, child);
const revision = createPrefabRevision(source, root.id, "Template"),
  session = new EditorSession(createDocument()),
  created = instantiatePrefab(revision);
session.execute(created.command);
const target = created.instance.bindings.entity[child.id],
  rootTarget = created.instance.bindings.entity[root.id];
session.execute({
  label: "外部引用",
  mutate(doc) {
    for (let i = 0; i < 2; i++) {
      const e = createEntity("External " + i),
        c = createComponent("studio.annotation.Label");
      c.data.entityId = target;
      e.components.push(c);
      doc.entities.push(e);
    }
  },
});
const next = structuredClone(revision);
next.revisionId = crypto.randomUUID();
next.document.entities = next.document.entities.filter(
  (e) => e.id !== child.id,
);
next.document.entities[0].name = "Renamed";
const plan = planPrefabUpdate(session.document, [created.instance.id], next);
assert.equal(plan.impactedReferences.length, 2);
assert.equal(plan.ready, false);
assert.equal(plan.conflicts.length, 0);
assert.ok(plan.changes.some((c) => c.kind === "removed"));
assert.ok(plan.changes.some((c) => c.kind === "renamed"));
const unchanged = session.document;
assert.throws(() => session.execute(applyPrefabUpdatePlan(plan)));
assert.deepEqual(session.document, unchanged);
const retained = planPrefabUpdate(
  session.document,
  [created.instance.id],
  next,
  {},
  [{ kind: "entity", fromId: target, retain: true }],
);
assert.deepEqual(retained.validationErrors, []);
session.execute(applyPrefabUpdatePlan(retained));
assert.ok(session.document.entities.some((e) => e.id === target));
session.undo();
assert.deepEqual(session.document, unchanged);
session.redo();
session.undo();
const redirected = planPrefabUpdate(
  session.document,
  [created.instance.id],
  next,
  {},
  [{ kind: "entity", fromId: target, toId: rootTarget }],
);
assert.equal(redirected.ready, true);
session.execute(applyPrefabUpdatePlan(redirected));
assert.ok(!session.document.entities.some((e) => e.id === target));
assert.equal(
  documentReferences(session.document).filter(
    (e) => e.componentType === "studio.annotation.Label" && e.id === rootTarget,
  ).length,
  2,
);
session.undo();
const stale = planPrefabUpdate(
  session.document,
  [created.instance.id],
  next,
  {},
  [{ kind: "entity", fromId: target, retain: true }],
);
session.execute({
  label: "Change after preview",
  mutate(doc) {
    doc.name = "Changed";
  },
});
assert.throws(() => session.execute(applyPrefabUpdatePlan(stale)), /重新生成/);
assert.ok(
  documentReferences(session.document).every(
    (e) => !e.path.includes("/prefabs/"),
  ),
);
pass(
  "Prefab full-tree deletion/rename plan, path-aware external impacts, explicit retain/redirect, stale-plan rejection and atomic undo/redo",
);
const camera = new CameraOwnership();
let cancelled = 0;
const storyLease = camera.acquire("story", "storyboard", () => cancelled++);
assert.equal(
  camera.acquire("config", "configuration", () => {}),
  0,
);
assert.equal(camera.isCurrent(storyLease), true);
const manual = camera.acquire("manual", "manual", () => cancelled++);
assert.equal(cancelled, 1);
camera.release(storyLease);
assert.equal(camera.isCurrent(manual), true);
camera.release(manual);
assert.equal(camera.owner, "navigation");
const same = camera.acquire("story", "storyboard", () => cancelled++),
  renew = camera.acquire("story", "storyboard", () => {});
assert.notEqual(same, renew);
camera.release(same);
assert.equal(camera.isCurrent(renew), true);
camera.reset();
pass(
  "Camera priority admission, manual preemption, stale async lease and no cancelled-owner resurrection",
);
const material = new THREE.MeshStandardMaterial(),
  mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
let retainedResources = 0;
const visual = new VisualStateSystem({
  generation: 1,
  getObject: (id: string) => (id === "part" ? mesh : undefined),
  engine: {
    renderer: { localClippingEnabled: false },
    resourceRegistry: {
      retain: () => retainedResources++,
      release: (m: THREE.Material) => {
        retainedResources--;
        m.dispose();
      },
    },
    requestRender: () => {},
  },
  spatial: { invalidate: () => {} },
} as never);
visual.setScope(
  "a",
  [
    {
      targetId: "part",
      channel: "clipping",
      composition: "and",
      value: [new THREE.Plane(new THREE.Vector3(1, 0, 0), 0)],
    },
  ],
  "review",
);
visual.setScope(
  "b",
  [
    {
      targetId: "part",
      channel: "clipping",
      composition: "and",
      value: [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)],
    },
  ],
  "review",
);
assert.equal(mesh.material.clippingPlanes?.length, 2);
assert.equal(visual.pointVisible(new THREE.Vector3(-1, 1, 0), mesh), false);
assert.equal(visual.pointVisible(new THREE.Vector3(1, -1, 0), mesh), false);
assert.equal(visual.pointVisible(new THREE.Vector3(1, 1, 0), mesh), true);
visual.setScope(
  "c",
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
visual.setScope(
  "d",
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
assert.equal(mesh.material.opacity, 0.3);
assert.equal(mesh.material.clippingPlanes?.length, 2);
assert.throws(() =>
  visual.setScope(
    "invalid",
    [
      {
        targetId: "part",
        channel: "color",
        composition: "replace",
        value: "white",
      },
    ],
    "assembly",
  ),
);
visual.reset();
assert.equal(mesh.material, material);
assert.equal(retainedResources, 0);
mesh.geometry.dispose();
material.dispose();
pass(
  "Channel-role contract, combined clipping rendering/picking, independent color/opacity and resource ownership",
);
const option = (id: string) => ({
  id,
  name: id,
  sku: id,
  color: "",
  imageAssetId: "",
  description: "",
  bom: [],
  visuals: [],
});
const catalog: ProductCatalog = {
  catalogId: "test",
  revision: "r1",
  name: "Rules",
  market: "CN",
  priceSource: "inquiry",
  priceCurrency: "CNY",
  groups: ["a", "b", "c"].map((id) => ({
    id,
    name: id,
    control: "checkbox",
    min: 0,
    max: 3,
    defaultIds: [],
    options: [option("x"), option("y")],
  })),
  rules: [],
};
const rule = (
  id: string,
  from: string,
  to: string,
  type = "require",
  priority = 0,
): ConfigRule => ({
  id,
  type,
  when: { groupId: from, optionId: "x" },
  then: { groupId: to, optionId: "x" },
  priority,
  minimum: 0,
  maximum: 3,
  reason: id,
});
catalog.rules = [rule("ab", "a", "b"), rule("ba", "b", "a")];
assert.deepEqual(compileRuleGraph(catalog).diagnostics, []);
assert.deepEqual(resolveConfiguration(catalog, { a: ["x"] }).selections.b, [
  "x",
]);
catalog.rules = [
  rule("ab", "a", "b"),
  rule("bc", "b", "c"),
  rule("no-c", "a", "c", "exclude"),
];
const contradiction = compileRuleGraph(catalog).diagnostics.find(
  (d) =>
    d.code === "unreachable-option" &&
    d.optionKeys.some((k) => k.includes('"a"')),
);
assert.ok(contradiction);
assert.deepEqual(new Set(contradiction.ruleIds), new Set(["ab", "bc", "no-c"]));
assert.ok(resolveConfiguration(catalog, { a: ["x"] }).errors.length > 0);
catalog.rules = [
  rule("yes", "a", "b", "require", 10),
  rule("no", "a", "b", "exclude", 1),
];
assert.equal(compileRuleGraph(catalog).diagnostics.length, 0);
assert.deepEqual(resolveConfiguration(catalog, { a: ["x"] }).selections.b, [
  "x",
]);
catalog.rules = [
  {
    ...rule("conditional", "a", "b"),
    conditions: [
      { groupId: "c", operator: "selected", optionId: "y", value: 0 },
    ],
  },
];
assert.deepEqual(
  resolveConfiguration(catalog, { a: ["x"], c: [] }).selections.b,
  [],
);
assert.deepEqual(
  resolveConfiguration(catalog, { a: ["x"], c: ["y"] }).selections.b,
  ["x"],
);
pass(
  "Rule IR positive cycles, shortest contradiction reasons, deterministic priority and conditional truth evaluation",
);
assert.equal(releaseReadiness(createDocument()).ready, true);
const parentDoc = createDocument("Parent"),
  parentRoot = createEntity("Parent root");
parentDoc.entities.push(parentRoot);
const inner = instantiatePrefab(revision);
inner.instance.parentId = parentRoot.id;
const parentSession = new EditorSession(parentDoc);
parentSession.execute(inner.command);
const parentRevision = createPrefabRevision(
    parentSession.document,
    parentRoot.id,
    "Parent template",
  ),
  nestedSession = new EditorSession(createDocument()),
  outer = instantiatePrefab(parentRevision);
nestedSession.execute(outer.command);
const innerGlobal =
  outer.instance.bindings.entity[inner.instance.bindings.entity[child.id]];
nestedSession.execute({
  label: "Nested local edit",
  mutate(doc) {
    doc.entities.find((e) => e.id === innerGlobal)!.name = "Nested override";
  },
});
const sourceLevels = prefabSourcePath(nestedSession.document, innerGlobal);
assert.equal(sourceLevels.length, 2);
const appliedChild = revisionFromInstance(
  sourceLevels[1].document,
  sourceLevels[1].instance,
  "Child source",
);
assert.equal(appliedChild.id, revision.id);
assert.equal(
  appliedChild.document.entities.find((e) => e.id === child.id)!.name,
  "Nested override",
);
assert.equal(
  nestedSession.document.prefabs![0].source.prefabs![0].revisionId,
  revision.revisionId,
);
pass(
  "Nested Apply resolves explicit source ancestors and captures child edits without changing parent revision pins",
);
const graph = emptyProject();
graph.nodes = Array.from({ length: 100 }, (_, i) => newTourNode("Node " + i));
graph.entryNodeId = graph.nodes[0].id;
graph.locales = ["zh-CN", "en"];
graph.links = Array.from({ length: 300 }, (_, i) => ({
  id: "edge" + i,
  fromNodeId: graph.nodes[i % 100].id,
  toNodeId: graph.nodes[(i + 1 + Math.floor(i / 100)) % 100].id,
  transition: "fade",
  reverseLinkId: "",
}));
ensureDiagram(graph).positions = graph.nodes.map((node, i) => ({
  nodeId: node.id,
  x: (i % 10) * 200,
  y: Math.floor(i / 10) * 130,
}));
ensureDiagram(graph).groups = [
  {
    id: "cluster",
    name: "Group",
    nodeIds: graph.nodes.slice(0, 10).map((n) => n.id),
  },
];
assert.deepEqual(validateProject(graph), []);
assert.throws(
  () => removeProjectNodes(graph, new Set([graph.entryNodeId])),
  /仍被引用/,
);
const floor = calibrateFloor(
  {
    id: "f",
    name: "Floor",
    assetId: "image",
    north: 15,
    mmPerPixel: 1,
    calibrated: false,
    rotation: 30,
    originX: 0.3,
    originY: 0.7,
  },
  [0, 0],
  [1, 0],
  10000,
  1000,
  500,
);
assert.equal(floor.mmPerPixel, 10);
for (let i = 0; i < 1000; i++) {
  const x = ((i * 13) % 1000) / 1000,
    y = ((i * 37) % 1000) / 1000,
    world = floorToWorld(floor, x, y),
    image = worldToFloor(floor, ...world);
  assert.ok(Math.abs(image[0] - x) < 1e-10 && Math.abs(image[1] - y) < 1e-10);
}
assert.throws(() => calibrateFloor(floor, [0, 0], [0, 0], 1000, 1000, 500));
const project: ProjectManifest = {
  projectId: "project",
  versionId: "version",
  graphVersionId: "graph",
  document: graph,
  sceneVersions: {},
  assets: [],
  publishedAt: "",
  runtimeBuild: "2.3.0",
};
const location = readProjectLocation(
  new URL(
    "https://studio.test/player/?project=project&version=version&node=" +
      graph.nodes[1].id +
      "&yaw=42&pitch=-12&fov=70&locale=en",
  ),
  project,
);
const shared = projectLocationUrl(
  new URL("https://studio.test/player/"),
  location,
);
assert.deepEqual(readProjectLocation(shared, project), location);
const pose = locationPose(location, {
    position: [1, 2, 3],
    target: [1, 2, -10],
    fov: 60,
  }),
  angles = directionAngles(
    pose.target.map((v, i) => v - pose.position[i]) as [number, number, number],
  );
assert.ok(
  Math.abs(angles.yaw - 42) < 1e-10 && Math.abs(angles.pitch + 12) < 1e-10,
);
for (const query of [
  "yaw=NaN",
  "pitch=91",
  "fov=0",
  "node=foreign",
  "version=other",
  "locale=unknown",
  "hotspot=foreign",
  "yaw=1&yaw=2",
  "position=0,,0&target=0,0,-1",
])
  assert.throws(() =>
    readProjectLocation(
      new URL("https://studio.test/player/?project=project&" + query),
      project,
    ),
  );
pass(
  "100-node/300-edge authored graph, reference-aware deletion, 1000 floor coordinate round trips and strictly pinned deep links",
);
const story: Storyboard = {
  name: "Seek index",
  duration: 200,
  fps: "30",
  loop: true,
  tracks: Array.from({ length: 100 }, (_, track) => ({
    id: "track" + track,
    name: "Track " + track,
    channel: "transform",
    targetId: "target" + track,
    contentId: "",
    muted: false,
    locked: false,
    priority: 0,
    clips: Array.from({ length: 100 }, (_, index) => {
      const clip = newClip(index * 2);
      clip.toTransform.position = [100, 200, 300];
      clip.path = [[20, 100, 30]];
      return clip;
    }),
  })),
  snapshots: [],
  markers: [{ id: "m", name: "Marker", time: 10 }],
};
assert.deepEqual(validateStory(story), []);
freeze(story, true);
const compiled = compileStoryboard(story);
assert.equal(compileStoryboard(story), compiled);
const samples: number[] = [];
for (let i = 0; i < 520; i++) {
  const time = ((i * 157) % 2000) / 10,
    start = performance.now(),
    actual = evaluateStoryboard(story, time, compiled);
  if (i >= 20) samples.push(performance.now() - start);
  assert.equal(actual.length, 100);
  assert.deepEqual(evaluateStoryboard(story, time, compiled), actual);
}
for (let repeat = 0; repeat < 50; repeat++)
  for (const time of [0, 199.99, 0, 100, 50, 199.99])
    assert.deepEqual(
      evaluateStoryboard(story, time, compiled),
      evaluateStoryboard(story, time, compiled),
    );
const seekP95 = samples.sort((a, b) => a - b)[
  Math.floor(samples.length * 0.95)
];
assert.ok(
  seekP95 <= 8,
  "Synthetic Node CPU seek P95 " + seekP95 + " ms exceeds 8 ms",
);
const edited = structuredClone(story),
  firstClip = edited.tracks[0].clips[0];
firstClip.keyframes = [
  {
    id: "key",
    time: 0.5,
    transform: {
      position: [40, 50, 60],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
    camera: firstClip.fromCamera,
    value: 7,
    easing: "linear",
  },
];
firstClip.path = [];
assert.deepEqual(
  evaluateStoryboard(edited, 1)[0].transform.position,
  [40, 50, 60],
);
const beforeSplit = evaluateStoryboard(edited, 1.5)[0].transform;
const split = structuredClone(firstClip);
split.id = "split";
split.start = 1;
split.duration = 1;
split.curveStart = 0.5;
firstClip.duration = 1;
firstClip.curveEnd = 0.5;
edited.tracks[0].clips.push(split);
assert.deepEqual(evaluateStoryboard(edited, 1.5)[0].transform, beforeSplit);
const ripple = structuredClone(edited);
rippleStory(ripple, 10, 2);
assert.equal(ripple.markers[0].time, 12);
assert.equal(ripple.duration, 202);
assert.equal(ripple.tracks[0].clips.find((c) => c.start === 12)?.start, 12);
ripple.tracks.push({
  id: "captions",
  name: "Captions",
  channel: "caption",
  targetId: "",
  contentId: "",
  muted: false,
  locked: false,
  priority: 0,
  clips: [{ ...newClip(1), text: "中文字幕" }],
});
assert.match(subtitles(ripple), /00:00:01.000 --> 00:00:03.000\n中文字幕/);
pass(
  "Compiled 100-track × 100-clip pure sampling: 500 random seeks, independent output, repeatable loops, keyframe split invariance, ripple and VTT; synthetic Node CPU P95 " +
    seekP95.toFixed(3) +
    " ms",
);
const close = (actual: number, expected: number) =>
  assert.ok(
    Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)),
    actual + " != " + expected,
  );
for (const unit of unitCatalog.units)
  close(convertUnit(3, unit.id, unit.id), 3);
for (const [from, to, value, expected] of [
  ["m2", "mm2", 1, 1e6],
  ["m³", "L", 1, 1000],
  ["kPa", "Pa", 101.325, 101325],
  ["L/min", "m3/s", 60, 0.001],
  ["degC", "degF", -40, -40],
  ["degF", "degC", 32, 0],
  ["K", "degC", 273.15, 0],
] as const)
  close(convertUnit(value, from, to), expected);
assert.throws(() => convertUnit(1, "m", "m2"));
assert.throws(() => convertUnit(1, "unknown", "unknown"));
for (const bad of [
  " ",
  "0x10",
  "Infinity",
  "NaN",
  "1_000",
  "3,2",
  null,
  true,
  {},
  [],
])
  assert.throws(() => strictNumber(bad));
close(strictNumber(" 1.2e-3 "), 0.0012);
const pressureField: PropertyDefinition = {
  id: "pressure",
  name: "压力",
  dataType: "number",
  unit: "Pa",
  precision: 3,
  required: true,
  sourcePath: "Pressure",
  sourceUnit: "",
  emptyPolicy: "reject",
  defaultValue: "",
};
const semanticRecord: SemanticRecord = {
  id: "device",
  sourceElementId: "external:device",
  name: "Device",
  classId: "device",
  modelRevision: "model-r1",
  links: [],
  properties: {
    Pressure: { value: 101.325, unit: "kPa", source: { original: true } },
    Temperature: { value: 20, unit: "degC" },
    Flow: { value: 60, unit: "L/min" },
  },
};
const mappingFields = [
  pressureField,
  {
    ...pressureField,
    id: "temperature",
    name: "温度",
    sourcePath: "Temperature",
    unit: "K",
  },
  {
    ...pressureField,
    id: "flow",
    name: "流量",
    sourcePath: "Flow",
    unit: "m3/s",
  },
];
const mapped = mapProperties(semanticRecord, mappingFields);
assert.deepEqual(mapped.errors, []);
close((mapped.properties.pressure as { value: number }).value, 101325);
assert.deepEqual((mapped.properties.pressure as { source: unknown }).source, {
  path: "Pressure",
  rawValue: 101.325,
  rawUnit: "kPa",
  modelRevision: "model-r1",
  sourceElementId: "external:device",
  origin: "source",
  upstream: { original: true },
});
const defaultMapped = mapProperties({ ...semanticRecord, properties: {} }, [
  {
    ...pressureField,
    sourceUnit: "kPa",
    emptyPolicy: "default",
    defaultValue: "123",
  },
]);
close((defaultMapped.properties.pressure as { value: number }).value, 123);
assert.ok(
  mapProperties({ ...semanticRecord, properties: { Pressure: " " } }, [
    { ...pressureField, sourceUnit: "Pa" },
  ]).errors.length,
);
assert.equal(
  (semanticRecord.properties.Pressure as { value: number }).value,
  101.325,
);
const classifications: AssetClass[] = [
  {
    id: "base",
    code: "BASE",
    name: "基础设备",
    parentId: "",
    fields: [pressureField],
  },
  {
    id: "device",
    code: "DEVICE",
    name: "设备",
    parentId: "base",
    fields: [{ ...pressureField, unit: "kPa", required: false }],
  },
];
assert.equal(effectiveClassFields(classifications, "device")[0].required, true);
assert.equal(
  classCompleteness(
    { ...semanticRecord, properties: mapped.properties },
    classifications,
  ).complete,
  true,
);
assert.deepEqual(
  classCompleteness({ ...semanticRecord, properties: {} }, classifications)
    .missing,
  ["pressure"],
);
assert.throws(() =>
  effectiveClassFields(
    [{ ...classifications[0], parentId: "device" }, classifications[1]],
    "device",
  ),
);
assert.throws(() =>
  effectiveClassFields(
    [
      classifications[0],
      { ...classifications[1], fields: [{ ...pressureField, unit: "mm" }] },
    ],
    "device",
  ),
);
const system: SemanticSystem = {
  id: "sys",
  name: "System",
  type: "pipe",
  elementIds: ["a", "b"],
  ports: [
    {
      id: "p1",
      name: "Source",
      elementId: "a",
      direction: "out",
      type: "fluid",
      systemId: "sys",
    },
    {
      id: "p2",
      name: "Sink",
      elementId: "b",
      direction: "in",
      type: "fluid",
      systemId: "sys",
    },
  ],
  connections: [
    {
      id: "c",
      fromPortId: "p1",
      toPortId: "p2",
      kind: "feeds",
      direction: "forward",
    },
  ],
};
assert.deepEqual(systemTopology(system).errors, []);
assert.ok(
  systemTopology({
    ...system,
    connections: [
      { ...system.connections[0], fromPortId: "p2", toPortId: "p1" },
    ],
  }).errors.length,
);
pass(
  "Shared dimensioned SI/IFC units, affine temperatures, strict numbers, original-value provenance, inherited completeness and typed port topology",
);
if (!process.argv.includes("--pure")) {
  const config = JSON.parse(await readFile(".local/config.json", "utf8")),
    base = process.env.STUDIO_API ?? "http://127.0.0.1:18080";
  let token = "";
  async function api(
    path: string,
    method = "GET",
    body?: unknown,
    status = 200,
  ) {
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
  const draft = await api("/projects", "POST", {
    name: "Studio 2.3 readiness",
    document: createDocument(),
  });
  const report = await api("/scenes/" + draft.sceneId + "/readiness");
  assert.equal(report.ready, true);
  assert.equal(
    report.checks.find((c: { code: string }) => c.code === "hardware").status,
    "unverified",
  );
  const strict: SceneDocument = structuredClone(draft.document);
  strict.settings.releasePolicy = { budget: "required", hardware: "required" };
  const required = await api(
    "/scenes/" + draft.sceneId + "/readiness",
    "POST",
    { expectedRevision: draft.revision, document: strict },
  );
  assert.equal(required.ready, false);
  assert.ok(required.errorCount >= 2);
  assert.deepEqual(
    (await api("/scenes/" + draft.sceneId + "/draft")).document,
    draft.document,
  );
  await api(
    "/scenes/" + draft.sceneId + "/readiness",
    "POST",
    { expectedRevision: draft.revision + 1, document: strict },
    409,
  );
  const flattened = structuredClone(session.document);
  delete flattened.prefabs;
  const persisted = await api("/projects", "POST", {
    name: "Reference parity",
    document: flattened,
  });
  const native = await api("/scenes/" + persisted.sceneId + "/references");
  assert.deepEqual(
    native.sort((a: { path: string }, b: { path: string }) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    ),
    documentReferences(persisted.document),
  );
  pass(
    "Native readiness advisory/required policy, unsaved read-only preflight, CAS rejection and reference-path parity",
  );
}
await mkdir(".local/acceptance/studio-2.3", { recursive: true });
await writeFile(
  ".local/acceptance/studio-2.3/s1-contracts.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      native: !process.argv.includes("--pure"),
      evidence,
    },
    null,
    2,
  ),
);
