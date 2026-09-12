import assert from "node:assert/strict";
import test, { after } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OpenCliAction } from "../core/app/src/components/desktop-v627/opencli-action.tsx";
import { browserPlatformStatus, createBrowserPlatformConnection } from "../core/app/src/components/desktop-v627/browser-platform-connection.ts";

// The root test runner uses classic JSX; the app build uses its own JSX config.
const previousReact = globalThis.React;
globalThis.React = React;
after(() => { if (previousReact === undefined) delete globalThis.React; else globalThis.React = previousReact; });

const loggedOut = { id: "xiaohongshu", name: "小红书", state: "needs_login", statusLabel: "未连接 · 请登录", details: { browserReady: true, loginState: "logged_out", searchReady: false, readReady: false } };
const connected = { ...loggedOut, state: "connected", details: { browserReady: true, loginState: "logged_in", searchReady: true, readReady: true } };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("the logged-out view offers human browser login and distinguishes environment, login and search", () => {
  const markup = renderToStaticMarkup(createElement(OpenCliAction, { connection: loggedOut, refresh: async () => {} }));
  for (const label of ["在浏览器登录", "重新检测", "浏览器环境", "平台登录", "搜索与阅读", "尚未登录", "暂不可用"]) assert.ok(markup.includes(label));
  assert.doesNotMatch(markup, /<strong>小红书 已连接<\/strong>|type="password"|name="cookie"/);
});

test("only verified platform access renders the completed connection view", () => {
  const markup = renderToStaticMarkup(createElement(OpenCliAction, { connection: connected, refresh: async () => {} }));
  assert.match(markup, /<strong>小红书 已连接<\/strong>/);
  assert.match(markup, /已确认登录/);
  assert.doesNotMatch(markup, />在浏览器登录</);
});

test("browser readiness alone never presents a platform as connected or searchable", () => {
  assert.equal(browserPlatformStatus({ ...loggedOut, state: "ready", details: { browserReady: true } }).connected, false);
  assert.equal(browserPlatformStatus({ ...connected, details: { ...connected.details, loginState: "logged_out" } }).connected, false);
  assert.equal(browserPlatformStatus({ ...connected, details: { ...connected.details, searchReady: false } }).connected, false);
  assert.equal(browserPlatformStatus({ ...connected, details: { ...connected.details, readReady: false } }).connected, false);
  assert.equal(browserPlatformStatus(connected).connected, true);
});

test("opening a platform waits for human login and stops only after server-confirmed access", async (t) => {
  const history = []; const urls = []; let checks = 0; let refreshes = 0;
  let complete;
  const finished = new Promise((resolve) => { complete = resolve; });
  const flow = createBrowserPlatformConnection({ initial: loggedOut, intervalMs: 1, timeoutMs: 500,
    publish: (value) => { history.push(value); if (browserPlatformStatus(value.connection).connected) complete(); },
    refresh: async () => { refreshes++; },
    request: async (url, init) => { urls.push([url, init.method || "GET"]); return init.method === "POST" ? { opened: true } : { connection: ++checks > 1 ? connected : loggedOut }; },
  });
  t.after(() => flow.dispose());
  await flow.open(true);
  assert.equal(history.at(-1).phase, "waiting");
  assert.equal(browserPlatformStatus(history.at(-1).connection).connected, false);
  await finished; await delay(10);
  assert.equal(checks, 2); assert.equal(refreshes, 1);
  assert.deepEqual(urls[0], ["/api/connections/xiaohongshu/open", "POST"]);
  assert.equal(history.at(-1).phase, "idle");
});

test("cancelling login invalidates an in-flight successful response", async () => {
  const history = []; let resolveRead; let signal; let started;
  const reading = new Promise((resolve) => { started = resolve; });
  const flow = createBrowserPlatformConnection({ initial: loggedOut, intervalMs: 1, timeoutMs: 500, publish: (value) => history.push(value), refresh: async () => {},
    request: async (_url, init) => { if (init.method === "POST") return { opened: true }; signal = init.signal; started(); return new Promise((resolve) => { resolveRead = resolve; }); },
  });
  await flow.open(true); await reading;
  flow.cancel(); const count = history.length;
  assert.equal(signal.aborted, true);
  resolveRead({ connection: connected }); await delay(5);
  assert.equal(history.length, count);
  assert.equal(browserPlatformStatus(history.at(-1).connection).connected, false);
  flow.dispose();
});

test("a new check supersedes an older check even when its transport ignores abort", async () => {
  const history = []; let resolveOld; let checks = 0;
  const flow = createBrowserPlatformConnection({ initial: loggedOut, publish: (value) => history.push(value), refresh: async () => {},
    request: async () => ++checks === 1 ? new Promise((resolve) => { resolveOld = resolve; }) : { connection: loggedOut },
  });
  const old = flow.check(); await flow.check(); resolveOld({ connection: connected }); await old;
  assert.equal(browserPlatformStatus(history.at(-1).connection).connected, false);
  flow.dispose();
});

test("temporary polling errors remain unconfirmed and bounded without inventing login success", async () => {
  const history = []; let timedOut;
  const finished = new Promise((resolve) => { timedOut = resolve; });
  const flow = createBrowserPlatformConnection({ initial: loggedOut, intervalMs: 1, timeoutMs: 25,
    publish: (value) => { history.push(value); if (value.message.startsWith("暂未确认登录")) timedOut(); }, refresh: async () => {},
    request: async (_url, init) => { if (init.method === "POST") return { opened: true }; throw new Error("temporary transport failure"); },
  });
  await flow.open(true); await finished;
  assert.equal(history.at(-1).phase, "idle");
  assert.equal(history.at(-1).connection.details.loginState, "unknown");
  assert.equal(history.some((value) => browserPlatformStatus(value.connection).connected), false);
  flow.dispose();
});

test("authoritative logout replaces a formerly connected platform", async () => {
  let snapshot;
  const flow = createBrowserPlatformConnection({ initial: connected, publish: (value) => { snapshot = value; }, refresh: async () => {}, request: async () => ({ connection: loggedOut }) });
  await flow.check();
  assert.equal(browserPlatformStatus(snapshot.connection).connected, false);
  assert.match(browserPlatformStatus(snapshot.connection).label, /请登录/);
  flow.dispose();
});
