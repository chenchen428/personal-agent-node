import assert from "node:assert/strict";
import test from "node:test";
import {
  buildManagedPageAccess,
  PAGE_ACCESS_UNAVAILABLE,
  prepareRemoteChannelText,
  TASK_ACCESS_OFFLINE,
  TASK_ACCESS_UNAVAILABLE,
} from "../src/server/managed-links.js";

const readyAccess = { ready: true, reason: "ready", origin: "https://owner.personal-agent.cn" };

test("Page publication exposes a managed URL without changing the canonical internal route", () => {
  assert.deepEqual(buildManagedPageAccess("/publications/report-1/index.html", readyAccess), {
    internalUrl: "/publications/report-1/index.html",
    url: "https://owner.personal-agent.cn/publications/report-1/index.html",
    linkNotice: "",
  });
  assert.deepEqual(buildManagedPageAccess("/publications/report-1/index.html", { ready: false, reason: "local-only", origin: "" }), {
    internalUrl: "/publications/report-1/index.html",
    url: "",
    linkNotice: PAGE_ACCESS_UNAVAILABLE,
  });
});

test("remote channel text materializes system links and blocks local filesystem references", () => {
  const prepared = prepareRemoteChannelText([
    "进展：/app/chat/session/sess_123/live",
    "报告：[立即查看](/publications/report-1/index.html)",
    "错误链接：http://127.0.0.1:8843/D:/Personal%20Agent/workspace/reports/report.html",
    "本机文件：D:\\Personal Agent\\workspace\\reports\\report.html",
  ].join("\n"), { externalAccess: readyAccess });

  assert.match(prepared.content, /https:\/\/owner\.personal-agent\.cn\/app\/mobile\/workers\/sess_123/);
  assert.doesNotMatch(prepared.content, /\/app\/chat\//);
  assert.match(prepared.content, /\[立即查看\]\(https:\/\/owner\.personal-agent\.cn\/publications\/report-1\/index\.html\)/);
  assert.equal(prepared.blockedLocalReferences, true);
  assert.doesNotMatch(prepared.content, /127\.0\.0\.1|D:|Personal%20Agent|Personal Agent\\workspace/);
  assert.match(prepared.content, /本机路径已拦截/);
});

test("remote task links return a clear reason instead of an unusable URL", () => {
  const localOnly = prepareRemoteChannelText("进展：/app/chat/session/sess_123/live", {
    externalAccess: { ready: false, reason: "local-only", origin: "" },
  });
  assert.equal(localOnly.content, `进展：${TASK_ACCESS_UNAVAILABLE}`);
  assert.equal(localOnly.unavailableManagedLinks, true);
  assert.doesNotMatch(localOnly.content, /\/app\/chat\/|https?:\/\//);

  const offline = prepareRemoteChannelText("进展：/app/chat/session/sess_123/live", {
    externalAccess: { ready: false, reason: "tunnel-offline", origin: "" },
  });
  assert.equal(offline.content, `进展：${TASK_ACCESS_OFFLINE}`);
  assert.equal(offline.unavailableManagedLinks, true);
});

test("remote Page links fail closed when no managed domain is accessible", () => {
  const prepared = prepareRemoteChannelText("[查看报告](/publications/report-1/index.html)", {
    externalAccess: { ready: false, reason: "local-only", origin: "" },
  });
  assert.equal(prepared.content, `查看报告（${PAGE_ACCESS_UNAVAILABLE}）`);
  assert.equal(prepared.unavailableManagedLinks, true);
  assert.doesNotMatch(prepared.content, /\/publications\//);
});
