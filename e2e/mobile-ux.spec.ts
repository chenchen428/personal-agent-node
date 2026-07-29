import { expect, test, type Page } from "@playwright/test";

const mobileUserAgent = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36";

async function mockShellApis(page: Page) {
  await page.route("**/api/node/v1/client/overview", (route) => route.fulfill({ json: { schemaVersion: 1, ok: true, result: { machine: { id: "test", state: "running", uptimeSeconds: 10, mobileAddress: "" }, counts: { work: 0, mail: 0, pages: 0 }, recent: [] } } }));
  await page.route("**/api/node/v1/client/activity**", (route) => route.fulfill({ json: { schemaVersion: 1, ok: true, result: { items: [], total: 0, nextCursor: "" } } }));
  await page.route("**/api/mobile/tasks**", (route) => route.fulfill({ json: { schemaVersion: 1, ok: true, result: { items: [], total: 0, nextCursor: "", counts: { all: 0, running: 0, completed: 0, interrupted: 0 } } } }));
  await page.route("**/api/system/apps", (route) => route.fulfill({ json: { apps: [] } }));
  await page.route("**/api/system/spaces", (route) => route.fulfill({ json: { spaces: [], currentSpaceId: null } }));
}

for (const width of [360, 390, 430]) {
  test(`mobile ${width}px resolves before business UI under slow 4G`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, userAgent: mobileUserAgent });
    const page = await context.newPage();
    await mockShellApis(page);
    const client = await context.newCDPSession(page);
    await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await client.send("Network.enable");
    await client.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 90_000 });
    await page.addInitScript(() => {
      window.__desktopFrames = 0;
      window.__cls = 0;
      new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__cls += entry.hadRecentInput ? 0 : entry.value; }).observe({ type: "layout-shift", buffered: true });
      const inspect = () => { if (document.querySelector(".desktop-v72")) window.__desktopFrames += 1; requestAnimationFrame(inspect); };
      requestAnimationFrame(inspect);
    });
    const documents: string[] = [];
    page.on("request", (request) => { if (request.resourceType() === "document") documents.push(request.url()); });
    await page.goto("/app", { waitUntil: "networkidle" });
    await expect(page.locator(".mobile-current")).toBeVisible();
    expect(documents).toHaveLength(1);
    expect(await page.evaluate(() => window.__desktopFrames)).toBe(0);
    expect(await page.evaluate(() => window.__cls)).toBeLessThan(0.1);
    expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth)).toBeLessThanOrEqual(0);
    const menu = await page.getByRole("button", { name: "打开侧边菜单" }).boundingBox();
    expect(menu?.width).toBeGreaterThanOrEqual(44);
    expect(menu?.height).toBeGreaterThanOrEqual(44);
    await context.close();
  });
}

test("mobile menu navigation preserves the shell and does not reload the document", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: mobileUserAgent });
  const page = await context.newPage();
  await mockShellApis(page);
  let documents = 0;
  page.on("request", (request) => { if (request.resourceType() === "document") documents += 1; });
  await page.goto("/app/mobile", { waitUntil: "networkidle" });
  await page.evaluate(() => { window.__persistentPhone = document.querySelector("#mobile-phone"); });
  await page.getByRole("button", { name: "打开侧边菜单" }).click();
  await page.getByRole("link", { name: /任务/ }).click();
  await expect(page).toHaveURL(/\/app\/mobile\/workers$/);
  expect(documents).toBe(1);
  expect(await page.evaluate(() => window.__persistentPhone === document.querySelector("#mobile-phone"))).toBe(true);
  await page.goBack();
  await expect(page).toHaveURL(/\/app\/mobile$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/app\/mobile\/workers$/);
  expect(documents).toBe(1);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByText("任务", { exact: true }).first()).toBeVisible();
  await context.close();
});

test("large task detail starts with a bounded page and incrementally loads earlier messages", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: mobileUserAgent });
  const page = await context.newPage();
  await mockShellApis(page);
  const initial = Array.from({ length: 20 }, (_, index) => displayEvent(index + 81));
  const earlier = Array.from({ length: 20 }, (_, index) => displayEvent(index + 61));
  const requested: string[] = [];
  await page.route("**/api/mobile/tasks/task-large/display-events**", (route) => {
    requested.push(route.request().url());
    const url = new URL(route.request().url());
    const loadingEarlier = url.searchParams.has("before");
    return route.fulfill({ json: { schemaVersion: 1, ok: true, result: {
      task: { id: "task-large", role: "worker", title: "大型任务", status: "done", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      items: loadingEarlier ? earlier : initial,
      beforeCursor: loadingEarlier ? "cursor-61" : "cursor-81",
      hasEarlier: true,
      latestPlan: { steps: [], updatedAt: "" },
      limit: 20,
    } } });
  });
  await page.goto("/app/mobile/workers/task-large", { waitUntil: "networkidle" });
  await expect(page.locator(".mobile-task-message")).toHaveCount(20);
  await page.locator('[data-task-display-scroll="tail"]').evaluate((element) => element.scrollTo(0, 0));
  await expect(page.locator(".mobile-task-message")).toHaveCount(40);
  expect(requested.some((url) => url.includes("before=cursor-81"))).toBe(true);
  expect(requested.some((url) => url.includes("/api/chat/sessions/"))).toBe(false);
  await context.close();
});

test("desktop keeps the desktop composition", async ({ page }) => {
  await mockShellApis(page);
  await page.setViewportSize({ width: 1200, height: 750 });
  await page.goto("/app", { waitUntil: "networkidle" });
  await expect(page.locator(".desktop-v72")).toBeVisible();
  await expect(page.locator(".mobile-current")).toHaveCount(0);
});

function displayEvent(sequence: number) {
  return { displayEventId: `message-${sequence}`, taskId: "task-large", sequence, kind: "message", role: sequence % 2 ? "assistant" : "user", content: `消息 ${sequence}`, createdAt: new Date(2026, 0, 1, 0, sequence).toISOString(), metadata: {} };
}

declare global {
  interface Window { __desktopFrames: number; __cls: number; __persistentPhone: Element | null; }
}
