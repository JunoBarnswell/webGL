import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { zipSync } from "fflate";
import { chromium } from "playwright-core";
import {
  createDocument,
  createEntity,
  createComponent,
  declareExtension,
  type SceneAsset,
} from "@studio/scene-schema";
import { modelEntities } from "@studio/asset-pipeline";
const api = process.env.STUDIO_API ?? "http://127.0.0.1:18080",
  editor = process.env.STUDIO_EDITOR ?? "http://127.0.0.1:5173";
const config = JSON.parse(await readFile(".local/config.json", "utf8"));
const { token } = await (
  await fetch(api + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: config.adminUser,
      password: config.adminPassword,
    }),
  })
).json();
const headers = { Authorization: "Bearer " + token };
const data = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
const assets: SceneAsset[] = [];
let projectId = "";
const browser = await chromium.launch({
  executablePath: process.env.STUDIO_CHROMIUM ?? "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
});
try {
  for (const variant of ["A", "B"]) {
    const gltf = {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [
        {
          name: "Source root",
          children: [1, 2],
          extras: { ElementId: "root" },
        },
        { name: "Part A", mesh: 0, extras: { ElementId: "A" } },
        {
          name: variant === "A" ? "Removed B" : "New C",
          mesh: 0,
          translation: [3, 0, 0],
          extras: { ElementId: variant === "A" ? "B" : "C" },
        },
      ],
      buffers: [
        {
          uri:
            "data:application/octet-stream;base64," +
            Buffer.from(data.buffer).toString("base64"),
          byteLength: data.byteLength,
        },
      ],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: data.byteLength }],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: "VEC3",
          min: [-1, -1, 0],
          max: [1, 1, 0],
        },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    };
    const response = await fetch(
      api +
        "/api/assets?" +
        new URLSearchParams({
          name: "Model revision " + variant,
          kind: "model",
          entry: "model.gltf",
        }),
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/zip" },
        body: zipSync({
          "model.gltf": new TextEncoder().encode(JSON.stringify(gltf)),
        }),
      },
    );
    assert.equal(response.status, 200);
    assets.push(await response.json());
  }
  const doc = createDocument("Model revision browser fixture");
  doc.assets.push(...assets);
  doc.settings.position = [3000, 2500, 6000];
  doc.settings.target = [1500, 0, 0];
  doc.settings.collision = false;
  const nodes = modelEntities(
    assets[0],
    {
      nodes: [
        {
          name: "Source root",
          children: [1, 2],
          extras: { ElementId: "root" },
        },
        { name: "Part A", mesh: 0, extras: { ElementId: "A" } },
        {
          name: "Removed B",
          mesh: 0,
          translation: [3, 0, 0],
          extras: { ElementId: "B" },
        },
      ],
      roots: [0],
      animations: [],
    },
    null,
  );
  doc.entities.push(...nodes);
  const label = createEntity("Repairable label"),
    annotation = createComponent("studio.annotation.Label");
  Object.assign(annotation.data, {
    anchorKind: "surface",
    entityId: nodes[2].id,
    sourceElementId: "external:A",
    meshRevision: assets[0].sha256,
    triangleIndex: 0,
    barycentric: [0.2, 0.3, 0.5],
    offset: [80, -40, 0],
  });
  label.components.push(annotation);
  doc.entities.push(label);
  declareExtension(doc, annotation.type);
  const created = await fetch(api + "/api/projects", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name: doc.name, document: doc }),
  });
  assert.equal(created.status, 200, await created.clone().text());
  const draft = await created.json();
  projectId = draft.projectId;
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push("console: " + message.text());
  });
  await page.addInitScript(
    ({ token, scene }) => {
      sessionStorage.setItem("studio-token", token);
      localStorage.setItem("studio-last-scene", scene);
      localStorage.removeItem("studio-preferences-v2");
    },
    { token, scene: draft.sceneId },
  );
  await page.goto(editor + "/editor/");
  await page
    .locator('.viewport-panel[data-load-phase="ready"]')
    .waitFor({ timeout: 90000 });
  await page.evaluate(async (modelId) => {
    const source = await (await fetch("/editor/src/App.tsx")).text();
    const modulePath = source.match(
      /from\s*["']([^"']*state\/studio\.ts[^"']*)["']/,
    )?.[1];
    if (!modulePath) throw Error("State module missing");
    const { useStudio } = await import(/* @vite-ignore */ modulePath);
    useStudio.getState().select([modelId]);
  }, nodes[0].id);
  await page.getByRole("button", { name: "资源库", exact: true }).click();
  await page
    .locator(".asset")
    .filter({ has: page.getByTitle("Model revision B", { exact: true }) })
    .getByRole("button", { name: "更新选中模型" })
    .click();
  const dialog = page.getByRole("dialog", { name: "模型版本与身份映射" });
  await dialog.waitFor();
  assert.equal(
    await dialog.getByRole("button", { name: "应用模型更新" }).isDisabled(),
    true,
  );
  await dialog.getByRole("checkbox", { name: /未匹配元素保留/ }).check();
  await dialog.getByRole("button", { name: "应用模型更新" }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByLabel("关闭资源库").click();
  await page.getByLabel("工作台布局").selectOption("standard");
  await page.getByText("扩展工具与任务模板", { exact: true }).click();
  await page.getByText("标注批量编辑与修复", { exact: true }).click();
  await page.getByText("待修复锚点 · 1", { exact: true }).waitFor();
  await page.getByRole("button", { name: "重新选面", exact: true }).click();
  const position = await page.evaluate(async (id) => {
    const source = await (await fetch("/editor/src/App.tsx")).text();
    const modulePath = source.match(
      /from\s*["']([^"']*state\/studio\.ts[^"']*)["']/,
    )?.[1];
    const { useStudio } = await import(/* @vite-ignore */ modulePath!);
    const state = useStudio.getState(),
      runtime = state.runtime;
    const object = runtime.getObject(id);
    object.updateWorldMatrix(true, true);
    const vector = object.position
      .clone()
      .set(0, 0, 0)
      .applyMatrix4(object.matrixWorld)
      .project(runtime.engine.camera);
    const rect = runtime.engine.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + (vector.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-vector.y * 0.5 + 0.5) * rect.height,
    };
  }, nodes[2].id);
  await page.mouse.click(position.x, position.y);
  await page.waitForTimeout(200);
  const evidence = await page.evaluate(
    async ({ partId, removedId, labelId, modelId }) => {
      const source = await (await fetch("/editor/src/App.tsx")).text();
      const modulePath = source.match(
        /from\s*["']([^"']*state\/studio\.ts[^"']*)["']/,
      )?.[1];
      const { useStudio } = await import(/* @vite-ignore */ modulePath!);
      const state = useStudio.getState(),
        doc = state.document;
      return {
        entityIds: doc.entities.map((e: { id: string }) => e.id),
        partId,
        removedStatus: doc.entities
          .find((e: { id: string }) => e.id === removedId)
          .components.find((c: { type: string }) => c.type === "ModelNode").data
          .sourceStatus,
        labelRevision: doc.entities.find(
          (e: { id: string }) => e.id === labelId,
        ).components[0].data.meshRevision,
        modelAsset: doc.entities.find((e: { id: string }) => e.id === modelId)
          .components[0].data.assetId,
        unresolved:
          state.runtime.getSnapshot().extensions["studio.annotation:" + labelId]
            ?.anchorState,
      };
    },
    {
      partId: nodes[2].id,
      removedId: nodes[3].id,
      labelId: label.id,
      modelId: nodes[0].id,
    },
  );
  assert.ok(evidence.entityIds.includes(nodes[2].id));
  assert.equal(evidence.removedStatus, "unresolved");
  assert.equal(evidence.modelAsset, assets[1].id);
  assert.equal(evidence.labelRevision, assets[1].sha256);
  assert.equal(evidence.unresolved, "resolved");
  assert.deepEqual(errors, []);
  await mkdir(".local/acceptance/studio-2", { recursive: true });
  await page.screenshot({
    path: ".local/acceptance/studio-2/model-revision.png",
  });
  await writeFile(
    ".local/acceptance/studio-2/model-revision.json",
    JSON.stringify(
      {
        status: "Pass",
        mappingDialog: true,
        newHierarchyAccepted: true,
        unmatchedPlaceholder: true,
        surfaceReattached: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Pass: actual GLTF revision dialog, stable IDs, new/unmatched elements and viewport surface repair",
  );
} finally {
  await browser.close();
  if (projectId)
    await fetch(api + "/api/projects/" + projectId, {
      method: "DELETE",
      headers,
    });
  for (const asset of assets)
    await fetch(api + "/api/assets/" + asset.id, { method: "DELETE", headers });
}
