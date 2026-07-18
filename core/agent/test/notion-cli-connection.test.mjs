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
