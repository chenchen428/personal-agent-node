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
    { id: "system", role: "system", content: "turn completed" },
    { id: "retrying", role: "error", content: "Reconnecting... 2/5", metadata: { willRetry: true } });
  const session = { id: "main", role: "main", messages, events: [], childSessions: [] };

  const latest = buildDesktopConversationView(session, { limit: 40 });
  assert.equal(latest.role, "main");
  assert.equal(latest.messages.length, 40);
  assert.equal(latest.messages[0].id, "message-6");
  assert.equal(latest.pagination.hasEarlier, true);
  assert.equal(latest.pagination.earlierCursor, "message-6");
  assert.equal(latest.messages.some((message) => ["agent", "tool", "system"].includes(message.role)), false);
  assert.equal(latest.messages.some((message) => message.id === "retrying"), false);
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
  assert.equal(view.linkedTask.parentSessionId, "main");
  assert.equal(view.linkedTask.href, "/app/workers?task=worker-1");
  assert.equal(view.currentPlan.href, "/app/workers?task=worker-1");

  worker.events[0].payload.metadata.plan[2].status = "completed";
  assert.equal(buildDesktopConversationView(main, {
    resolveSession: () => worker,
  }).currentPlan, null);
});

test("desktop conversation hides internal Agent hook inputs", () => {
  const session = {
    id: "main",
    role: "main",
    events: [],
    childSessions: [],
    messages: [
      { id: "user", role: "user", content: "帮我发布页面" },
      { id: "hook-progress", role: "user", content: "[worker-hook:progress]\n内部进度" },
      { id: "hook-complete", role: "user", content: "[worker-hook:completed]\n内部结果" },
      { id: "activity-hook", role: "user", content: "[activity-hook:result]\n内部动态结果" },
      { id: "answer", role: "assistant", content: "页面已经发布。" },
    ],
  };
  const view = buildDesktopConversationView(session);
  assert.deepEqual(view.messages.map((message) => message.id), ["user", "answer"]);
});

test("desktop conversation repairs managed desktop image preview URLs", () => {
  const session = {
    id: "main",
    role: "main",
    events: [],
    childSessions: [],
    messages: [{
      id: "image-message",
      role: "user",
      content: "看这张图",
      metadata: {
        attachments: [{
          name: "户型图.png",
          kind: "image",
          mimeType: "image/png",
          sizeBytes: 128,
          relativePath: "desktop/main/户型图.png",
          previewUrl: "/app/files/view/desktop/main/%E6%88%B7%E5%9E%8B%E5%9B%BE.png",
        }],
      },
    }],
  };
  const attachment = buildDesktopConversationView(session).messages[0].metadata.attachments[0];
  assert.equal(attachment.previewUrl, "/app/files/raw/desktop/main/%E6%88%B7%E5%9E%8B%E5%9B%BE.png");
  assert.equal(attachment.viewUrl, "/app/files/view/desktop/main/%E6%88%B7%E5%9E%8B%E5%9B%BE.png");
  assert.equal(attachment.downloadUrl, "/app/files/raw/desktop/main/%E6%88%B7%E5%9E%8B%E5%9B%BE.png?download=1");
});

test("desktop conversation merges desktop and WeChat main history with source labels", () => {
  const desktop = {
    id: "desktop-main",
    role: "main",
    channel: "desktop",
    status: "idle",
    events: [],
    childSessions: [],
    messages: [
      { id: "desktop-user", role: "user", content: "桌面消息", createdAt: "2026-07-18T08:00:00.000Z", metadata: { channel: "desktop" } },
      { id: "desktop-answer", role: "assistant", content: "桌面回复", createdAt: "2026-07-18T08:01:00.000Z" },
    ],
  };
  const wechat = {
    id: "wechat-main",
    role: "main",
    channel: "wechat",
    status: "running",
    events: [],
    childSessions: [],
    messages: [
      { id: "wechat-user", role: "user", content: "微信消息", createdAt: "2026-07-18T07:59:00.000Z", source: "wechat" },
      { id: "wechat-answer", role: "assistant", content: "微信回复", createdAt: "2026-07-18T08:02:00.000Z" },
    ],
  };

  const view = buildDesktopConversationView([desktop, wechat]);
  assert.deepEqual(view.messages.map((message) => message.id), [
    "wechat-user", "desktop-user", "desktop-answer", "wechat-answer",
  ]);
  assert.equal(view.messages.find((message) => message.id === "wechat-user").metadata.sourceLabel, "来自微信");
  assert.equal(view.messages.find((message) => message.id === "desktop-user").metadata.sourceLabel, "来自桌面");
  assert.equal(view.messages.find((message) => message.id === "wechat-user").sessionId, "wechat-main");
  assert.equal(view.status, "running");
  assert.equal("events" in JSON.parse(JSON.stringify(view)), false);
  assert.equal("childSessions" in JSON.parse(JSON.stringify(view)), false);
});

test("desktop conversation hides legacy duplicate WeChat runner echoes", () => {
  const wechat = {
    id: "wechat-main",
    role: "main",
    channel: "wechat",
    status: "idle",
    events: [],
    childSessions: [],
    messages: [
      {
        id: "wechat-channel-copy",
        role: "user",
        content: "send the report",
        createdAt: "2026-07-18T08:05:00.000Z",
        source: "wechat",
        metadata: { channel: "wechat", senderId: "wechat-user" },
      },
      {
        id: "wechat-runner-echo",
        role: "user",
        content: "send the report",
        createdAt: "2026-07-18T08:05:00.050Z",
      },
      {
        id: "wechat-later-repeat",
        role: "user",
        content: "send the report",
        createdAt: "2026-07-18T08:05:30.000Z",
        source: "wechat",
        metadata: { channel: "wechat", senderId: "wechat-user" },
      },
    ],
  };

  const view = buildDesktopConversationView(wechat);
  assert.deepEqual(view.messages.map((message) => message.id), [
    "wechat-channel-copy",
    "wechat-later-repeat",
  ]);
});

test("desktop conversation keeps attachment-only replies and resolves image and file delivery state", () => {
  const objectId = "obj_0123456789abcdef01234567";
  const fileObjectId = "obj_89abcdef0123456701234567";
  const session = {
    id: "wechat-main",
    role: "main",
    channel: "wechat",
    status: "idle",
    childSessions: [],
    messages: [{
      id: "image-only-reply",
      role: "assistant",
      content: "",
      metadata: {
        finalReply: { schemaVersion: 1, requestId: "request-1", idempotencyKey: "reply-1" },
        attachments: [
          { objectId, kind: "image", name: "result.png", mimeType: "image/png", sizeBytes: 20, width: 12, height: 9, alt: "Result", previewUrl: `/api/chat/attachments/${objectId}`, deliveryState: "pending" },
          { objectId: fileObjectId, kind: "file", name: "report.pdf", mimeType: "application/pdf", sizeBytes: 1200, caption: "Report", downloadUrl: `/api/chat/attachments/${fileObjectId}?download=1`, deliveryState: "pending" },
        ],
      },
    }],
    events: [
      { payload: { metadata: { eventType: "wechat/final-reply-part", idempotencyKey: "reply-1", part: "attachment", objectId, state: "sent" } } },
      { payload: { metadata: { eventType: "wechat/final-reply-part", idempotencyKey: "reply-1", part: "attachment", objectId: fileObjectId, state: "failed" } } },
    ],
  };
  const view = buildDesktopConversationView(session);
  assert.equal(view.messages.length, 1);
  assert.equal(view.messages[0].metadata.attachments[0].deliveryState, "sent");
  assert.equal(view.messages[0].metadata.attachments[0].previewUrl, `/api/chat/attachments/${objectId}`);
  assert.equal(view.messages[0].metadata.attachments[1].deliveryState, "failed");
  assert.equal(view.messages[0].metadata.attachments[1].downloadUrl, `/api/chat/attachments/${fileObjectId}?download=1`);
});
