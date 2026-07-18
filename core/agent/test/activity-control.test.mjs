import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { processActivityControl } from "../src/activity/control.js";
import { ActivityStore } from "../src/activity/store.js";
import { BridgeStore } from "../src/store/store.js";

test("executes Activity controls only for a server-verified main Agent", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oab-activity-control-"));
  const bridge = new BridgeStore({ dataDir: root, consoleBaseUrl: "https://agent.example.test" });
  const main = bridge.getOrCreateDesktopMainSession({ workspaceRoot: root });
  const worker = bridge.createSession({ role: "worker", parentSessionId: main.id, workspaceRoot: root, title: "Worker" });
  const activity = new ActivityStore({
    databasePath: bridge.databasePath,
    sessionResolver: (sessionId) => bridge.getSessionRecord(sessionId),
  });

  try {
    const content = [
      '<personal-agent-activity>{"requestId":"r1","action":"create","input":{"type":"work","title":"完成本地构建","detail":"安装包已经构建完成，可以开始本地验收。","idempotencyKey":"build:1"}}</personal-agent-activity>',
      "本地构建已经完成。",
    ].join("\n");
    const result = processActivityControl({ activityStore: activity, session: main, content });
    assert.equal(result.visibleContent, "本地构建已经完成。");
    assert.equal(result.results[0].data.title, "完成本地构建");
    assert.equal(result.results[0].data.mainSessionId, undefined);
    assert.equal(activity.listForReader().total, 1);

    assert.throws(
      () => processActivityControl({ activityStore: activity, session: worker, content }),
      (error) => error.code === "MAIN_AGENT_REQUIRED",
    );
    assert.equal(activity.listForReader().total, 1);
  } finally {
    activity.close();
    bridge.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("returns search results to the main Agent without producing user-visible control text", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oab-activity-search-control-"));
  const bridge = new BridgeStore({ dataDir: root, consoleBaseUrl: "https://agent.example.test" });
  const main = bridge.getOrCreateDesktopMainSession({ workspaceRoot: root });
  const activity = new ActivityStore({
    databasePath: bridge.databasePath,
    sessionResolver: (sessionId) => bridge.getSessionRecord(sessionId),
  });

  try {
    activity.create({ sessionId: main.id }, {
      type: "page",
      title: "发布项目说明页",
      detail: "说明页已发布并可供查看。",
      target: { type: "page", id: "public-project-notes" },
      idempotencyKey: "page:1",
    });
    const result = processActivityControl({
      activityStore: activity,
      session: main,
      content: '<personal-agent-activity>{"requestId":"r2","action":"search","input":{"query":"说明页","limit":5}}</personal-agent-activity>',
    });
    assert.equal(result.visibleContent, "");
    assert.equal(result.requiresFollowup, true);
    assert.equal(result.results[0].data.total, 1);
    assert.equal(result.results[0].data.items[0].title, "发布项目说明页");
  } finally {
    activity.close();
    bridge.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
