import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdown } from "../core/app/src/lib/markdown.ts";

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
