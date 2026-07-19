import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readCodexRuntimeSettings, writeCodexRuntimeSettings } from "../src/agent/codex-runtime-settings.ts";

test("Codex runtime settings use environment defaults until the Space saves an explicit selection", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-codex-settings-"));
  const target = path.join(root, "config", "codex-runtime-settings.json");
  try {
    assert.deepEqual(readCodexRuntimeSettings(target, { model: "gpt-default", reasoningEffort: "medium" }), {
      model: "gpt-default",
      reasoningEffort: "medium",
    });
    assert.deepEqual(writeCodexRuntimeSettings(target, { model: "gpt-selected", reasoningEffort: "high" }), {
      model: "gpt-selected",
      reasoningEffort: "high",
    });
    assert.deepEqual(readCodexRuntimeSettings(target, { model: "ignored", reasoningEffort: "low" }), {
      model: "gpt-selected",
      reasoningEffort: "high",
    });
    writeCodexRuntimeSettings(target, { model: "", reasoningEffort: "" });
    assert.deepEqual(readCodexRuntimeSettings(target, { model: "ignored", reasoningEffort: "low" }), {
      model: "",
      reasoningEffort: "",
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Codex runtime settings reject malformed identifiers", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-codex-settings-invalid-"));
  try {
    assert.throws(
      () => writeCodexRuntimeSettings(path.join(root, "settings.json"), { model: "bad model", reasoningEffort: "high" }),
      (error) => error?.code === "INVALID_CODEX_RUNTIME_SETTINGS",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
