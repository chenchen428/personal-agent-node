import { expect, test, type Page } from "@playwright/test";

const entry = {
  id: "occ-fixture-1", planId: "plan-fixture", title: "跨团队项目周会：确认下一阶段交付安排与参与人反馈",
  participants: ["产品负责人", "研发负责人", "设计同学"], startAt: "2026-09-28T06:30:00.000Z", endAt: "2026-09-28T07:30:00.000Z",
  timeZone: "Asia/Shanghai", location: "会议室 A", notes: "核对本周进度", status: "planned", nextFollowUpAt: null,
  revision: 1, executionMode: "record", occurrenceAt: "2026-09-28T06:30:00.000Z", recurrence: { frequency: "weekly", weekdays: [1] },
};
const secondEntry = { ...entry, id: "occ-fixture-2", title: "下一页日程", startAt: "2026-10-05T06:30:00.000Z" };
const mobileUserAgent = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36";

async function mockCalendar(page: Page, empty = false) {
  let failNext = false;
  const requests: string[] = [];
  await page.route("**/api/system/client-scope", (route) => route.fulfill({ json: { schemaVersion: 1, installationId: "fixture-install", spaceId: "fixture-space" } }));
  await page.route("**/api/node/v1/client/overview", (route) => route.fulfill({ json: { ok: true, result: { machine: { state: "running", mobileAddress: "" }, counts: { work: 0, mail: 0, pages: 0 }, space: { displayName: "测试空间" } } } }));
  await page.route("**/api/mobile/tasks**", (route) => route.fulfill({ json: { ok: true, result: { items: [], total: 0, counts: { all: 0, running: 0, completed: 0, interrupted: 0 } } } }));
  await page.route("**/api/calendar**", (route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname + url.search);
    if (failNext && url.pathname === "/api/calendar" && url.searchParams.get("limit") === "50") {
      failNext = false;
      return route.fulfill({ status: 503, json: { ok: false, error: "示例读取失败" } });
    }
    if (url.pathname.endsWith("/history")) return route.fulfill({ json: { ok: true, result: { items: [{ id: "history-1", actor: "Cove", action: "create", content: "记录了日程", createdAt: "2026-09-27T04:00:00.000Z", revision: 1, changes: {} }], total: 1, limit: 20, offset: 0, hasMore: false } } });
    if (url.pathname === `/api/calendar/${entry.id}`) return route.fulfill({ json: { ok: true, result: { entry } } });
    if (url.searchParams.get("limit") === "1") return route.fulfill({ json: { ok: true, result: { items: empty ? [] : [entry], total: empty ? 0 : 1, limit: 1, offset: 0, hasMore: false, asOf: "2026-09-28T00:00:00.000Z", nextEntry: empty ? null : entry, ongoingEntry: null } } });
    const offset = Number(url.searchParams.get("offset") || 0);
    return route.fulfill({ json: { ok: true, result: { items: empty ? [] : [offset ? secondEntry : entry], total: empty ? 0 : 51, limit: 50, offset, hasMore: !empty && offset === 0 } } });
  });
  await page.route("**/api/plans/plan-fixture", (route) => route.fulfill({ json: { ok: true, result: { plan: { ...entry, id: "plan-fixture", enabled: true, nextOccurrenceAt: entry.startAt, missedRunPolicy: "skip" } } } }));
  return { requests, failOnce: () => { failNext = true; } };
}

for (const width of [320, 390, 430]) {
  test(`mobile calendar remains readable at ${width}px`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 760 }, isMobile: true, hasTouch: true, userAgent: mobileUserAgent });
    const page = await context.newPage();
    const fixture = await mockCalendar(page);
    const calendarWrites: string[] = [];
    page.on("request", (request) => { if (/\/api\/(calendar|plans)/.test(request.url()) && request.method() !== "GET") calendarWrites.push(request.url()); });
    await page.goto("/app/mobile/workers/calendar");
    await expect(page.locator(".mobile-calendar-entry-main")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "日程视图" }).getByRole("link")).toHaveCount(2);
    await expect(page.locator(".mobile-calendar-entry-title")).toContainText("跨团队项目周会");
    await expect(page.locator(".mobile-calendar-entry-meta")).toContainText("14:30");
    await expect(page.locator(".mobile-calendar-entry-status")).toHaveText("待开始");
    expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, document.querySelector(".mobile-screen")?.scrollWidth || 0) - innerWidth)).toBeLessThanOrEqual(0);
    for (const label of ["查看时间范围", "刷新日程", "今天"]) {
      const box = await page.getByRole(label === "查看时间范围" ? "combobox" : "button", { name: label }).boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    await page.locator(".mobile-calendar-entry-main").click();
    await expect(page.locator(".mobile-calendar-entry-main")).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".mobile-calendar-detail")).toContainText("记录了日程");
    await expect(page.getByRole("link", { name: /查看所属计划/ })).toHaveAttribute("href", "/app/mobile/workers/calendar?planId=plan-fixture");
    await page.getByRole("combobox", { name: "查看时间范围" }).selectOption("day");
    await expect(page.getByRole("button", { name: "上一个时间段" })).toBeVisible();
    expect(fixture.requests.some((request) => request.includes("from="))).toBe(true);
    await page.getByRole("button", { name: "下一页" }).click();
    await expect(page.locator(".mobile-calendar-entry-title")).toHaveText("下一页日程");
    fixture.failOnce();
    await page.getByRole("button", { name: "刷新日程" }).click();
    await expect(page.locator(".mobile-calendar-feedback[role=alert]")).toContainText("示例读取失败");
    expect(calendarWrites).toEqual([]);
    if (width === 390) {
      await page.getByRole("navigation", { name: "日程视图" }).getByRole("link", { name: "执行记录" }).click();
      await expect(page).toHaveURL(/\/app\/mobile\/workers$/);
      await expect(page.locator(".mobile-execution-toolbar")).toBeVisible();
    }
    await context.close();
  });
}

test("mobile calendar empty state keeps the two views and date controls", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true, userAgent: mobileUserAgent });
  const page = await context.newPage();
  await mockCalendar(page, true);
  await page.goto("/app/mobile/workers/calendar?period=week&from=2026-09-28T00%3A00%3A00.000Z");
  await expect(page.locator(".mobile-calendar-empty")).toContainText("这段时间没有安排");
  await expect(page.getByRole("button", { name: "上一个时间段" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "日程视图" }).getByRole("link")).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await context.close();
});
