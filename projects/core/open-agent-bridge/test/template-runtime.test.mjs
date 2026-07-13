import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TemplateRuntime } from "../src/automation/template-runtime.js";

test("template runtime installs versioned pure transforms and returns JSON", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-template-runtime-"));
  const runtime = new TemplateRuntime({ dataDir, timeoutMs: 5000 });
  const manifest = runtime.install({
    id: "example",
    name: "Example",
    source: "export default function parse(input) { return { total: input.values.reduce((sum, value) => sum + value, 0) }; }",
  });
  assert.equal(manifest.version, 1);
  const result = await runtime.run("example", { values: [1, 2, 3] });
  assert.deepEqual(result.output, { total: 6 });
  assert.throws(() => runtime.install({ id: "bad", name: "Bad", source: "import fs from 'node:fs'; export default function parse() { return fs; }" }), /forbidden/);

  const second = runtime.install({
    id: "example",
    name: "Example failing v2",
    source: "export default function parse() { throw new Error('fixture failure'); }",
  });
  assert.equal(second.version, 2);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await assert.rejects(() => runtime.run("example", {}), /template worker|fixture failure|exited/i);
  }
  assert.equal(runtime.status("example").status, "disabled");
  await assert.rejects(() => runtime.run("example", {}), /disabled/);

  const rollback = runtime.rollback("example", 1, { reason: "restore known-good parser" });
  assert.equal(rollback.state.status, "active");
  assert.equal(rollback.state.version, 1);
  const restored = await runtime.run("example", { values: [4, 5] });
  assert.deepEqual(restored.output, { total: 9 });
  assert.equal(runtime.status("example").consecutiveFailures, 0);
});
