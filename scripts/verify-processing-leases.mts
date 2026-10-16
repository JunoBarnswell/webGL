import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { readFile, writeFile, mkdir, open } from "node:fs/promises";
import { zipSync } from "fflate";
import { Document, NodeIO } from "@gltf-transform/core";
const root = process.cwd(),
  directory = root + "/.local/acceptance/studio-2.3/leases";
await mkdir(directory, { recursive: true });
// Fault injection lives outside the product worker: only instance A starts its real worker after a bounded pause.
await writeFile(
  directory + "/slow-node.sh",
  '#!/usr/bin/env bash\nsleep 30\nexec node "$@"\n',
  { mode: 0o700 },
);
const config = JSON.parse(await readFile(".local/config.json", "utf8"));
const children: ChildProcess[] = [];
async function start(port: number, slow = false) {
  const log = await open(directory + "/api-" + port + ".log", "a"),
    child = spawn(
      "bash",
      [
        "-c",
        'source .local/config.sh\nexport STUDIO_URLS="$STUDIO_ACCEPTANCE_URL"\nif [[ -n "$STUDIO_ACCEPTANCE_NODE" ]]; then export STUDIO_NODE="$STUDIO_ACCEPTANCE_NODE"; fi\nexec artifacts/linux/run.sh',
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          STUDIO_ACCEPTANCE_URL: "http://127.0.0.1:" + port,
          STUDIO_ACCEPTANCE_NODE: slow ? directory + "/slow-node.sh" : "",
        },
        detached: true,
        stdio: ["ignore", log.fd, log.fd],
      },
    );
  children.push(child);
  await log.close();
  const base = "http://127.0.0.1:" + port;
  for (let n = 0; n < 100; n++) {
    try {
      const response = await fetch(base + "/api/health");
      if (response.ok) break;
    } catch {
      /* Startup and cleanup can race process exit. */
    }
    if (n === 99) throw Error("API startup timed out: " + port);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const response = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: config.adminUser,
      password: config.adminPassword,
    }),
  });
  assert.equal(response.status, 200);
  const { token } = await response.json();
  return { child, base, token };
}
type Instance = Awaited<ReturnType<typeof start>>;
async function api(
  instance: Instance,
  path: string,
  method = "GET",
  body?: unknown,
) {
  const response = await fetch(instance.base + "/api" + path, {
    method,
    headers: {
      Authorization: "Bearer " + instance.token,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(
    response.status,
    200,
    path + " " + (await response.clone().text()),
  );
  return response.json();
}
async function wait(
  instance: Instance,
  id: string,
  predicate: (
    job: import("../packages/extensions/jobs").ProcessingJob,
  ) => boolean,
) {
  for (let n = 0; n < 240; n++) {
    const job = await api(instance, "/jobs/" + id);
    if (predicate(job)) return job;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw Error("Job did not reach expected state: " + id);
}
function signal(child: ChildProcess, name: NodeJS.Signals) {
  if (child.pid) process.kill(child.pid, name);
}
function killGroup(child: ChildProcess) {
  try {
    if (child.pid) process.kill(-child.pid, "SIGKILL");
  } catch {
    /* Startup and cleanup can race process exit. */
  }
}
try {
  let a = await start(18081, true);
  const gltf = new Document(),
    buffer = gltf.createBuffer(),
    position = gltf
      .createAccessor()
      .setType("VEC3")
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
      .setBuffer(buffer);
  gltf.createScene().addChild(
    gltf
      .createNode("Lease " + crypto.randomUUID())
      .setExtras({ sourceElementId: "lease-fixture" })
      .setMesh(
        gltf
          .createMesh()
          .addPrimitive(
            gltf.createPrimitive().setAttribute("POSITION", position),
          ),
      ),
  );
  const bytes = await new NodeIO().writeBinary(gltf),
    response = await fetch(
      a.base +
        "/api/assets?" +
        new URLSearchParams({
          name: "Lease acceptance",
          kind: "model",
          entry: "model.glb",
        }),
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + a.token,
          "Content-Type": "application/zip",
        },
        body: zipSync({ "model.glb": bytes }) as never,
      },
    );
  assert.equal(response.status, 200);
  const asset = await response.json();
  const first = await api(a, "/jobs", "POST", {
    sourceAssetId: asset.id,
    operation: "optimize",
    settings: {
      useMeshopt: true,
      textureCodec: "retain",
      preserveSemantics: true,
      protectedSourceIds: ["external:lease-fixture"],
      budget: { maxTriangles: 1 },
    },
  });
  const claimed = await wait(a, first.id, (job) => job.status === "Running");
  assert.equal(claimed.leaseEpoch, 1);
  const b = await start(18082);
  assert.equal((await api(b, "/jobs/" + first.id)).ownerId, claimed.ownerId);
  signal(a.child, "SIGKILL");
  const recovered = await wait(
    b,
    first.id,
    (job) => !["Queued", "Running"].includes(job.status),
  );
  assert.equal(recovered.status, "Succeeded", JSON.stringify(recovered));
  assert.equal(recovered.leaseEpoch, 2);
  assert.equal(recovered.attempt, 2);
  signal(b.child, "SIGSTOP");
  a = await start(18081, true);
  const next = await api(a, "/jobs/" + first.id + "/retry", "POST");
  const old = await wait(a, next.id, (job) => job.status === "Running");
  signal(a.child, "SIGSTOP");
  signal(b.child, "SIGCONT");
  const takeover = await wait(
    b,
    next.id,
    (job) => !["Queued", "Running"].includes(job.status),
  );
  assert.equal(takeover.status, "Succeeded", JSON.stringify(takeover));
  assert.equal(takeover.leaseEpoch, 2);
  signal(a.child, "SIGCONT");
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const afterStale = await api(b, "/jobs/" + next.id);
  assert.equal(afterStale.resultJson, takeover.resultJson);
  assert.equal(afterStale.leaseEpoch, 2);
  assert.equal(old.leaseEpoch, 1);
  const sql =
    "SELECT JobId,COUNT(*),COUNT(DISTINCT AssetId) FROM ProcessingOutputs WHERE JobId IN ('" +
    first.id +
    "','" +
    next.id +
    "') GROUP BY JobId";
  const rows = execFileSync(
    "docker",
    [
      "exec",
      "webgl-studio-mysql",
      "sh",
      "-c",
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -D "$MYSQL_DATABASE" --batch --skip-column-names -e "$1"',
      "studio-lease",
      sql,
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .map((line) => line.split("\t"));
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row[1], "2");
    assert.equal(row[2], "2");
  } // model plus semantic output, one row per logical ordinal
  await writeFile(
    directory + "/results.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        faults: [
          "kill -9 owner",
          "SIGSTOP expired owner then SIGCONT stale owner",
        ],
        claimed,
        recovered,
        takeover,
        afterStale,
        outputRows: rows,
        previousResultUnchanged: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "Pass two real Native AOT API instances: live-owner protection, kill -9 recovery, expired-owner fencing and exactly one committed model/semantic output pair per job",
  );
} finally {
  for (const child of children) {
    try {
      signal(child, "SIGCONT");
    } catch {
      /* Startup and cleanup can race process exit. */
    }
    killGroup(child);
  }
}
