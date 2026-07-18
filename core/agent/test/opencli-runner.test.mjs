import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { OpenCliError, OpenCliRunner, minimalChildEnvironment, resolveOpenCliInvocation } from "../src/connections/opencli/runner.js";

test("OpenCLI runner invokes a configured JavaScript entry without a shell or Agent secrets", async () => {
  let invocation;
  const runner = new OpenCliRunner({
    command: "/opt/opencli/dist/src/main.js",
    nodeCommand: "/usr/bin/node",
    env: {
      PATH: "/usr/bin",
      HOME: "/home/user",
      OPENCLI_HOME: "/home/user/.opencli",
      OPEN_AGENT_BRIDGE_API_TOKEN: "must-not-leak",
      PERSONAL_AGENT_AUTH_PASSWORD: "must-not-leak",
    },
    execute: async (command, args, options) => {
      invocation = { command, args, options };
      return { stdout: "opencli 1.8.6\n", stderr: "" };
    },
  });

  const status = await runner.probe();
  assert.equal(status.version, "1.8.6");
  assert.equal(invocation.command, "/usr/bin/node");
  assert.deepEqual(invocation.args, [path.resolve("/opt/opencli/dist/src/main.js"), "--version"]);
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.env.OPEN_AGENT_BRIDGE_API_TOKEN, undefined);
  assert.equal(invocation.options.env.PERSONAL_AGENT_AUTH_PASSWORD, undefined);
  assert.equal(invocation.options.env.OPENCLI_HOME, "/home/user/.opencli");
});

test("OpenCLI runner maps stable exit codes without returning raw stderr", async () => {
  const runner = new OpenCliRunner({
    command: "/usr/bin/opencli",
    execute: async () => {
      const error = new Error("child failed");
      error.code = 77;
      error.stderr = "code: AUTH_REQUIRED\nmessage: cookie auth_token=secret";
      throw error;
    },
  });
  await assert.rejects(
    () => runner.run(["xiaohongshu", "search", "test", "--format", "json"]),
    (error) => {
      assert.ok(error instanceof OpenCliError);
      assert.equal(error.code, "OPENCLI_AUTH_REQUIRED");
      assert.doesNotMatch(error.message, /secret|auth_token/);
      return true;
    },
  );
});

test("OpenCLI runner checks Browser Bridge readiness without inspecting account login", async () => {
  let args;
  let calls = 0;
  const runner = new OpenCliRunner({
    command: "/usr/bin/opencli",
    execute: async (_command, received) => {
      calls += 1;
      args = received;
      return { stdout: "Daemon: running (PID 42)\nVersion: v1.8.6\nExtension: connected (v1.8.6)\n", stderr: "" };
    },
  });
  const [first, second] = await Promise.all([runner.browserBridgeStatus(), runner.browserBridgeStatus()]);
  assert.deepEqual(first, {
    ready: true,
    needsSetup: false,
    daemon: "running",
    browserBridge: "connected",
  });
  assert.deepEqual(second, first);
  assert.equal(calls, 1);
  assert.deepEqual(args, ["daemon", "status"]);
});

test("OpenCLI runner rejects non-JSON provider output", async () => {
  const runner = new OpenCliRunner({
    command: "/usr/bin/opencli",
    execute: async () => ({ stdout: "not json", stderr: "" }),
  });
  await assert.rejects(() => runner.json(["xiaohongshu", "search", "test"]), {
    code: "OPENCLI_INVALID_OUTPUT",
  });
});

test("minimal OpenCLI environment excludes unrelated credentials", () => {
  assert.deepEqual(minimalChildEnvironment({
    PATH: "/bin",
    OPENCLI_PROFILE: "personal-agent",
    AWS_SECRET_ACCESS_KEY: "secret",
    GITHUB_TOKEN: "secret",
  }), {
    PATH: "/bin",
    OPENCLI_PROFILE: "personal-agent",
  });
});

test("OpenCLI runner prefers the immutable bundled runtime before global compatibility paths", () => {
  const platform = process.platform;
  const platformPath = platform === "win32" ? path.win32 : path.posix;
  const releaseRoot = platformPath.resolve(platform === "win32" ? "C:\\PersonalAgent\\current" : "/opt/personal-agent/current");
  const expected = platformPath.join(releaseRoot, "core", "agent", "vendor", "opencli-runtime", "node_modules", "@jackwener", "opencli", "dist", "src", "main.js");
  const invocation = resolveOpenCliInvocation({
    env: { PRIVATE_SITE_RELEASE_ROOT: releaseRoot, APPDATA: platformPath.join(releaseRoot, "global") },
    platform,
    nodeCommand: platformPath.join(releaseRoot, platform === "win32" ? "node.exe" : "node"),
    fileExists: (candidate) => candidate === expected,
  });
  assert.deepEqual(invocation, {
    command: platformPath.join(releaseRoot, platform === "win32" ? "node.exe" : "node"),
    prefixArgs: [expected],
    display: "bundled opencli",
    source: "bundled",
  });
});

test("bundled OpenCLI state is isolated under the Personal Agent workspace", () => {
  const env = minimalChildEnvironment({
    PATH: "/bin",
    HOME: "/home/user",
    USERPROFILE: "/home/user",
    PRIVATE_SITE_DATA_ROOT: "/srv/personal-agent/workspace",
  }, { isolateRuntime: true, platform: "linux" });
  assert.equal(env.HOME, "/srv/personal-agent/workspace/runtime/opencli-home");
  assert.equal(env.USERPROFILE, env.HOME);
  assert.equal(env.OPENCLI_CONFIG_DIR, "/srv/personal-agent/workspace/runtime/opencli-home/.opencli");
  assert.equal(env.PRIVATE_SITE_DATA_ROOT, undefined);
});
