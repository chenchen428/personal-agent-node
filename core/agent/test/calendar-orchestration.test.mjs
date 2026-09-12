import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BridgeStore } from "../src/store/store.js";
import { CalendarStore } from "../src/calendar/store.js";
import { SessionOrchestrator } from "../src/server/orchestrator.js";

test("Calendar capability is issued only to main turns, redacted and revoked, and cannot forge Space identity", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cove-calendar-turn-"));
  const store = new BridgeStore({ dataDir: path.join(root, "bridge"), consoleBaseUrl: "https://space.example.com" });
  const main = store.getOrCreateDesktopMainSession({ workspaceRoot: root });
  const calendarStore = new CalendarStore({ dataDir: path.join(root, "calendar"), spaceId: "space-a", sessionResolver: (id) => store.getSessionRecord(id) });
  let issued = "";
  let orchestrator;
  orchestrator = new SessionOrchestrator({ store, calendarStore, siteDataRoot: root, hub: { broadcast() {} }, channels: {}, progressTimerEnabled: false,
    runner: { async runAppServerCommand(input) {
      issued = /日程临时能力值 ([A-Za-z0-9_-]+)/.exec(input.appServerDeveloperInstructions)?.[1] || "";
      assert.ok(issued);
      const result = await orchestrator.executeCalendarCli(issued, { action: "create", input: { title: "明天讨论", startAt: "2026-09-13T09:00:00+08:00", timeZone: "Asia/Shanghai" } });
      assert.equal(result.data.revision, 1);
      await assert.rejects(orchestrator.executeCalendarCli(issued, { action: "list", input: { spaceId: "other" } }));
      await input.onSessionEvent({ sessionId: input.sessionId, kind: "session.tool_use", payload: { content: `calendar ${issued}`, metadata: { nested: [issued] } } });
      return { ok: true };
    }, stopAppServerCommand() { return false; } },
  });
  try {
    await orchestrator.runTurn(main.id, "安排日程", { developerInstructions: "main" });
    assert.equal(calendarStore.list().total, 1);
    assert.doesNotMatch(JSON.stringify(store.getSession(main.id)), new RegExp(issued));
    await assert.rejects(orchestrator.executeCalendarCli(issued, { action: "list" }), { code: "CALENDAR_CAPABILITY_INVALID" });
    orchestrator.calendarCapabilities.set("forged", { sessionId: main.id, spaceId: "other" });
    orchestrator.running.add(main.id);
    await assert.rejects(orchestrator.executeCalendarCli("forged", { action: "list" }), { code: "CALENDAR_CAPABILITY_INVALID" });
    const worker = store.createSessionRecord({ role: "worker", parentSessionId: main.id, workspaceRoot: root });
    orchestrator.runner.runAppServerCommand = async (input) => { assert.doesNotMatch(input.appServerDeveloperInstructions, /日程临时能力值/); return { ok: true }; };
    await orchestrator.runTurn(worker.id, "工作", { developerInstructions: "worker" });
  } finally { orchestrator.stop(); calendarStore.close(); store.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
