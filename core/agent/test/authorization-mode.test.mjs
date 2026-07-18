import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { authorizationSettings, readAuthorizationMode, withAuthorizationCliFlag, writeAuthorizationMode } from "../src/agent/authorization-mode.ts";

test("authorization mode defaults to Codex yolo and persists confirmation mode", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-authorization-"));
  const target = path.join(root, "config", "agent-authorization.json");
  try {
    assert.equal(readAuthorizationMode(target), "bypass");
    assert.deepEqual(withAuthorizationCliFlag(["app-server"], "bypass"), ["--dangerously-bypass-approvals-and-sandbox", "app-server"]);
    assert.deepEqual(withAuthorizationCliFlag(["codex.js", "app-server"], "bypass"), ["codex.js", "--dangerously-bypass-approvals-and-sandbox", "app-server"]);
    assert.equal(authorizationSettings("bypass").approvalPolicy, "never");
    assert.equal(authorizationSettings("bypass").sandbox, "danger-full-access");
    writeAuthorizationMode(target, "confirm");
    assert.equal(readAuthorizationMode(target), "confirm");
    assert.deepEqual(withAuthorizationCliFlag(["--yolo", "app-server"], "confirm"), ["app-server"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
