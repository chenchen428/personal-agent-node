import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PLATFORM_LOGIN_SCRIPTS, runPlatformSession } from "../../../scripts/lib/social-platform-session.mjs";
import { OpenCliRunner } from "../src/connections/opencli/runner.js";
import { OpenCliTwitterProvider } from "../src/channels/twitter/opencli-provider.js";
import { OpenCliXiaohongshuProvider } from "../src/channels/xiaohongshu/opencli-provider.js";

const logged = { loginState: "logged_in", searchReady: true, readReady: true };
const loggedOut = { loginState: "logged_out", searchReady: false, readReady: false };
function deferred() { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; }
function domResult(platform, { authenticated = false, login = false, challenge = false, loading = false, foreign = false, hiddenLogin, hiddenChallenge } = {}) {
  const element = { textContent: "我", getClientRects: () => [1], getAttribute: () => "/user/profile/fixture", closest: () => null, getBoundingClientRect: () => ({ width: 100, height: 30, left: 10, top: 10, right: 110, bottom: 40 }) };
  const hidden = (kind) => ({ ...element, ...(kind === "opacity" ? { opacity: "0" } : kind === "aria" ? { closest: () => ({}) } : kind === "zero" ? { getBoundingClientRect: () => ({ width: 0, height: 0 }) } : { getBoundingClientRect: () => ({ width: 100, height: 30, left: 2000, right: 2100, top: 10, bottom: 40 }) }) });
  const document = {
    readyState: loading ? "loading" : "complete",
    get cookie() { throw new Error("cookie accessed"); },
    get body() { throw new Error("post text inspected"); },
    querySelectorAll(selector) {
      if (selector.includes("captcha")) return challenge ? [element] : hiddenChallenge ? [hidden(hiddenChallenge)] : [];
      if (selector.startsWith(".login-container") || selector.startsWith('a[href="/login"')) return login ? [element] : hiddenLogin ? [hidden(hiddenLogin)] : [];
      if (selector.startsWith("button")) return [];
      return authenticated ? [element] : [];
    },
  };
  const result = vm.runInNewContext(PLATFORM_LOGIN_SCRIPTS[platform], {
    document, location: { protocol: "https:", hostname: foreign ? "untrusted.example" : platform === "twitter" ? "x.com" : "www.xiaohongshu.com", pathname: "/" },
    innerWidth: 1024, innerHeight: 768,
    getComputedStyle: (element) => ({ visibility: "visible", display: "block", opacity: element.opacity || "1" }),
  });
  return JSON.parse(JSON.stringify(result));
}

for (const [platform, Provider] of [["xiaohongshu", OpenCliXiaohongshuProvider], ["twitter", OpenCliTwitterProvider]]) {
  test(`${platform} visible DOM requires reliable account navigation; login walls, unknown and challenges are distinct`, () => {
    assert.deepEqual(domResult(platform, { authenticated: true }), logged);
    assert.deepEqual(domResult(platform, { authenticated: true, login: true }), loggedOut);
    for (const options of [{}, { authenticated: true, challenge: true }, { authenticated: true, loading: true }, { authenticated: true, foreign: true }]) assert.equal(domResult(platform, options).loginState, "unknown");
    for (const hidden of ["opacity", "aria", "zero", "offscreen"]) assert.deepEqual(domResult(platform, { authenticated: true, hiddenLogin: hidden, hiddenChallenge: hidden }), logged);
  });

  test(`${platform} passive status never opens, navigates or evaluates an absent platform tab`, async () => {
    let evaluated = 0; let navigated = 0;
    const page = { tabs: async () => [], goto: async () => navigated++, evaluate: async () => { evaluated++; return logged; } };
    const result = await runPlatformSession({ platform, operation: "status", page });
    assert.equal(result.loginState, "unknown"); assert.equal(evaluated, 0); assert.equal(navigated, 0);
  });

  test(`${platform} reads block before the adapter without current login and expire immediately after a login wall`, async () => {
    let phase = loggedOut; let reads = 0; const navigations = [];
    const page = { goto: async (url) => navigations.push(url), evaluate: async () => phase };
    const loadAdapter = async () => ({ access: "read", func: async () => { reads++; phase = loggedOut; return [{ text: "must not escape" }]; } });
    await assert.rejects(runPlatformSession({ platform, operation: "search", input: "fixture", page, loadAdapter }), { code: "CONNECTION_LOGIN_REQUIRED" });
    assert.equal(reads, 0);
    phase = { loginState: "unknown" };
    await assert.rejects(runPlatformSession({ platform, operation: "search", input: "fixture", page, loadAdapter }), { code: "CONNECTION_LOGIN_UNCONFIRMED" });
    assert.equal(reads, 0);
    phase = logged;
    await assert.rejects(runPlatformSession({ platform, operation: "search", input: "fixture", page, loadAdapter }), { code: "CONNECTION_LOGIN_REQUIRED" });
    assert.equal(reads, 1); assert.equal(navigations.length, 3);
  });

  test(`${platform} manual open uses the same page while logged out, and a recovered login resumes the original read`, async () => {
    let phase = loggedOut; let openUrl; let received;
    const page = { goto: async (url) => { openUrl = url; }, evaluate: async () => phase };
    const opened = await runPlatformSession({ platform, operation: "open", page });
    assert.equal(opened.connectionCreated, false); assert.equal(openUrl, opened.url);
    phase = logged;
    const result = await runPlatformSession({ platform, operation: "search", input: "original user query", page,
      loadAdapter: async () => ({ access: "read", func: async (actual, args) => { if (platform === "xiaohongshu") assert.equal(actual, page); received = args.query; return []; } }) });
    assert.equal(received, "original user query"); assert.equal(result.observation.searchReady, true);
  });

  test(`${platform} connected requires auth and both capabilities; a business auth error updates catalog without PA logout`, async () => {
    let phase = { loginState: "unknown" };
    const runner = { probe: async () => ({}), browserBridgeStatus: async () => ({ ready: true }),
      platformOperation: async (_platform, operation) => { if (operation === "status") return phase; throw Object.assign(new Error("请登录平台"), { code: "CONNECTION_LOGIN_REQUIRED", statusCode: 409 }); } };
    const provider = new Provider({ runner, now: () => 10_000, wait: async () => {} });
    assert.equal((await provider.status()).state, "degraded");
    phase = { ...logged, searchReady: false }; assert.equal((await provider.status()).state, "degraded");
    phase = logged; assert.equal((await provider.status()).state, "connected");
    await assert.rejects(provider.search("fixture"), { code: "CONNECTION_LOGIN_REQUIRED", statusCode: 409 });
    assert.equal(provider.catalogStatus().state, "needs_login");
    assert.equal((await provider.status()).state, "connected");
  });
}

test("social SDK processes use bounded stdin, stable Space-specific sessions, stripped secrets and serialized operations", async () => {
  const calls = []; const first = deferred();
  const runner = new OpenCliRunner({ command: "/fixture/opencli/dist/src/main.js", env: { PRIVATE_SITE_DATA_ROOT: "/space-a", OPEN_AGENT_BRIDGE_API_TOKEN: "secret" },
    executePlatform: async (_command, args, options) => { calls.push({ args, options, request: JSON.parse(options.input) }); if (calls.length === 1) await first.promise; return { stdout: JSON.stringify({ ok: true, result: logged }) }; } });
  const one = runner.platformOperation("twitter", "open"); const two = runner.platformOperation("twitter", "status");
  await Promise.resolve(); assert.equal(calls.length, 1); first.resolve(); await Promise.all([one, two]);
  assert.equal(calls.length, 2); assert.equal(calls[0].request.session, calls[1].request.session);
  assert.equal(calls[0].options.env.OPEN_AGENT_BRIDGE_API_TOKEN, undefined); assert.equal(calls[0].args.length, 2);
  let other;
  const second = new OpenCliRunner({ command: "/fixture/opencli/dist/src/main.js", env: { PRIVATE_SITE_DATA_ROOT: "/space-b" }, executePlatform: async (_command, _args, options) => { other = JSON.parse(options.input); return { stdout: '{"ok":true,"result":{}}' }; } });
  await second.platformOperation("twitter", "status"); assert.notEqual(other.session, calls[0].request.session);
});

test("pinned X SDK HTTP 401 becomes platform login-required; 403 and ambiguous HTML do not", async () => {
  const page = { goto: async () => {}, evaluate: async () => logged };
  for (const status of [401, 403]) {
    await assert.rejects(runPlatformSession({ platform: "twitter", operation: "search", input: "fixture", page,
      loadAdapter: async () => ({ access: "read", func: async () => { throw new Error(`HTTP ${status}: SearchTimeline fetch failed — private upstream detail`); } }) }),
    (error) => status === 401 ? error.code === "CONNECTION_LOGIN_REQUIRED" && !error.message.includes("private") : error.code !== "CONNECTION_LOGIN_REQUIRED");
  }
  await assert.rejects(runPlatformSession({ platform: "twitter", operation: "search", input: "fixture", page,
    loadAdapter: async () => ({ access: "read", func: async () => { throw Object.assign(new Error("HTML or WAF"), { code: "LOGIN_WALL" }); } }) }), { code: "CONNECTION_LOGIN_UNCONFIRMED" });
});

test("source and relocated immutable SDK entrypoint preserve the real child-process contract without browser access", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-social-sdk-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const release = path.join(root, "release"); const runtime = path.join(release, "runtime-fixture");
  const write = (name, body) => { const file = path.join(runtime, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); };
  write("package.json", '{"name":"@jackwener/opencli","version":"1.8.6","type":"module"}');
  write("dist/src/main.js", "");
  write("dist/src/runtime.js", `export const getBrowserFactory=()=>null; export async function browserSession(factory,fn,options){ if(process.env.OPEN_AGENT_BRIDGE_API_TOKEN || options.surface!=='adapter' || options.siteSession!=='persistent' || !options.session.startsWith('pa-social-'))throw Error('bad session');return fn({tabs:async()=>[],goto:async()=>{},evaluate:async()=>({loginState:'logged_in',searchReady:true,readReady:true})});}`);
  write("dist/src/browser/profile.js", "export const resolveProfileSelection=()=>undefined; export const profileRouteParams=()=>({});");
  write("dist/src/registry.js", "export const getRegistry=()=>globalThis.registry ||= new Map();");
  write("clis/twitter/shared.js", "export async function resolveTwitterOperationMetadata(page){return page.evaluate('fixture-public-metadata');}");
  for (const [site, names] of [["twitter", ["search", "thread"]], ["xiaohongshu", ["search", "note"]]]) for (const name of names) write(`clis/${site}/${name}.js`, `import{getRegistry}from'../../dist/src/registry.js';getRegistry().set('${site}/${name}',{access:'read',func:async(page,args)=>[{query:args.query||args['note-id']||args['tweet-id']}]});`);
  fs.mkdirSync(path.join(release, "scripts/lib"), { recursive: true });
  fs.copyFileSync(new URL("../../../scripts/opencli-platform-session.mjs", import.meta.url), path.join(release, "scripts/opencli-platform-session.mjs"));
  fs.copyFileSync(new URL("../../../scripts/lib/social-platform-session.mjs", import.meta.url), path.join(release, "scripts/lib/social-platform-session.mjs"));
  fs.copyFileSync(new URL("../../../scripts/lib/twitter-browser-credentials.mjs", import.meta.url), path.join(release, "scripts/lib/twitter-browser-credentials.mjs"));
  for (const releaseRoot of [undefined, release]) {
    const runner = new OpenCliRunner({ command: path.join(runtime, "dist/src/main.js"), env: { PRIVATE_SITE_RELEASE_ROOT: releaseRoot, PRIVATE_SITE_DATA_ROOT: path.join(root, "space"), OPEN_AGENT_BRIDGE_API_TOKEN: "must-not-leak" } });
    assert.equal((await runner.platformOperation("twitter", "status")).loginState, "unknown");
    assert.equal((await runner.platformOperation("twitter", "open")).opened, true);
    const result = await runner.platformOperation("twitter", "search", "unchanged query"); assert.equal(result.rows[0].query, "unchanged query");
  }
});
