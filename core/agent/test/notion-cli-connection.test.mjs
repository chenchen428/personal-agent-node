import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NotionCliConnection, parseLoginAuthorization, resolveNotionCli, resolveNotionEnvironment } from "../src/connections/notion-cli.js";

test("official Notion CLI connection starts a deterministic browser authorization and redeems it", async () => {
  const calls = [];
  const opened = [];
  const notion = new NotionCliConnection({
    command: "ntn",
    run: async (command, args) => {
      calls.push({ command, args });
      if (args[0] === "login" && args[1] === "--no-browser") return { code: 0, stdout: "Open https://www.notion.so/cli-login?code=ABCD-EFGH\nVerification code: ABCD-EFGH", stderr: "" };
      if (args[0] === "login" && args[1] === "poll") return { code: 0, stdout: "authorized", stderr: "" };
      if (args[0] === "doctor") return { code: 0, stdout: "authenticated and healthy", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
    openBrowser: async (url) => { opened.push(url); return true; },
  });

  const login = await notion.startLogin();
  assert.equal(login.state, "authorizing");
  assert.match(login.instructions, /浏览器/);
  assert.equal(login.userCode, "ABCD-EFGH");
  assert.deepEqual(opened, ["https://www.notion.so/cli-login?code=ABCD-EFGH"]);
  assert.deepEqual(calls[0], { command: "ntn", args: ["login", "--no-browser"] });

  const connected = await notion.pollLogin();
  assert.equal(connected.state, "connected");
  assert.deepEqual(calls.slice(1), [
    { command: "ntn", args: ["login", "poll"] },
    { command: "ntn", args: ["doctor"] },
  ]);
});

test("clearing a Notion connection logs out the isolated CLI home and resets its status", async () => {
  const calls = [];
  const notion = new NotionCliConnection({
    command: "ntn",
    run: async (command, args, options) => {
      calls.push({ command, args, options });
      return { code: 0, stdout: "logged out", stderr: "" };
    },
  });
  notion.lastStatus = { state: "connected", statusLabel: "已连接", details: { cliReady: true } };
  notion.pendingLogin = { expiresAt: new Date(Date.now() + 60_000).toISOString() };

  assert.deepEqual(await notion.clearConfiguration(), { state: "needs_setup", statusLabel: "需要浏览器授权", details: { cliReady: true } });
  assert.deepEqual(calls[0].args, ["logout"]);
  assert.equal(calls[0].options.timeoutMs, 15_000);
  assert.equal(notion.pendingLogin, null);
  assert.equal(notion.catalogStatus().state, "needs_setup");
});

test("missing official Notion CLI is reported without leaking a process error", async () => {
  const missing = async () => { throw Object.assign(new Error("spawn private path"), { code: "ENOENT" }); };
  const notion = new NotionCliConnection({ run: missing });
  assert.deepEqual(await notion.status(), { state: "missing", statusLabel: "官方 CLI 未安装", details: { cliReady: false } });
  await assert.rejects(notion.startLogin(), (error) => error.code === "NOTION_CLI_MISSING" && error.statusCode === 503);
});

test("authorization polling reports an unfinished browser login without invoking an unsupported CLI command", async () => {
  const calls = [];
  const notion = new NotionCliConnection({
    command: "ntn",
    run: async (command, args) => {
      calls.push({ command, args });
      return { code: 0, stdout: "Default workspace ! no default workspace\nToken source ! no token found", stderr: "" };
    },
  });
  await assert.rejects(notion.pollLogin(), (error) => error.code === "NOTION_LOGIN_PENDING" && error.statusCode === 409);
  assert.deepEqual(calls, [{ command: "ntn", args: ["login", "poll"] }, { command: "ntn", args: ["doctor"] }]);
});

test("browser authorization expires after two minutes and can be restarted", async () => {
  let now = 1_000;
  const notion = new NotionCliConnection({
    command: "ntn",
    now: () => now,
    openBrowser: async () => true,
    run: async () => ({ code: 0, stdout: "Open https://www.notion.so/cli-login\nAuthorization code: ABCD-EFGH", stderr: "" }),
  });
  await notion.startLogin();
  now += 120_001;
  await assert.rejects(notion.pollLogin(), (error) => error.code === "NOTION_LOGIN_EXPIRED" && error.statusCode === 410);
});

test("login output parser keeps only a bounded HTTPS authorization URL and public code", () => {
  assert.deepEqual(parseLoginAuthorization("Open https://www.notion.so/cli-login?code=ABCD-EFGH.\nVerification code: ABCD-EFGH"), {
    verificationUrl: "https://www.notion.so/cli-login?code=ABCD-EFGH",
    userCode: "ABCD-EFGH",
  });
  assert.equal(parseLoginAuthorization("Open http://notion.example/login\nVerification code: ABCD-EFGH").verificationUrl, "");
  assert.equal(parseLoginAuthorization("Open https://www.notion.so/install/cli-login?verificationCode=1AB-C2D").userCode, "1AB-C2D");
});

test("official doctor warnings do not misreport an unauthenticated workspace as connected", async () => {
  const notion = new NotionCliConnection({
    run: async () => ({ code: 0, stdout: "CLI version ✔ v0.19.0\nDefault workspace ! no default workspace\nToken source ! no token found\nhint: run `ntn login` to authenticate", stderr: "" }),
  });
  assert.deepEqual(await notion.status(), { state: "needs_setup", statusLabel: "需要浏览器授权", details: { cliReady: true } });
});

test("official Notion CLI resolves from a WinGet package when the service PATH is minimal", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-ntn-"));
  try {
    const executable = path.join(root, "Microsoft", "WinGet", "Packages", "Notion.ntn_Microsoft.Winget.Source_test", "ntn-x86_64-pc-windows-msvc", "ntn.exe");
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(executable, "fixture");
    assert.equal(resolveNotionCli({ LOCALAPPDATA: root }, { platform: "win32" }), executable);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Notion CLI uses one writable Workspace home across login, poll, and doctor", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-notion-home-"));
  try {
    const environment = resolveNotionEnvironment({ PRIVATE_SITE_DATA_ROOT: root, PATH: process.env.PATH });
    assert.equal(environment.NOTION_HOME, path.join(root, "config", "notion"));
    assert.equal(fs.statSync(environment.NOTION_HOME).isDirectory(), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function deferred() { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; }
function isolatedNotion(t, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-notion-status-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new NotionCliConnection({ command: "ntn", env: { PRIVATE_SITE_DATA_ROOT: root }, run, openBrowser: async () => true });
}

test("temporary Notion doctor failures preserve known authorization but explicit revocation clears it", async (t) => {
  let response = { code: 0, stdout: "authenticated and healthy", stderr: "" };
  const notion = isolatedNotion(t, async () => { if (response instanceof Error) throw response; return response; });
  assert.equal((await notion.status()).state, "connected");
  response = { code: 1, stdout: "", stderr: "upstream unavailable" };
  assert.equal((await notion.status()).state, "connected");
  assert.equal(notion.catalogStatus().details.statusCheck, "unavailable");
  response = new Error("timeout with private path and token");
  assert.equal((await notion.status()).state, "connected");
  assert.doesNotMatch(JSON.stringify(notion.catalogStatus()), /private|token/);
  response = { code: 1, stdout: "token expired; run `ntn login`", stderr: "" };
  assert.equal((await notion.status()).state, "needs_setup");
  assert.equal(notion.catalogStatus().details.statusCheck, undefined);
});

test("an older Notion doctor result cannot overwrite a newer observation or logout", async (t) => {
  const old = deferred(); let reads = 0;
  const notion = isolatedNotion(t, async (_command, args) => {
    if (args[0] === "doctor" && ++reads === 1) return old.promise;
    return { code: 0, stdout: "no token found", stderr: "" };
  });
  const pending = notion.status();
  assert.equal((await notion.status()).state, "needs_setup");
  await notion.clearConfiguration();
  old.resolve({ code: 0, stdout: "authenticated and healthy", stderr: "" });
  assert.equal((await pending).state, "needs_setup");
  assert.equal(notion.catalogStatus().state, "needs_setup");
});

test("Notion logout waits for an in-flight login poll and invalidates its late success", async (t) => {
  const pending = deferred(); const started = deferred(); const calls = [];
  const notion = isolatedNotion(t, async (_command, args) => {
    calls.push(args.join(" "));
    if (args.join(" ") === "login poll") { started.resolve(); return pending.promise; }
    return { code: 0, stdout: "authenticated and healthy", stderr: "" };
  });
  const polling = notion.pollLogin();
  const rejected = assert.rejects(polling, (error) => error.code === "NOTION_LOGIN_CANCELLED");
  await started.promise;
  const clearing = notion.clearConfiguration();
  assert.deepEqual(calls, ["login poll"]);
  pending.resolve({ code: 0, stdout: "authorized", stderr: "" });
  await rejected; await clearing;
  assert.deepEqual(calls, ["login poll", "logout"]);
  assert.equal(notion.catalogStatus().state, "needs_setup");
});

test("a failed status probe never confirms a pending Notion login from cached authorization", async (t) => {
  const notion = isolatedNotion(t, async (_command, args) => args[0] === "login"
    ? { code: 0, stdout: "authorized", stderr: "" }
    : { code: 1, stdout: "", stderr: "temporarily unavailable" });
  notion.lastStatus = { state: "connected", statusLabel: "已连接", details: { cliReady: true } };
  await assert.rejects(notion.pollLogin(), (error) => error.code === "NOTION_STATUS_UNAVAILABLE" && error.statusCode === 503);
});

test("a new Notion authorization cannot succeed through the previously connected workspace", async (t) => {
  const pending = deferred(); const started = deferred(); let polls = 0; let doctors = 0;
  const notion = isolatedNotion(t, async (_command, args) => {
    if (args.join(" ") === "login --no-browser") return { code: 0, stdout: "Open https://www.notion.so/cli-login", stderr: "" };
    if (args.join(" ") === "login poll" && ++polls === 1) { started.resolve(); return pending.promise; }
    if (args[0] === "doctor") doctors += 1;
    return { code: 0, stdout: "authenticated and healthy", stderr: "" };
  });
  assert.equal((await notion.status()).state, "connected");
  await notion.startLogin();
  const polling = notion.pollLogin();
  const rejected = assert.rejects(polling, (error) => error.code === "NOTION_LOGIN_PENDING" && error.statusCode === 409);
  await started.promise;
  assert.equal(notion.catalogStatus().state, "connected");
  pending.resolve({ code: 1, stdout: "authorization_pending", stderr: "" });
  await rejected;
  assert.equal(doctors, 1, "old credentials must not be used to confirm the new attempt");
  assert.notEqual(notion.pendingLogin, null);
  assert.equal((await notion.pollLogin()).state, "connected");
  assert.equal(notion.pendingLogin, null);
});

test("Notion poll transport errors and explicit pending output preserve the old account without completing the new attempt", async (t) => {
  let mode = "error"; let doctors = 0;
  const notion = isolatedNotion(t, async (_command, args) => {
    if (args.join(" ") === "login --no-browser") return { code: 0, stdout: "Open https://www.notion.so/cli-login", stderr: "" };
    if (args[0] === "doctor") { doctors += 1; return { code: 0, stdout: "authenticated and healthy", stderr: "" }; }
    if (mode === "error") throw new Error("temporary private upstream failure");
    return { code: 0, stdout: "authorization pending", stderr: "" };
  });
  await notion.status(); await notion.startLogin();
  await assert.rejects(notion.pollLogin(), (error) => error.code === "NOTION_STATUS_UNAVAILABLE" && error.statusCode === 503);
  mode = "pending";
  await assert.rejects(notion.pollLogin(), (error) => error.code === "NOTION_LOGIN_PENDING" && error.statusCode === 409);
  assert.equal(doctors, 1);
  assert.equal(notion.catalogStatus().state, "connected");
  assert.notEqual(notion.pendingLogin, null);
});

test("an in-flight Notion authorization start cannot reopen its state after logout", async (t) => {
  const pending = deferred(); const started = deferred();
  const notion = isolatedNotion(t, async (_command, args) => {
    if (args[0] === "login") { started.resolve(); return pending.promise; }
    return { code: 0, stdout: "logged out", stderr: "" };
  });
  const login = notion.startLogin();
  const rejected = assert.rejects(login, (error) => error.code === "NOTION_LOGIN_CANCELLED");
  await started.promise;
  const clearing = notion.clearConfiguration();
  pending.resolve({ code: 0, stdout: "Open https://www.notion.so/cli-login", stderr: "" });
  await rejected; await clearing;
  assert.equal(notion.pendingLogin, null);
  assert.equal(notion.catalogStatus().state, "needs_setup");
});
