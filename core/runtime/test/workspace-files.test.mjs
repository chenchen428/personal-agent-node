import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureWorkspaceFiles } from "../src/workspace-files.ts";

test("workspace files are directly user-owned and absorb the legacy .local layout", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "private-site-files-"));
  const config = {
    dataRoot: path.join(root, "state"),
    agentWorkspaceRoot: path.join(root, "workspace"),
  };
  try {
    fs.mkdirSync(path.join(config.dataRoot, "files", "managed"), { recursive: true });
    fs.writeFileSync(path.join(config.dataRoot, "files", "managed", "asset.txt"), "managed");
    fs.mkdirSync(path.join(config.agentWorkspaceRoot, ".local", "files", "inbound"), { recursive: true });
    fs.writeFileSync(path.join(config.agentWorkspaceRoot, ".local", "files", "inbound", "message.txt"), "inbound");

    const first = ensureWorkspaceFiles(config);
    const second = ensureWorkspaceFiles(config);

    assert.equal(first.linked, false);
    assert.equal(first.migrated, 1);
    assert.equal(second.migrated, 0);
    assert.equal(fs.lstatSync(path.join(config.dataRoot, "files")).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(path.join(config.dataRoot, "files", "managed", "asset.txt"), "utf8"), "managed");
    assert.equal(fs.readFileSync(path.join(config.dataRoot, "files", "inbound", "message.txt"), "utf8"), "inbound");
    assert.equal(fs.existsSync(path.join(config.agentWorkspaceRoot, ".local")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workspace file migration refuses conflicting content", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "private-site-files-conflict-"));
  const config = {
    dataRoot: path.join(root, "state"),
    agentWorkspaceRoot: path.join(root, "workspace"),
  };
  try {
    const source = path.join(config.agentWorkspaceRoot, ".local", "files", "managed", "same.txt");
    const target = path.join(config.dataRoot, "files", "managed", "same.txt");
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(source, "source");
    fs.writeFileSync(target, "target");

    assert.throws(() => ensureWorkspaceFiles(config), /migration conflict/);
    assert.equal(fs.readFileSync(source, "utf8"), "source");
    assert.equal(fs.readFileSync(target, "utf8"), "target");
    assert.equal(fs.lstatSync(path.join(config.dataRoot, "files")).isSymbolicLink(), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
