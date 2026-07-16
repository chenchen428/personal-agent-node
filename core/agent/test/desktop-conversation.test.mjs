import assert from "node:assert/strict";
import test from "node:test";
import { buildDesktopConversationView } from "../src/server/desktop-conversation.js";

test("desktop conversation returns only main user-facing history with stable earlier pagination", () => {
  const messages = Array.from({ length: 45 }, (_, index) => ({
    id: `message-${index + 1}`,
    role: index % 2 ? "assistant" : "user",
    content: `message ${index + 1}`,
  }));
  messages.splice(20, 0,
    { id: "reasoning", role: "agent", content: "private reasoning" },
    { id: "tool", role: "tool", content: "private tool call" },
    { id: "system", role: "system", content: "turn completed" });
  const session = { id: "main", role: "main", messages, events: [], childSessions: [] };

  const latest = buildDesktopConversationView(session, { limit: 40 });
  assert.equal(latest.role, "main");
  assert.equal(latest.messages.length, 40);
  assert.equal(latest.messages[0].id, "message-6");
  assert.equal(latest.pagination.hasEarlier, true);
  assert.equal(latest.pagination.earlierCursor, "message-6");
  assert.equal(latest.messages.some((message) => ["agent", "tool", "system"].includes(message.role)), false);
  assert.equal("events" in JSON.parse(JSON.stringify(latest)), false);

  const earlier = buildDesktopConversationView(session, { before: latest.pagination.earlierCursor, limit: 40 });
  assert.deepEqual(earlier.messages.map((message) => message.id), [
    "message-1", "message-2", "message-3", "message-4", "message-5",
  ]);
  assert.equal(earlier.pagination.hasEarlier, false);
});

test("desktop conversation exposes only the latest unfinished structured plan", () => {
  const main = {
    id: "main",
    role: "main",
    messages: [],
    events: [],
    childSessions: [{
      id: "worker-1",
      role: "worker",
      status: "running",
      title: "上海亲子活动调研",
      taskDescription: "比较通勤与雨天备选",
    }],
  };
  const worker = {
    id: "worker-1",
    updatedAt: "2026-07-16T14:28:00.000Z",
    events: [{
      createdAt: "2026-07-16T14:28:00.000Z",
      payload: {
        metadata: {
          eventType: "turn/plan/updated",
          plan: [
            { step: "核对年龄与开放时间", status: "completed" },
            { step: "排除过期预约入口", status: "completed" },
            { step: "比较通勤与雨天备选", status: "inProgress" },
          ],
        },
      },
    }],
  };

  const view = buildDesktopConversationView(main, {
    resolveSession: (sessionId) => sessionId === worker.id ? worker : null,
  });
  assert.equal(view.currentPlan.title, "上海亲子活动调研");
  assert.equal(view.currentPlan.completed, 2);
  assert.deepEqual(view.currentPlan.steps.map((step) => step.status), [
    "completed", "completed", "in_progress",
  ]);
  assert.equal(view.linkedTask.id, "worker-1");

  worker.events[0].payload.metadata.plan[2].status = "completed";
  assert.equal(buildDesktopConversationView(main, {
    resolveSession: () => worker,
  }).currentPlan, null);
});
