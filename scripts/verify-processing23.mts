import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { Document, NodeIO } from "@gltf-transform/core";
import { zipSync } from "fflate";
import {
  createDocument,
  createEntity,
  createComponent,
} from "@studio/scene-schema";
import {
  modelSnapshot,
  compareModelSnapshots,
  modelMetrics,
  evaluateBudget,
} from "../workers/model-analysis.mjs";
const document = new Document(),
  buffer = document.createBuffer(),
  positions = document
    .createAccessor()
    .setType("VEC3")
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buffer),
  material = document.createMaterial().setBaseColorFactor([0.2, 0.3, 0.4, 1]),
  mesh = document
    .createMesh()
    .addPrimitive(
      document
        .createPrimitive()
        .setAttribute("POSITION", positions)
        .setMaterial(material),
    );
document
  .createScene()
  .addChild(
    document
      .createNode("Owned budget fixture")
      .setExtras({ sourceElementId: "budget-23" })
      .setTranslation([2, 3, 4])
      .setMesh(mesh),
  );
const baseline = modelSnapshot(document);
assert.deepEqual(
  compareModelSnapshots(baseline, modelSnapshot(document)).errors,
  [],
);
document.getRoot().listNodes()[0].setTranslation([9, 3, 4]);
assert.ok(
  compareModelSnapshots(baseline, modelSnapshot(document)).errors.includes(
    "Model contract changed: nodes",
  ),
);
document.getRoot().listNodes()[0].setTranslation([2, 3, 4]);
material.setRoughnessFactor(0.4);
assert.ok(
  compareModelSnapshots(baseline, modelSnapshot(document)).errors.includes(
    "Model contract changed: materials",
  ),
);
material.setRoughnessFactor(1);
const metrics = { ...modelMetrics(document), bytes: 100 };
assert.equal(evaluateBudget(metrics, { maxTriangles: 0 }).status, "unmet");
assert.equal(
  evaluateBudget(metrics, { maxTriangles: 1, maxEncodedBytes: 100 }).status,
  "met",
);
assert.equal(
  evaluateBudget(
    { ...metrics, estimatedGpuTextureBytes: null },
    { maxGpuTextureBytes: 100 },
  ).status,
  "unmet",
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
    return status === 204 ? null : response.json();
  }
  token = (
    await api("/auth/login", "POST", {
      username: config.adminUser,
      password: config.adminPassword,
    })
  ).token;
  const bytes = await new NodeIO().writeBinary(document),
    response = await fetch(
      base +
        "/api/assets?" +
        new URLSearchParams({
          name: "Studio23 budget fixture",
          kind: "model",
          entry: "model.glb",
        }),
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/zip",
        },
        body: zipSync({ "model.glb": bytes }) as never,
      },
    );
  assert.equal(response.status, 200);
  const asset = await response.json();
  async function job(maxTriangles: number, ids = ["external:budget-23"]) {
    let current = await api("/jobs", "POST", {
      sourceAssetId: asset.id,
      operation: "optimize",
      settings: {
        useMeshopt: true,
        textureCodec: "retain",
        preserveSemantics: true,
        protectedSourceIds: ids,
        budget: {
          maxTriangles,
          maxGpuTextureBytes: 1024,
          maxEncodedBytes: 100000,
        },
      },
    });
    for (
      let n = 0;
      n < 120 && ["Queued", "Running"].includes(current.status);
      n++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      current = await api("/jobs/" + current.id);
    }
    return current;
  }
  const unmet = await job(0);
  assert.equal(unmet.status, "UnmetBudget", JSON.stringify(unmet));
  assert.equal(JSON.parse(unmet.resultJson).report.budget.status, "unmet");
  const authored = createDocument("Budget admission fixture");
  authored.assets.push(asset);
  const model = createEntity("Budget model"),
    component = createComponent("Model");
  component.data.assetId = asset.id;
  model.components.push(component);
  authored.entities.push(model);
  authored.settings.processingReports = [
    { assetId: asset.id, jobId: unmet.id },
  ];
  const draft = await api("/projects", "POST", {
    name: authored.name,
    document: authored,
  });
  let readiness = await api("/scenes/" + draft.sceneId + "/readiness");
  assert.ok(
    readiness.checks.some(
      (check: { code: string; status: string }) =>
        check.code === "budget" && check.status === "fail",
    ),
  );
  await api(
    "/scenes/" + draft.sceneId + "/publish",
    "POST",
    { expectedRevision: draft.revision },
    422,
  );
  const met = await job(1);
  assert.equal(met.status, "Succeeded", JSON.stringify(met));
  assert.notEqual(met.settingsHash, unmet.settingsHash);
  assert.ok(met.leaseEpoch >= 1);
  assert.equal(met.ownerId, "");
  assert.equal(met.leaseUntil ?? null, null);
  assert.deepEqual(JSON.parse(met.resultJson).report.modelDiff.errors, []);
  const cached = await job(1, ["external:budget-23", "external:budget-23"]);
  assert.equal(cached.id, met.id);
  authored.sceneId = draft.sceneId;
  authored.settings.processingReports = [{ assetId: asset.id, jobId: met.id }];
  readiness = await api("/scenes/" + draft.sceneId + "/readiness", "POST", {
    expectedRevision: draft.revision,
    document: authored,
  });
  assert.ok(
    readiness.checks.some(
      (check: { code: string; status: string }) =>
        check.code === "budget" && check.status === "pass",
    ),
  );
  await mkdir(".local/acceptance/studio-2.3", { recursive: true });
  await writeFile(
    ".local/acceptance/studio-2.3/processing.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        unmet,
        met,
        canonicalCacheHit: cached.id,
        readiness,
      },
      null,
      2,
    ),
  );
}
console.log(
  "Pass processing budget impossibility, conservative unknown metrics, node/material structural diff" +
    (!process.argv.includes("--pure")
      ? ", real worker/MinIO/MySQL budget admission and canonical cache identity"
      : " (pure helpers only)"),
);
