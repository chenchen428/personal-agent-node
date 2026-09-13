import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { initializeSite, mergeSecretEnv, resolveNodeConfig } from "../src/config.ts";
import { createSpace } from "../src/space-registry.ts";
import { bridgeCliEnvironment } from "../src/cli-context.ts";
import { bridgeCliStatus, prepareBridgeCliShims, spaceCliBin } from "../src/cli-shims.ts";
import { localMailPlan } from "../src/mail.ts";

const project = path.resolve(import.meta.dirname, "../../..");
const bash = process.platform === "win32" ? [path.join(process.env.ProgramFiles || "C:/Program Files", "Git/bin/bash.exe"), "C:/Program Files/Git/usr/bin/bash.exe"].find(fs.existsSync) : "/bin/sh";

test("registered CLI context selects the installation's Space and rejects mixed Agent context before loading its env", t => {
  const f = fixture(t);
  const base = { PERSONAL_AGENT_CLI_INSTALLATION_ROOT: f.root };
  assert.equal(bridgeCliEnvironment(base).PERSONAL_AGENT_SPACE_ID, f.main.space.id);
  assert.equal(bridgeCliEnvironment(base, f.child.space.slug).PERSONAL_AGENT_SPACE_ID, f.child.space.id);
  const turn = turnEnvironment(f.main);
  assert.equal(bridgeCliEnvironment({ ...base, ...turn }).OPEN_AGENT_BRIDGE_API_TOKEN, turn.OPEN_AGENT_BRIDGE_API_TOKEN);
  assert.equal(bridgeCliEnvironment({ ...base, ...turn }).OPEN_AGENT_BRIDGE_UPLOAD_TOKEN, "");
  assert.equal(bridgeCliEnvironment({ ...base, ...turn }).OPEN_AGENT_BRIDGE_MAIL_DATA_DIR, f.main.mailDir);
  for (const broken of [
    { ...base, ...turn, PERSONAL_AGENT_CLI_BOUND_SPACE_ID: f.child.space.id },
    { ...base, ...turn, PERSONAL_AGENT_SPACE_ID: "" },
    { ...base, ...turn, PERSONAL_AGENT_SPACE_ROOT: "" },
    { ...base, ...turn, OPEN_AGENT_BRIDGE_API_TOKEN: "" },
  ]) assert.throws(() => bridgeCliEnvironment(broken), error => /^CLI_SPACE_/.test(error.code));
  assert.throws(() => bridgeCliEnvironment({ ...base, ...turn }, f.child.space.id), { code: "CLI_SPACE_MISMATCH" });
  assert.match(localMailPlan(f.child).delivery.command, new RegExp(`--space ${f.child.space.id} mail ingest`));
});

for (const platform of ["win32", "linux"]) test(`bare ${platform} wrappers remain Space-bound across startup order and work in a plain bundled Node CLI`, { skip: platform === "win32" && process.platform !== "win32" || platform === "linux" && !bash }, async t => {
  const f = fixture(t);
  const release = path.join(f.install, "releases", "fixture");
  const entry = path.join(release, "core/agent/bin/pa-cli.mjs");
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.mkdirSync(path.join(release, "core/runtime"), { recursive: true });
  fs.mkdirSync(path.join(release, "registry"), { recursive: true });
  fs.copyFileSync(path.join(project, "registry/site-distribution.json"), path.join(release, "registry/site-distribution.json"));
  const modules = path.join(release, "node_modules");
  fs.symlinkSync(path.join(project, "node_modules"), modules, process.platform === "win32" ? "junction" : "dir");
  t.after(() => { if (fs.lstatSync(modules, { throwIfNoEntry: false })?.isSymbolicLink()) fs.unlinkSync(modules); });
  const built = await build({ entryPoints: [path.join(project, "core/agent/bin/pa-cli.mjs")], outfile: entry,
    bundle: true, platform: "node", target: "node22", format: "esm", metafile: true,
    banner: { js: "import { createRequire as __personalAgentCreateRequire } from 'node:module'; const require = __personalAgentCreateRequire(import.meta.url);" } });
  assert.ok(Object.keys(built.metafile.inputs).some(file => file.endsWith("core/runtime/src/cli-context.ts")));
  // Exercise Windows' text-pointer current format, not only directory symlinks.
  fs.writeFileSync(path.join(f.install, "current"), release);
  const servers = [];
  const calendarCalls = [];
  for (const [name, config] of [["main", f.main], ["child", f.child]]) {
    const server = http.createServer(async (request, response) => {
      const auth = request.headers.authorization;
      const accepted = auth === `Bearer stored-${name}` || auth === `Bearer live-${name}`;
      response.writeHead(accepted ? 200 : 401, { "content-type": "application/json" });
      if (accepted && request.url === "/api/internal/calendar-agent") {
        let body = ""; for await (const chunk of request) body += chunk;
        calendarCalls.push({ spaceId: config.space.id, capability: request.headers["x-cove-calendar-capability"], body: JSON.parse(body) });
        response.end(JSON.stringify({ ok: true, result: { action: "list", data: { items: [] } } })); return;
      }
      response.end(JSON.stringify(accepted ? { sessions: [{ id: config.space.id, title: name }] } : { error: "wrong Space credential" }));
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); servers.push(server);
    mergeSecretEnv(config.envPath, { OPEN_AGENT_BRIDGE_API_TOKEN: `stored-${name}`, OPEN_AGENT_BRIDGE_PORT: String(server.address().port) });
  }
  t.after(async () => { for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });
  const options = { platform, installRoot: f.install, binDir: f.globalBin, env: { PATH: f.globalBin } };
  fs.writeFileSync(path.join(f.directory, "space.json"), JSON.stringify({ spaceId: f.child.space.id }));
  for (const order of [[f.main, f.child], [f.child, f.main], [f.main, f.child]]) {
    for (const config of order) prepareBridgeCliShims(config, options);
    for (const config of [f.main, f.child]) {
      const status = bridgeCliStatus(config, options);
      assert.equal(status.ready, true); assert.equal(status.scopedReady, true);
      assert.equal(status.mailIngest.commandPath, path.join(spaceCliBin(config.dataRoot), platform === "win32" ? "pa-cli.cmd" : "pa-cli"));
    }
    const global = await invoke(platform, f.globalBin, f, {}, ["session", "list", "--json"]);
    assert.equal(global.code, 0, global.stderr); assert.match(global.stdout, new RegExp(f.main.space.id));
    const selected = await invoke(platform, f.globalBin, f, {}, ["--space", f.child.space.id, "session", "list", "--json"]);
    assert.equal(selected.code, 0, selected.stderr); assert.match(selected.stdout, new RegExp(f.child.space.id));
    for (const config of [f.main, f.child]) {
      const result = await invoke(platform, spaceCliBin(config.dataRoot), f, turnEnvironment(config), ["session", "list", "--json"]);
      assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, new RegExp(config.space.id));
    }
  }
  const wrong = await invoke(platform, spaceCliBin(f.child.dataRoot), f, turnEnvironment(f.main), ["session", "list", "--json"]);
  assert.notEqual(wrong.code, 0); assert.match(wrong.stderr, /CLI_SPACE_MISMATCH/);
  const wrongMail = await invoke(platform, spaceCliBin(f.child.dataRoot), f, turnEnvironment(f.main), ["mail", "ingest", "--json"]);
  assert.notEqual(wrongMail.code, 0); assert.match(wrongMail.stderr, /CLI_SPACE_MISMATCH/);
  const wrongToken = await invoke(platform, spaceCliBin(f.main.dataRoot), f, { ...turnEnvironment(f.main), OPEN_AGENT_BRIDGE_API_TOKEN: "stored-child" }, ["session", "list", "--json"]);
  assert.notEqual(wrongToken.code, 0); assert.match(wrongToken.stderr, /wrong Space credential/);
  const switched = await invoke(platform, spaceCliBin(f.main.dataRoot), f, {}, ["--space", f.child.space.id, "session", "list", "--json"]);
  assert.notEqual(switched.code, 0); assert.match(switched.stderr, /CLI_SPACE_MISMATCH/);
  const calendar = await invoke(platform, f.globalBin, f, {}, ["--space", f.child.space.id, "calendar", "list", "--capability", "fixture-capability", "--json"]);
  assert.equal(calendar.code, 0, calendar.stderr); assert.equal(calendarCalls.length, 1);
  assert.equal(calendarCalls[0].spaceId, f.child.space.id); assert.equal(calendarCalls[0].capability, "fixture-capability");
  assert.deepEqual(calendarCalls[0].body, { action: "list", entryId: "", input: {} });
  // Inspect only the launch context for mail; never deliver a message or write an archive.
  for (const config of [f.main, f.child]) {
    const context = bridgeCliEnvironment({ PERSONAL_AGENT_CLI_INSTALLATION_ROOT: f.root, PERSONAL_AGENT_CLI_BOUND_SPACE_ID: config.space.id, ...turnEnvironment(config) });
    assert.equal(context.OPEN_AGENT_BRIDGE_MAIL_DATA_DIR, config.mailDir);
    assert.equal(fs.readdirSync(path.join(config.mailDir, "archive")).length, 0);
  }
  const sourceOptions = { ...options, installRoot: path.join(f.directory, "source-install"), binDir: path.join(f.directory, "source-bin") };
  prepareBridgeCliShims(f.main, sourceOptions);
  const source = await invoke(platform, sourceOptions.binDir, f, {}, ["session", "list", "--json"]);
  assert.equal(source.code, 0, source.stderr); assert.match(source.stdout, new RegExp(f.main.space.id));
});

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pa-cli-space-"));
  // Each fixture owns all files it writes. Explicitly unlink any dependency link before removing it.
  t.after(() => { const link = path.join(directory, "core/releases/fixture/node_modules"); if (fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) fs.unlinkSync(link); fs.rmSync(directory, { recursive: true, force: true }); });
  const root = path.join(directory, "workspace");
  const main = initializeSite({ dataRoot: root, domain: "personal-agent.local" }).config;
  const space = createSpace({ dataRoot: root, slug: "work", displayName: "Work" });
  initializeSite({ dataRoot: root, spaceId: space.id, domain: "personal-agent.local" });
  const child = resolveNodeConfig({ PERSONAL_AGENT_DATA_ROOT: root, PRIVATE_SITE_DATA_ROOT: space.root, PERSONAL_AGENT_SPACE_ID: space.id });
  const install = path.join(directory, "core"); fs.mkdirSync(install, { recursive: true });
  return { root, directory, main, child, install, globalBin: path.join(directory, "global-bin") };
}
function turnEnvironment(config) { return { OPEN_AGENT_BRIDGE_SESSION_ID: "fixture-session", PERSONAL_AGENT_SPACE_ID: config.space.id, PERSONAL_AGENT_SPACE_ROOT: config.dataRoot, OPEN_AGENT_BRIDGE_API_TOKEN: `live-${config.space.kind === "personal" ? "main" : "child"}` }; }
function invoke(platform, bin, fixture, additional, args) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/^(?:OPEN_AGENT_BRIDGE|PERSONAL_AGENT|PRIVATE_SITE)_/i.test(name) || /^path$/i.test(name)) delete env[name];
  Object.assign(env, additional);
  env.PATH = [bin, process.env.PATH || process.env.Path || ""].join(path.delimiter);
  const posix = value => process.platform === "win32" ? String(value).replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, letter) => `/${letter.toLowerCase()}`) : value;
  const quote = value => `'${String(value).replaceAll("'", `'"'"'`)}'`;
  const command = platform === "win32" ? process.env.ComSpec || "cmd.exe" : bash;
  const commandArgs = platform === "win32" ? ["/d", "/c", "pa-cli", ...args] : ["-c", `PATH=${quote(posix(bin))}:$PATH; exec pa-cli ${args.map(quote).join(" ")}`];
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd: fixture.directory, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", data => stdout += data); child.stderr.on("data", data => stderr += data);
    const timer = setTimeout(() => child.kill(), 15_000);
    child.on("error", reject); child.on("close", code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
