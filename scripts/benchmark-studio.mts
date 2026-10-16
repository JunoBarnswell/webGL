import * as THREE from "three";
import { zipSync } from "fflate";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { cpus, platform, release } from "node:os";
import { chromium } from "playwright-core";
import {
  createDocument,
  createEntity,
  createComponent,
  declareExtension,
} from "@studio/scene-schema";
const api = process.env.STUDIO_API ?? "http://127.0.0.1:18080",
  editor = process.env.STUDIO_EDITOR ?? "http://127.0.0.1:5173",
  baseline = process.env.STUDIO_BASELINE;
const config = JSON.parse(await readFile(".local/config.json", "utf8"));
const login = await fetch(api + "/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    username: config.adminUser,
    password: config.adminPassword,
  }),
});
const token = (await login.json()).token;
const geometry = new THREE.BoxGeometry(50, 50, 50);
const bundle = zipSync({
  "cube.json": new TextEncoder().encode(
    JSON.stringify(new THREE.BufferGeometry().copy(geometry).toJSON()),
  ),
});
geometry.dispose();
const upload = await fetch(
  api +
    "/api/assets?" +
    new URLSearchParams({
      name: "Benchmark cube",
      kind: "mesh",
      entry: "cube.json",
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
assert.equal(upload.status, 200);
const asset = await upload.json();
const browser = await chromium.launch({
  executablePath: process.env.STUDIO_CHROMIUM ?? "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
});
const results: unknown[] = [];
const documents = [
  { name: "empty core", labels: 0, parts: 0, segments: 0 },
  {
    name: "500 labels / 500 parts / 1000 segments",
    labels: 500,
    parts: 500,
    segments: 1000,
  },
  { name: "2000 labels / 2000 parts", labels: 2000, parts: 2000, segments: 0 },
];
try {
  for (const fixture of documents) {
    const doc = createDocument("Benchmark " + fixture.name);
    doc.settings.onDemand = true;
    doc.settings.position = [2500, 1800, 5000];
    doc.settings.target = [0, 0, 0];
    doc.assets.push(asset);
    const root = createEntity("assembly");
    root.components.push(createComponent("studio.assembly.Root"));
    doc.entities.push(root);
    if (fixture.parts) declareExtension(doc, "studio.assembly.Root");
    const lineIds: string[] = [];
    for (let i = 0; i < (fixture.segments ? 100 : 0); i++) {
      const line = createEntity("Line " + i);
      const c = createComponent("studio.piping.Line");
      c.data.lineNo = "LINE-" + i;
      line.components.push(c);
      doc.entities.push(line);
      lineIds.push(line.id);
    }
    if (lineIds.length) declareExtension(doc, "studio.piping.Line");
    for (
      let i = 0;
      i < Math.max(fixture.parts, fixture.segments, fixture.labels);
      i++
    ) {
      const entity = createEntity("Element " + i);
      const mesh = createComponent("Mesh");
      mesh.data.assetId = asset.id;
      entity.components.push(mesh);
      entity.transform.position = [
        ((i % 30) - 15) * 100,
        Math.floor(i / 30) * 20,
        0,
      ];
      if (i < fixture.parts) {
        const c = createComponent("studio.assembly.Part");
        c.data.groupId = root.id;
        entity.components.push(c);
      }
      if (i < fixture.segments) {
        const c = createComponent("studio.piping.Segment");
        c.data.lineId = lineIds[i % lineIds.length];
        entity.components.push(c);
      }
      doc.entities.push(entity);
      if (i < fixture.labels) {
        const label = createEntity("Label " + i);
        const c = createComponent("studio.annotation.Label");
        c.data.entityId = entity.id;
        c.data.label = String(i);
        label.components.push(c);
        doc.entities.push(label);
      }
    }
    if (fixture.labels) declareExtension(doc, "studio.annotation.Label");
    const response = await fetch(api + "/api/projects", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: doc.name, document: doc }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    const draft = await response.json();
    try {
      for (const target of [
        { name: "current", url: editor },
        ...(baseline && fixture.labels === 0
          ? [{ name: "baseline", url: baseline }]
          : []),
      ]) {
        const page = await browser.newPage({
          viewport: { width: 1920, height: 1080 },
          deviceScaleFactor: 1,
        });
        await page.addInitScript(
          ({ token, scene }) => {
            sessionStorage.setItem("studio-token", token);
            localStorage.setItem("studio-last-scene", scene);
            localStorage.setItem(
              "studio-preferences-v2",
              JSON.stringify({ layout: "compact", leftOpen: false }),
            );
          },
          { token, scene: draft.sceneId },
        );
        if (target.name === "baseline")
          await page.route("**/api/scenes/*/draft", async (route) => {
            const response = await route.fetch();
            const data = await response.json();
            delete data.document.documentVersion;
            delete data.document.requiredExtensions;
            data.document.entities = [];
            await route.fulfill({ response, json: data });
          });
        let requests = 0;
        page.on("request", () => requests++);
        const start = performance.now();
        await page.goto(target.url + "/editor/");
        await page
          .locator('.viewport-panel[data-load-phase="ready"]')
          .waitFor({ timeout: 120000 });
        const loadMilliseconds = performance.now() - start;
        await page.getByRole("button", { name: "预览", exact: true }).click();
        const metrics = await page.evaluate(async () => {
          const samples: number[] = [],
            cpu: number[] = [];
          let frames = 0;
          const canvas = document.querySelector("canvas")!;
          const gl = canvas.getContext("webgl2");
          const info = gl?.getExtension("WEBGL_debug_renderer_info");
          const renderer = info
            ? gl?.getParameter(info.UNMASKED_RENDERER_WEBGL)
            : "unavailable";
          let last = performance.now();
          for (let i = 0; i < 180; i++)
            await new Promise<void>((resolve) =>
              requestAnimationFrame((now) => {
                samples.push(now - last);
                last = now;
                const begin = performance.now();
                document
                  .querySelector(".viewport-panel")
                  ?.getBoundingClientRect();
                cpu.push(performance.now() - begin);
                frames++;
                resolve();
              }),
            );
          samples.sort((a, b) => a - b);
          return {
            rafSpacing: {
              p50: samples[Math.floor(samples.length * 0.5)],
              p95: samples[Math.floor(samples.length * 0.95)],
              p99: samples[Math.floor(samples.length * 0.99)],
            },
            frames,
            renderer,
            visibleLabels: document.querySelectorAll(
              ".runtime-hotspot:not([hidden])",
            ).length,
            totalLabels: document.querySelectorAll(".runtime-hotspot").length,
            resources: JSON.parse(
              document
                .querySelector(".viewport-panel")!
                .getAttribute("data-runtime-stats")!,
            ),
            renderInfo: JSON.parse(
              document
                .querySelector(".viewport-panel")!
                .getAttribute("data-render-info") ?? "null",
            ),
            viewportRatio:
              document.querySelector(".viewport-canvas")!.clientWidth /
              innerWidth,
          };
        });
        results.push({
          target: target.name,
          fixture,
          loadMilliseconds,
          requests,
          ...metrics,
        });
        await page.close();
      }
    } finally {
      await fetch(api + "/api/projects/" + draft.projectId, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token },
      });
    }
  }
  await mkdir(".local/acceptance/studio-2", { recursive: true });
  await writeFile(
    ".local/acceptance/studio-2/benchmark.json",
    JSON.stringify(
      {
        browser: await browser.version(),
        os: platform() + " " + release(),
        cpu: cpus()[0].model,
        viewport: [1920, 1080],
        dpr: 1,
        method:
          "Synthetic shared 12-triangle cube geometry on each part/segment; cold page per run, warm server/package caches. RAF spacing is scheduling interval, NOT CPU/GPU frame time. No real car or pipe geometry supplied.",
        results,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
  await fetch(api + "/api/assets/" + asset.id, {
    method: "DELETE",
    headers: { Authorization: "Bearer " + token },
  });
}
