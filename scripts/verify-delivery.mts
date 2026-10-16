import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
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
const headers = {
  Authorization: "Bearer " + token,
  "Content-Type": "application/json",
};
const showroom = JSON.parse(await readFile(".local/import/draft.json", "utf8"));
const examples = JSON.parse(
  await readFile(".local/examples/index.json", "utf8"),
);
const publish = await fetch(
  base + "/api/scenes/" + showroom.sceneId + "/publish",
  {
    method: "POST",
    headers,
    body: JSON.stringify({ expectedRevision: showroom.revision }),
  },
);
assert.equal(publish.status, 200, await publish.clone().text());
const browser = await chromium.launch({
  executablePath: process.env.STUDIO_CHROMIUM ?? "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
});
const results = [];
await mkdir(".local/acceptance/studio-2", { recursive: true });
try {
  for (const fixture of process.env.STUDIO_LIFECYCLE_ONLY
    ? []
    : [{ name: "showroom", sceneId: showroom.sceneId }, ...examples]) {
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base + "/player/?scene=" + fixture.sceneId);
    await page
      .getByRole("button", { name: "进入展厅", exact: true })
      .click({ timeout: 120000 });
    if (fixture.name === "assembly") {
      await page.getByText("模型操作", { exact: true }).click();
      await page.getByRole("button", { name: "播放拆解", exact: true }).click();
      await page.getByRole("button", { name: "恢复装配", exact: true }).click();
    }
    if (fixture.name === "piping") {
      await page.getByText("模型操作", { exact: true }).click();
      const buttons = page.getByRole("button", {
        name: "高亮管线",
        exact: true,
      });
      await buttons.first().click();
      await page
        .getByRole("button", { name: "恢复管网", exact: true })
        .first()
        .click();
    }
    await page.screenshot({
      path: ".local/acceptance/studio-2/delivery-" + fixture.name + ".png",
    });
    assert.deepEqual(errors, []);
    assert.equal(await page.locator(".player-error").count(), 0);
    results.push({ name: fixture.name, publicPlayer: true, errors });
    await page.close();
  }
  const page = await browser.newPage();
  await page.addInitScript(
    ({ token, scene }) => {
      sessionStorage.setItem("studio-token", token);
      localStorage.setItem("studio-last-scene", scene);
    },
    { token, scene: showroom.sceneId },
  );
  await page.goto("http://127.0.0.1:5173/editor/");
  await page
    .locator('.viewport-panel[data-load-phase="ready"]')
    .waitFor({ timeout: 120000 });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({
    path: ".local/acceptance/studio-2/showroom-editor.png",
  });
  const lifecycle = await page.evaluate(async () => {
    const source = await (await fetch("/editor/src/App.tsx")).text();
    const modulePath = source.match(
      /from\s*["']([^"']*state\/studio\.ts[^"']*)["']/,
    )?.[1];
    if (!modulePath) throw Error("Vite state module URL missing");
    const { useStudio } = await import(/* @vite-ignore */ modulePath);
    const state = useStudio.getState(),
      runtime = state.runtime,
      doc = state.document;
    const draft = {
      projectId: state.projectId,
      sceneId: doc.sceneId,
      revision: state.revision,
      document: doc,
    };
    const before = runtime.stats();
    for (let i = 0; i < 10; i++) {
      await runtime.setMode("play");
      await runtime.setMode("edit");
    }
    const afterPreview = runtime.stats();
    const cycles = [];
    for (let i = 0; i < 10; i++) {
      useStudio.getState().close();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      cycles.push(runtime.stats());
      await useStudio.getState().open(draft, true);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    }
    return { before, afterPreview, cycles, after: runtime.stats() };
  });
  await writeFile(
    ".local/acceptance/studio-2/lifecycle.json",
    JSON.stringify(lifecycle, null, 2),
  );
  assert.equal(lifecycle.afterPreview.resources, lifecycle.before.resources);
  assert.equal(lifecycle.after.resources, lifecycle.before.resources);
  assert.ok(
    lifecycle.cycles.every(
      (c: { objects: number; resources: number; pending: number }) =>
        c.objects === 0 && c.resources === 0 && c.pending === 0,
    ),
  );
  results.push({ lifecycle });
  await page.close();
  if (process.env.STUDIO_BASELINE) {
    const before = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
    });
    await before.addInitScript(
      ({ token, scene }) => {
        sessionStorage.setItem("studio-token", token);
        localStorage.setItem("studio-last-scene", scene);
      },
      { token, scene: showroom.sceneId },
    );
    await before.route("**/api/scenes/*/draft", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      delete data.document.documentVersion;
      delete data.document.requiredExtensions;
      await route.fulfill({ response, json: data });
    });
    await before.goto(process.env.STUDIO_BASELINE + "/editor/");
    await before
      .locator('.viewport-panel[data-load-phase="ready"]')
      .waitFor({ timeout: 120000 });
    await before.screenshot({
      path: ".local/acceptance/studio-2/showroom-baseline.png",
    });
    results.push({
      baseline: {
        viewportRatio: await before
          .locator(".viewport-canvas")
          .evaluate((el) => el.clientWidth / innerWidth),
        resources: JSON.parse(
          (await before
            .locator(".viewport-panel")
            .getAttribute("data-runtime-stats")) ?? "{}",
        ),
      },
    });
    await before.close();
  }
  await writeFile(
    ".local/acceptance/studio-2/delivery.json",
    JSON.stringify({ status: "Pass", publicSamples: process.env.STUDIO_LIFECYCLE_ONLY ? "skipped" : "passed", results }, null, 2),
  );
  console.log(process.env.STUDIO_LIFECYCLE_ONLY ? "Pass: 10 preview and 10 close/reopen resource cycles; public samples skipped" : "Pass: public showroom (57 artworks), synthetic car/pipe samples, 10 preview and 10 close/reopen resource cycles");
} finally {
  await browser.close();
}
