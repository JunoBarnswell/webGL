import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as THREE from "three";
import {
  createDocument,
  createEntity,
  createComponent,
  documentReferences,
  releaseReadiness,
  sourceDocument,
  type SceneDocument,
} from "@studio/scene-schema";
import {
  EditorSession,
  createPrefabRevision,
  instantiatePrefab,
  planPrefabUpdate,
  applyPrefabUpdatePlan,
} from "@studio/editor-core";
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
const story = camera.acquire("story", "storyboard", () => cancelled++);
assert.equal(
  camera.acquire("config", "configuration", () => {}),
  0,
);
assert.equal(camera.isCurrent(story), true);
const manual = camera.acquire("manual", "manual", () => cancelled++);
assert.equal(cancelled, 1);
camera.release(story);
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
  const persisted = await api("/projects", "POST", {
    name: "Reference parity",
    document: sourceDocument(session.document),
  });
  const native = await api("/scenes/" + persisted.sceneId + "/references");
  assert.deepEqual(native, documentReferences(persisted.document));
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
