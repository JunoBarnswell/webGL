import * as THREE from "three";
import { zipSync } from "fflate";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import {
  createDocument,
  createEntity,
  createComponent,
  declareExtension,
} from "@studio/scene-schema";
const base = process.env.STUDIO_API ?? "http://127.0.0.1:18080";
const config = JSON.parse(await readFile(".local/config.json", "utf8"));
const token = (
  await (
    await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: config.adminUser,
        password: config.adminPassword,
      }),
    })
  ).json()
).token;
const geometry = new THREE.BoxGeometry(1000, 1000, 1000);
const bundle = zipSync({
  "cube.json": new TextEncoder().encode(
    JSON.stringify(new THREE.BufferGeometry().copy(geometry).toJSON()),
  ),
});
geometry.dispose();
const upload = await fetch(
  base +
    "/api/assets?" +
    new URLSearchParams({
      name: "Browser fixture cube",
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
const doc = createDocument("Studio 2 browser acceptance");
doc.assets.push(asset);
const entity = createEntity("Source part");
doc.entities.push(entity);
const mesh = createComponent("Mesh");
mesh.data.assetId = asset.id;
entity.components.push(mesh);
entity.components.push(createComponent("studio.sample.Pulse"));
declareExtension(doc, "studio.sample.Pulse");
doc.settings.onDemand = true;
doc.settings.position = [2500, 1800, 5000];
doc.settings.target = [0, 0, 0];
for (const type of ["studio.assembly.Root", "studio.piping.Line"]) {
  const root = createEntity(type);
  const rootComponent = createComponent(type);
  if (type === "studio.piping.Line") rootComponent.data.lineNo = "BROWSER-LINE";
  root.components.push(rootComponent);
  doc.entities.push(root);
  declareExtension(doc, type);
  const part = createComponent(
    type === "studio.assembly.Root"
      ? "studio.assembly.Part"
      : "studio.piping.Segment",
  );
  part.data[type === "studio.assembly.Root" ? "groupId" : "lineId"] = root.id;
  entity.components.push(part);
}
const label = createEntity("Attached label");
const annotation = createComponent("studio.annotation.Label");
annotation.data.entityId = entity.id;
annotation.data.label = "Fixture label";
label.components.push(annotation);
doc.entities.push(label);
declareExtension(doc, annotation.type);
const response = await fetch(base + "/api/projects", {
  method: "POST",
  headers: {
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ name: doc.name, document: doc }),
});
assert.equal(response.status, 200, await response.clone().text());
const draft = await response.json();
const executable = process.env.STUDIO_CHROMIUM ?? "/usr/bin/chromium";
const browser = await chromium.launch({
  executablePath: executable,
  headless: true,
  args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
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
await mkdir(".local/acceptance/studio-2", { recursive: true });
try {
  await page.goto(base + "/editor/");
  const canvas = page.getByLabel("三维场景视口");
  await canvas.waitFor();
  await page
    .locator('.viewport-panel[data-load-phase="ready"]')
    .waitFor({ timeout: 90000 });
  await page.evaluate(() => {
    (
      window as Window & { acceptanceCanvas?: Element | null }
    ).acceptanceCanvas = document.querySelector("canvas");
  });
  const results = [];
  for (const layout of ["standard", "compact", "focus"]) {
    await page.getByLabel("工作台布局").selectOption(layout);
    await page.waitForTimeout(150);
    const ratio = await page
      .locator(".viewport-canvas")
      .evaluate((el) => el.clientWidth / document.documentElement.clientWidth);
    results.push({ layout, ratio });
    if (layout === "compact") assert.ok(ratio >= 0.85);
    if (layout === "focus") assert.ok(ratio >= 0.95);
    await page.screenshot({
      path: ".local/acceptance/studio-2/" + layout + ".png",
    });
    if (layout === "focus")
      await page.getByRole("button", { name: "退出专注 Space" }).click();
  }
  await canvas.focus();
  for (let i = 0; i < 100; i++) {
    await page.keyboard.press("Space");
  }
  assert.equal(
    await page.evaluate(
      () =>
        document.querySelector("canvas") ===
        (window as Window & { acceptanceCanvas?: Element | null })
          .acceptanceCanvas,
    ),
    true,
  );
  assert.equal(
    await page.locator('canvas[aria-label="三维场景视口"]').count(),
    1,
  );
  await canvas.focus();
  await page.keyboard.press("w");
  const selectedTool = await page
    .getByRole("button", { name: "移动 W", exact: true })
    .getAttribute("class");
  assert.equal(selectedTool, "active");
  await canvas.dispatchEvent("keydown", {
    key: "r",
    code: "KeyR",
    isComposing: true,
    bubbles: true,
  });
  assert.equal(
    await page
      .getByRole("button", { name: "移动 W", exact: true })
      .getAttribute("class"),
    "active",
  );
  await page.mouse.move(1700, 900);
  await page.mouse.down({ button: "right" });
  await page.keyboard.press("e");
  await page.mouse.move(1720, 900);
  await page.mouse.up({ button: "right" });
  assert.equal(
    await page
      .getByRole("button", { name: "移动 W", exact: true })
      .getAttribute("class"),
    "active",
  );

  await page.mouse.move(1700, 900);
  await page.mouse.down({ button: "right" });
  await page.keyboard.press("Escape");
  await page.keyboard.press("r");
  await page.mouse.up({ button: "right" });
  assert.equal(
    await page
      .getByRole("button", { name: "缩放 R", exact: true })
      .getAttribute("class"),
    "active",
  );
  const labelButton = page
    .locator(".runtime-hotspot")
    .filter({ hasText: "Fixture label" });
  await labelButton.waitFor();
  const beforeLabel = await labelButton.boundingBox();
  assert.ok(beforeLabel);
  await page.mouse.move(
    beforeLabel.x + beforeLabel.width / 2,
    beforeLabel.y + beforeLabel.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    beforeLabel.x + beforeLabel.width / 2 + 65,
    beforeLabel.y + beforeLabel.height / 2 + 30,
    { steps: 6 },
  );
  await page.mouse.up();
  await page.waitForTimeout(150);
  const movedLabel = await labelButton.boundingBox();
  assert.ok(movedLabel && Math.abs(movedLabel.x - beforeLabel.x - 65) < 3);
  await canvas.focus();
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(150);
  const restoredLabel = await labelButton.boundingBox();
  assert.ok(restoredLabel && Math.abs(restoredLabel.x - beforeLabel.x) < 3);
  await page.mouse.move(
    restoredLabel.x + restoredLabel.width / 2,
    restoredLabel.y + restoredLabel.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    restoredLabel.x + restoredLabel.width / 2 + 40,
    restoredLabel.y + restoredLabel.height / 2 + 20,
    { steps: 4 },
  );
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.waitForTimeout(100);
  assert.ok(Math.abs((await labelButton.boundingBox())!.x - beforeLabel.x) < 3);

  await page.getByLabel("工作台布局").selectOption("standard");
  await page.locator(".tree-label").filter({ hasText: "Source part" }).click();
  const nameInput = page.getByLabel("节点名称");
  await nameInput.fill("Canceled name");
  await nameInput.press("Escape");
  assert.equal(await nameInput.inputValue(), "Source part");
  await nameInput.fill("Saved from input");
  const [saved] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/draft") &&
        response.request().method() === "PUT",
    ),
    nameInput.press("Control+s"),
  ]);
  assert.equal(saved.status(), 200);
  await canvas.focus();
  await page.keyboard.press("Control+z");
  await page.getByLabel("工作台布局").selectOption("compact");
  await page.getByRole("button", { name: "搜索命令", exact: true }).click();
  await page.getByLabel("查找命令").fill("聚焦");
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog", { name: "搜索命令" }).count(), 0);
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await page.getByRole("button", { name: "停止预览 Esc" }).waitFor();
  await page.getByText("模型操作", { exact: true }).click();
  await page.getByRole("button", { name: "设置脉冲", exact: true }).click();
  await page.getByRole("button", { name: "播放拆解", exact: true }).click();
  await page.getByRole("button", { name: "暂停拆解", exact: true }).click();
  await page.getByRole("button", { name: "恢复装配", exact: true }).click();
  await page
    .getByRole("group", { name: "选择装配步骤", exact: true })
    .getByRole("combobox")
    .nth(1)
    .selectOption("initial");
  await page.getByRole("button", { name: "选择装配步骤", exact: true }).click();
  await page.getByRole("button", { name: "高亮管线", exact: true }).click();
  await page.getByRole("button", { name: "恢复管网", exact: true }).click();
  await page.getByRole("button", { name: "全屏预览", exact: true }).click();
  await page.waitForFunction(() => Boolean(document.fullscreenElement));
  assert.equal(await canvas.count(), 1);
  await page.getByRole("button", { name: "全屏预览", exact: true }).click();
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.screenshot({ path: ".local/acceptance/studio-2/preview.png" });
  await page.getByRole("button", { name: "停止预览 Esc" }).click();
  const responsive = [];
  for (const width of [1366, 1024, 767, 390]) {
    await page.setViewportSize({ width, height: 768 });
    await page.waitForTimeout(100);
    responsive.push({
      width,
      overflow: await page
        .locator(".app-header")
        .evaluate((el) => el.scrollWidth > el.clientWidth),
    });
    assert.equal(responsive.at(-1)!.overflow, false);
  }
  await page.waitForTimeout(1000);
  const currentDraft = await (
    await fetch(base + "/api/scenes/" + draft.sceneId + "/draft", {
      headers: { Authorization: "Bearer " + token },
    })
  ).json();
  const publication = await fetch(
    base + "/api/scenes/" + draft.sceneId + "/publish",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expectedRevision: currentDraft.revision }),
    },
  );
  assert.equal(publication.status, 200, await publication.clone().text());
  await page.goto(base + "/player/?scene=" + draft.sceneId);
  await page
    .getByRole("button", { name: "进入展厅", exact: true })
    .click({ timeout: 90000 });
  await page.getByText("模型操作", { exact: true }).click();
  await page.getByRole("button", { name: "设置脉冲", exact: true }).click();
  await page.getByRole("button", { name: "播放拆解", exact: true }).click();
  await page.getByRole("button", { name: "恢复装配", exact: true }).click();
  await page
    .getByRole("group", { name: "选择装配步骤", exact: true })
    .getByRole("combobox")
    .nth(1)
    .selectOption("initial");
  await page.getByRole("button", { name: "选择装配步骤", exact: true }).click();
  await page.getByRole("button", { name: "高亮管线", exact: true }).click();
  await page.screenshot({ path: ".local/acceptance/studio-2/player.png" });
  if (process.env.STUDIO_BASELINE) {
    const baseline = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
    });
    await baseline.addInitScript(
      ({ token, scene }) => {
        sessionStorage.setItem("studio-token", token);
        localStorage.setItem("studio-last-scene", scene);
      },
      { token, scene: draft.sceneId },
    );
    await baseline.route("**/api/scenes/*/draft", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      delete data.document.documentVersion;
      delete data.document.requiredExtensions;
      for (const entity of data.document.entities)
        entity.components = entity.components.filter(
          (component: { type: string }) => !component.type.includes("."),
        );
      await route.fulfill({ response, json: data });
    });
    await baseline.goto(process.env.STUDIO_BASELINE + "/editor/");
    await baseline
      .locator('.viewport-panel[data-load-phase="ready"]')
      .waitFor({ timeout: 90000 });
    await baseline.screenshot({
      path: ".local/acceptance/studio-2/baseline.png",
    });
    await baseline.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    ".local/acceptance/studio-2/browser.json",
    JSON.stringify(
      {
        status: "Pass",
        canvasRetained: true,
        layoutCycles: 100,
        annotationDragUndoCancel: true,
        escapeCancelsFlight: true,
        nativeFullscreen: true,
        inputEscapeAndSave: true,
        stepSelection: true,
        layouts: results,
        responsive,
        browser: await browser.version(),
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Pass: browser layouts, 100 retained Canvas cycles, commands, preview and responsive shell",
  );
} finally {
  await browser.close();
  await fetch(base + "/api/projects/" + draft.projectId, {
    method: "DELETE",
    headers: { Authorization: "Bearer " + token },
  });
  await fetch(base + "/api/assets/" + asset.id, {
    method: "DELETE",
    headers: { Authorization: "Bearer " + token },
  });
}
