import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
const exec = promisify(execFile);
const cli = path.resolve(import.meta.dirname, "../bin/pa-cli.mjs");

test("Pages poster CLI forwards governed IDs through the current main-turn capability only", async (t) => {
  let captured;
  const server = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    captured = { url: request.url, capability: request.headers["x-cove-calendar-capability"], command: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, result: { action: "page-poster", data: { objectIds: ["obj_result"], targetUrl: "https://space.example.com/app/mobile/pages/private-demo" } } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); t.after(() => server.close());
  const env = { ...process.env, OPEN_AGENT_BRIDGE_API_BASE: `http://127.0.0.1:${server.address().port}` };
  const args = [cli, "pages", "poster", "--id", "private-demo", "--source-object", `obj_${"a".repeat(24)}`, "--capability", "ephemeral", "--json"];
  const result = await exec(process.execPath, args, { env });
  assert.deepEqual(captured, { url: "/api/internal/calendar-agent", capability: "ephemeral", command: { action: "page-poster", input: { pageId: "private-demo", sourceObjectId: `obj_${"a".repeat(24)}` } } });
  assert.deepEqual(JSON.parse(result.stdout).data.objectIds, ["obj_result"]);
  assert.doesNotMatch(result.stdout + result.stderr, /ephemeral/);
  for (const option of ["--url", "--space", "--file", "--actor"]) await assert.rejects(exec(process.execPath, [...args, option, "forged"], { env }), (error) => /Unsupported pages poster option/.test(error.stderr));
});
