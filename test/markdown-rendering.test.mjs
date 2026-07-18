import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdown } from "../core/app/src/lib/markdown.ts";
import { localTaskDetailHref } from "../core/app/src/components/desktop-v627/conversation-links.ts";

test("desktop task and conversation markdown renders common content", () => {
  const html = renderMarkdown("## 进度\n\n- 已完成\n- `npm test`\n\n[查看](https://example.com)");
  assert.match(html, /<h2>进度<\/h2>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<code>npm test<\/code>/);
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.match(html, /target="_blank"/);
});

test("desktop markdown escapes raw HTML and rejects executable links", () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n[x](javascript:alert(1))');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /href="javascript:/);
});

test("desktop conversation rewrites managed session progress links to the local task detail", () => {
  const managed = "https://chenchen428.personal-agent.cn/app/mobile/workers/sess_fa0b167403fa51b3";
  assert.equal(localTaskDetailHref(managed), "/app/workers?task=sess_fa0b167403fa51b3");
  assert.equal(localTaskDetailHref("https://chenchen428.personal-agent.cn/app/mobile/conversations/sess_fa0b167403fa51b3"), "/app/workers?task=sess_fa0b167403fa51b3");
  assert.equal(localTaskDetailHref("https://chenchen428.personal-agent.cn/app/chat/session/sess_fa0b167403fa51b3/live"), "/app/workers?task=sess_fa0b167403fa51b3");
  assert.equal(localTaskDetailHref("https://example.com/app/mobile/workers/sess_other"), null);
  const html = renderMarkdown(`[查看绘画进展](${managed})`, localTaskDetailHref);
  assert.match(html, /href="\/app\/workers\?task=sess_fa0b167403fa51b3"/);
  assert.doesNotMatch(html, /target="_blank"/);
});
