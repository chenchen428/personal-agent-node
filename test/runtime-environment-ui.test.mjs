import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { profileChanged, profilePayload, profileValidation } from "../core/app/src/components/runtime-environments/draft.ts";

const stored = { mode: "custom", model: "example-model", reasoningEffort: "", baseUrl: "https://api.example.com/v1", authType: "bearer", credentialConfigured: true };

test("runtime draft retains existing credentials without placing secrets in profile payload", () => {
  assert.equal(profileChanged({ ...stored, credential: "" }, stored), false);
  assert.equal("credentialConfigured" in profilePayload(stored), false);
  assert.equal("credential" in profilePayload({ ...stored, credential: "" }), false);
  assert.equal(profileValidation("codex", stored, stored), "");
  assert.equal(profileChanged({ ...stored, clearCredential: true }, stored), true);
  assert.equal(profilePayload({ ...stored, clearCredential: true }).clearCredential, true);
});

test("runtime draft refuses to test existing credentials against changed URL", () => {
  const moved = { ...stored, baseUrl: "https://other.example.com/v1" };
  assert.match(profileValidation("codex", moved, stored), /重新输入/);
  assert.equal(profileValidation("codex", { ...moved, credential: "fixture-only-token" }, stored), "");
  assert.match(profileValidation("codex", { ...stored, clearCredential: true }, stored), /API Key/);
  assert.match(profileValidation("codex", { ...stored, baseUrl: "https://user:password@api.example.com" }, stored), /不能包含账号/);
  assert.match(profileValidation("codex", { ...stored, baseUrl: "https://api.example.com?key=value" }, stored), /查询参数/);
  assert.match(profileValidation("codex", { ...stored, baseUrl: "http://api.example.com" }, stored), /HTTPS/);
  assert.equal(profileValidation("codex", { ...stored, baseUrl: "http://127.0.0.1:9876/v1", credential: "fixture-only-token" }, stored), "");
});

test("runtime configuration owns desktop model controls and accessible secret editing", () => {
  const read = (file) => readFileSync(new URL(`../core/app/src/components/${file}`, import.meta.url), "utf8");
  assert.doesNotMatch(read("desktop-v627/settings-page.tsx"), /CodexRuntimeSetting|Agent 执行/);
  assert.match(read("desktop-v627/runtime-page.tsx"), /<RuntimeEnvironmentSettings/);
  const view = read("runtime-environments/runtime-environment-settings.tsx");
  assert.match(view, /检测当前草稿，不保存设置/);
  assert.match(view, /aria-pressed=/);
  assert.doesNotMatch(view, /runtime-default|runtime-base-tabs|默认基座<select/);
  assert.match(view, /state\.setEngine\(selected\)/);
  assert.match(view, /onClick=\{state\.reset\}/);
  assert.match(view, /runtime-save-bar/);
  assert.match(read("runtime-environments/runtime-field.tsx"), /@\/components\/ui\/select/);
  const secretDialog = read("runtime-environments/credential-dialog.tsx");
  assert.match(secretDialog, /type="password"/);
  assert.match(secretDialog, /showModal/);
  assert.match(secretDialog, /onCancel=/);
  assert.match(secretDialog, /previous\.focus\(\{ preventScroll: true \}\)/);
  const hook = read("runtime-environments/use-runtime-settings.ts");
  assert.match(hook, /"x-personal-agent-surface": "desktop"/);
  assert.match(hook, /revision: saved.revision/);
  assert.match(hook, /current !== generation.current\[target\]/);
});
