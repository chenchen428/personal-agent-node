import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("legacy channel page redirects to the browser capability connection", () => {
  const serverSource = fs.readFileSync(fileURLToPath(new URL("../src/server/server.ts", import.meta.url)), "utf8");
  assert.match(serverSource, /sendRedirect\(response, "\/app\/connections\?connection=xiaohongshu"/);
  assert.doesNotMatch(serverSource, /renderChannelsPage/);
});

test("Node distribution verification targets the unified Next.js application contract", () => {
  const verifier = fs.readFileSync(fileURLToPath(new URL("../../../scripts/verify-private-site-node-dist.mjs", import.meta.url)), "utf8");
  assert.match(verifier, /health\.architecture === "core-workspace"/);
  assert.match(verifier, /\/api\/system\/setup/);
  assert.match(verifier, /page\.includes\("首次设置"\)/);
  assert.match(verifier, /page\.includes\("完成 Personal Agent 初始化"\)/);
  assert.doesNotMatch(verifier, /server\.includes\("data-status"\)/);
});
