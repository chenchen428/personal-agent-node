import assert from "node:assert/strict";
import test from "node:test";

import { formatTaskStatusReply, isTaskStatusRequest } from "../src/server/main-turn-routing.js";

test("recognizes task status questions without routing Page work", () => {
  assert.equal(isTaskStatusRequest("\u73b0\u5728\u505a\u5230\u54ea\u4e00\u6b65\u4e86\uff1f"), true);
  assert.equal(isTaskStatusRequest("\u8bf7\u5236\u4f5c\u4e00\u4e2a\u88c5\u4fee Page"), false);
});

test("formats child task states without internal worker terminology", () => {
  assert.equal(formatTaskStatusReply([]), "\u5f53\u524d\u6ca1\u6709\u53ef\u62a5\u544a\u7684\u4efb\u52a1\u3002");
  const reply = formatTaskStatusReply([
    { title: "\u88c5\u4fee\u8bbe\u8ba1\u4ea4\u4ed8\u9875", status: "running" },
    { title: "\u65c5\u884c\u89c4\u5212", status: "idle" },
  ]);
  assert.match(reply, /\u5904\u7406\u4e2d/);
  assert.match(reply, /本次处理已结束/);
  assert.doesNotMatch(reply, /已完成/);
  assert.doesNotMatch(reply, /worker|\u5b50\u4efb\u52a1/i);
});

test("mixed status and delivery requests reach the Agent without losing follow-up work", () => {
  for (const content of [
    "完成了吗？二维码还没有，继续做完并发给我。",
    "任务状态怎么样了，顺便把二维码补上",
    "帮我看看任务完成了吗然后继续处理剩下的部分",
    "二维码任务完成了吗",
    "查下状态并告诉我最近一次日程是什么时候",
  ]) assert.equal(isTaskStatusRequest(content), false, content);
  for (const content of ["完成了吗？", "现在做到哪一步了？", "当前任务状态", "告诉我任务进度", "还要多久？"]) {
    assert.equal(isTaskStatusRequest(content), true, content);
  }
});

test("status replies retain the governed progress page and never invent a missing remote link", () => {
  const reply = formatTaskStatusReply([{ id: "sess_progress", title: "整理资料", status: "running", url: "https://work.example.site/app/mobile/workers/sess_progress" }]);
  assert.match(reply, /\[查看进度\]\(https:\/\/work\.example\.site\/app\/mobile\/workers\/sess_progress\)/);
  const notice = "远程连接暂时离线，当前无法在线查看任务进度。";
  const offline = formatTaskStatusReply([{ id: "sess_progress", title: "整理资料", status: "running", url: "", internalUrl: "/app/chat/session/sess_progress/live", linkNotice: notice }]);
  assert.ok(offline.includes(notice));
  assert.doesNotMatch(offline, /https?:\/\/|\[查看进度\]/);
  for (const url of ["javascript:alert(1)", "https://localhost/app/mobile/workers/sess_progress", "https://work.example.site/app/mobile/workers/another", "https://work.example.site/app/mobile/workers/sess_progress?token=hidden"]) {
    assert.doesNotMatch(formatTaskStatusReply([{ id: "sess_progress", title: "资料", status: "running", url }]), /\[查看进度\]|token=|javascript:/);
  }
});
