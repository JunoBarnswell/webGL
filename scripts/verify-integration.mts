import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import * as THREE from "three";
import { zipSync } from "fflate";
import {
  createComponent,
  createDocument,
  createEntity,
  createMaterial,
  declareExtension,
  type SceneDocument,
} from "@studio/scene-schema";
const config = JSON.parse(
  await readFile(new URL("../.local/config.json", import.meta.url), "utf8"),
);
const base = process.env.STUDIO_API ?? "http://127.0.0.1:18080";
let token = "";
async function api(
  path: string,
  method = "GET",
  body?: unknown,
  expected = 200,
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
    expected,
    path + " " + (await response.clone().text()),
  );
  return expected === 204 ? undefined : response.json();
}
const evidence: string[] = [];
const pass = (name: string) => {
  evidence.push(name);
  console.log("Pass: " + name);
};
assert.equal((await fetch(base + "/api/projects")).status, 401);
assert.equal((await fetch(base + "/api/player/absent/manifest")).status, 404);
token = (
  await api("/auth/login", "POST", {
    username: config.adminUser,
    password: config.adminPassword,
  })
).token;
pass("JWT authentication and anonymous boundary");
await api("/health");
pass("native API and MySQL query");
const geometry = new THREE.BoxGeometry(1000, 1000, 1000);
const content = new TextEncoder().encode(JSON.stringify(geometry.toJSON()));
geometry.dispose();
const bundle = zipSync({ "box.geometry.json": content }, { level: 0 });
const upload = await fetch(
  base +
    "/api/assets?" +
    new URLSearchParams({
      name: "验收几何体",
      kind: "mesh",
      entry: "box.geometry.json",
    }),
  {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/zip",
    },
    body: bundle,
  },
);
assert.equal(upload.status, 200, await upload.clone().text());
const asset = await upload.json();
const retrieved = await fetch(
  base + "/api/assets/" + asset.id + "/files/box.geometry.json",
  { headers: { Authorization: "Bearer " + token } },
);
assert.deepEqual(new Uint8Array(await retrieved.arrayBuffer()), content);
pass(
  "real MinIO upload, confirmation, SHA-256 identity and byte-exact download",
);
const document = createDocument("Native integration");
document.assets.push(asset);
const entity = createEntity("验收方块"),
  mesh = createComponent("Mesh"),
  material = createMaterial("验收材质");
mesh.data.assetId = asset.id;
mesh.data.materialId = material.id;
entity.components.push(mesh);
entity.components.push(createComponent("studio.sample.Pulse"));
declareExtension(document, "studio.sample.Pulse");
document.entities.push(entity);
document.materials.push(material);
let draft = await api("/projects", "POST", { name: document.name, document });
const projectIds = [draft.projectId];
const sceneId = draft.sceneId;
try {
  const modified = structuredClone(draft.document) as SceneDocument;
  modified.name = "并发修改";
  const responses = await Promise.all(
    [1, 2].map(() =>
      fetch(base + "/api/scenes/" + sceneId + "/draft", {
        method: "PUT",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expectedRevision: 0, document: modified }),
      }),
    ),
  );
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  draft = await api("/scenes/" + sceneId + "/draft");
  assert.equal(draft.revision, 1);
  pass("concurrent CAS: exactly one commit, one 409");
  const bad = structuredClone(draft.document);
  bad.entities[0].transform.scale[0] = 0;
  await api(
    "/scenes/" + sceneId + "/draft",
    "PUT",
    { expectedRevision: 1, document: bad },
    422,
  );
  assert.equal((await api("/scenes/" + sceneId + "/draft")).revision, 1);
  pass("failed contract leaves draft and transaction unchanged");
  const version = await api("/scenes/" + sceneId + "/versions", "POST", {
    expectedRevision: 1,
  });
  const newer = structuredClone(draft.document);
  newer.name = "newer";
  draft = await api("/scenes/" + sceneId + "/draft", "PUT", {
    expectedRevision: 1,
    document: newer,
  });
  draft = await api(
    "/scenes/" + sceneId + "/versions/" + version.id + "/restore",
    "POST",
    { expectedRevision: 2 },
  );
  assert.equal(draft.revision, 3);
  assert.equal(draft.document.name, "并发修改");
  pass("immutable snapshot and restore creates a new revision");
  const publication = await api("/scenes/" + sceneId + "/publish", "POST", {
    expectedRevision: draft.revision,
  });
  let publicManifest = await (
    await fetch(base + "/api/player/" + sceneId + "/manifest")
  ).json();
  assert.equal(publicManifest.versionId, publication.versionId);
  const publicPath =
    "/api/player/" +
    sceneId +
    "/versions/" +
    publication.versionId +
    "/assets/" +
    asset.id +
    "/files/box.geometry.json";
  assert.equal((await fetch(base + publicPath)).status, 200);
  pass("publication manifest and public version-scoped asset access");
  const missing = structuredClone(draft.document);
  missing.assets.push({
    ...asset,
    id: "missing-" + "1".repeat(64),
    sha256: "1".repeat(64),
  });
  draft = await api("/scenes/" + sceneId + "/draft", "PUT", {
    expectedRevision: draft.revision,
    document: missing,
  });
  await api(
    "/scenes/" + sceneId + "/publish",
    "POST",
    { expectedRevision: draft.revision },
    422,
  );
  publicManifest = await (
    await fetch(base + "/api/player/" + sceneId + "/manifest")
  ).json();
  assert.equal(publicManifest.versionId, publication.versionId);
  pass("missing dependency blocks publication and retains old pointer");
  draft = await api("/scenes/" + sceneId + "/draft", "PUT", {
    expectedRevision: draft.revision,
    document: { ...draft.document, assets: [asset] },
  });
  if (process.env.STUDIO_FAULTS === "1") {
    if (process.platform === "win32")
      execFileSync(
        "powershell.exe",
        ["-NoProfile", "-File", "scripts/minio-local.ps1", "-Action", "stop"],
        { stdio: "ignore" },
      );
    else
      execFileSync("docker", ["stop", "webgl-studio-minio"], {
        stdio: "ignore",
      });
    try {
      await api(
        "/scenes/" + sceneId + "/publish",
        "POST",
        { expectedRevision: draft.revision },
        503,
      );
      const previous = await (
        await fetch(base + "/api/player/" + sceneId + "/manifest")
      ).json();
      assert.equal(previous.versionId, publication.versionId);
      pass("MinIO interruption retains previous publication");
    } finally {
      if (process.platform === "win32")
        execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-File",
            "scripts/minio-local.ps1",
            "-Action",
            "start",
          ],
          { stdio: "ignore" },
        );
      else
        execFileSync("docker", ["start", "webgl-studio-minio"], {
          stdio: "ignore",
        });
    }
    for (let i = 0; i < 30; i++) {
      try {
        if ((await fetch("http://127.0.0.1:19000/minio/health/live")).ok) break;
      } catch {
        /* MinIO is still starting. */
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  await api("/assets/" + asset.id, "DELETE", undefined, 409);
  pass("referenced asset deletion is rejected");
  const exported = await fetch(
    base + "/api/projects/" + draft.projectId + "/export",
    { headers: { Authorization: "Bearer " + token } },
  );
  assert.equal(exported.status, 200);
  const bytes = new Uint8Array(await exported.arrayBuffer());
  const imported = await fetch(base + "/api/projects/import", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/zip",
    },
    body: bytes,
  });
  assert.equal(imported.status, 200, await imported.clone().text());
  const copy = await imported.json();
  projectIds.push(copy.projectId);
  assert.equal(copy.document.assets[0].sha256, asset.sha256);
  assert.notEqual(copy.sceneId, sceneId);
  assert.deepEqual(
    copy.document.entities[0].components.find(
      (c: { type: string }) => c.type === "studio.sample.Pulse",
    ),
    entity.components.find((c) => c.type === "studio.sample.Pulse"),
  );
  pass("portable project export/import preserves asset identities");
  await api("/scenes/" + sceneId + "/publish", "DELETE", undefined, 204);
  assert.equal(
    (await fetch(base + "/api/player/" + sceneId + "/manifest")).status,
    404,
  );
  assert.equal((await fetch(base + publicPath)).status, 404);
  pass("unpublish revokes public manifests and resource access");
} finally {
  for (const id of projectIds)
    await api("/projects/" + id, "DELETE", undefined, 204);
}
await api("/assets/" + asset.id, "DELETE", undefined, 204);
pass("references release after project deletion");
await mkdir(new URL("../.local/acceptance", import.meta.url), {
  recursive: true,
});
await writeFile(
  new URL("../.local/acceptance/integration.json", import.meta.url),
  JSON.stringify(
    {
      status: "Pass",
      evidence,
      at: new Date().toISOString(),
      faults: process.env.STUDIO_FAULTS === "1",
    },
    null,
    2,
  ),
);
