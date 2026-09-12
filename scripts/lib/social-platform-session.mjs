import { createTwitterReadPage } from "./twitter-browser-credentials.mjs";

export const PLATFORMS = Object.freeze({
  xiaohongshu: { label: "小红书", home: "https://www.xiaohongshu.com/", login: "https://www.xiaohongshu.com/", host: "www.xiaohongshu.com", read: "note" },
  twitter: { label: "Twitter / X", home: "https://x.com/home", login: "https://x.com/i/flow/login", host: "x.com", read: "thread" },
});

// Fixed scripts return only booleans and enums. No cookies, storage, application
// state, account identifiers, page text, or request headers leave the browser.
export const PLATFORM_LOGIN_SCRIPTS = Object.freeze(Object.fromEntries(Object.entries(PLATFORMS).map(([id, platform]) => [id, `(() => {
  const unknown = { loginState: 'unknown', searchReady: false, readReady: false };
  if (location.protocol !== 'https:' || location.hostname !== ${JSON.stringify(platform.host)} || document.readyState === 'loading') return unknown;
  const visible = (element) => {
    if (!element || !element.getClientRects().length || element.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
    let right = Math.min(globalThis.innerWidth || document.documentElement.clientWidth, rect.right);
    let bottom = Math.min(globalThis.innerHeight || document.documentElement.clientHeight, rect.bottom);
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity || '1') <= 0) return false;
      if (node !== element && /hidden|clip|scroll|auto/.test(style.overflowX + style.overflowY)) {
        const clip = node.getBoundingClientRect();
        if (/hidden|clip|scroll|auto/.test(style.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
        if (/hidden|clip|scroll|auto/.test(style.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
      }
    }
    return right > left && bottom > top;
  };
  const any = (selector) => Array.from(document.querySelectorAll(selector)).some(visible);
  if (any('iframe[src*="captcha"], [id*="captcha"], [class*="captcha"], [data-testid="arkoseFrame"]') || /\\/(?:account\\/access|challenge|captcha)/.test(location.pathname)) return unknown;
  ${id === "xiaohongshu" ? `
  const loginWall = any('.login-container, .login-modal, .login-mask') || Array.from(document.querySelectorAll('button, [role="button"]')).some((element) => visible(element) && /^(登录|登录后查看搜索结果|登录后查看|请登录)$/.test((element.textContent || '').trim()));
  const account = Array.from(document.querySelectorAll('nav a, .side-bar a, .channel-list a, a.channel')).some((element) => visible(element) && /\\/user\\/profile\\//.test(element.getAttribute('href') || '') && /^(我|我的主页)$/.test((element.textContent || '').trim()));
  const search = any('input[placeholder*="搜索"], input[type="search"], [role="searchbox"]');` : `
  const loginWall = /^\\/i\\/flow\\/login/.test(location.pathname) || any('a[href="/login"], a[href="/i/flow/login"], input[autocomplete="username"]');
  const account = any('a[data-testid="AppTabBar_Profile_Link"]') && any('[data-testid="SideNav_AccountSwitcher_Button"]');
  const search = any('[data-testid="SearchBox_Search_Input"], a[data-testid="AppTabBar_Explore_Link"]');`}
  if (loginWall) return { loginState: 'logged_out', searchReady: false, readReady: false };
  if (!account) return unknown;
  return { loginState: 'logged_in', searchReady: search, readReady: any('main, [role="main"], .main-container, .feeds-container, #exploreFeeds') };
})()`])));

export function platformError(platform, code, statusCode) {
  const definition = PLATFORMS[platform];
  return Object.assign(new Error(code === "CONNECTION_LOGIN_REQUIRED"
    ? `请先在${definition.label}官方页面完成登录，再检测连接或重试。`
    : `暂时无法确认${definition.label}登录或读取状态，请在官方页面检查后重试。`), { code, statusCode, loginUrl: definition.login });
}

export function normalizePlatformObservation(value) {
  const source = value?.session && value?.data ? value.data : value;
  const loginState = ["logged_in", "logged_out", "unknown"].includes(source?.loginState) ? source.loginState : "unknown";
  return { loginState, searchReady: loginState === "logged_in" && source?.searchReady === true, readReady: loginState === "logged_in" && source?.readReady === true };
}

export async function runPlatformSession({ platform, operation, input = "", page, loadAdapter }) {
  const definition = PLATFORMS[platform];
  if (!definition || !["status", "open", "search", "read"].includes(operation)) throw new Error("Unsupported social browser operation");
  if (operation === "open") {
    await page.goto(definition.login);
    return { opened: true, url: definition.login, connectionCreated: false };
  }
  if (operation === "status") {
    const tabs = await page.tabs();
    const tab = Array.isArray(tabs) ? tabs.find((item) => {
      try { const url = new URL(item.url); return typeof item.page === "string" && url.protocol === "https:" && url.hostname === definition.host; } catch { return false; }
    }) : null;
    if (!tab || typeof page.setActivePage !== "function") return normalizePlatformObservation(null);
    page.setActivePage(tab.page);
  }
  if (["search", "read"].includes(operation)) await page.goto(definition.home);
  const inspect = async () => {
    let observation = normalizePlatformObservation(await page.evaluate(PLATFORM_LOGIN_SCRIPTS[platform]));
    for (let attempt = 0; operation !== "status" && observation.loginState === "unknown" && attempt < 3 && typeof page.wait === "function"; attempt += 1) {
      await page.wait(0.3);
      observation = normalizePlatformObservation(await page.evaluate(PLATFORM_LOGIN_SCRIPTS[platform]));
    }
    return observation;
  };
  const observation = await inspect();
  if (operation === "status") return observation;
  if (observation.loginState === "logged_out") throw platformError(platform, "CONNECTION_LOGIN_REQUIRED", 401);
  if (observation.loginState !== "logged_in") throw platformError(platform, "CONNECTION_LOGIN_UNCONFIRMED", 409);
  const adapter = await loadAdapter(platform, operation === "read" ? definition.read : "search");
  if (adapter.access !== "read" || typeof adapter.func !== "function") throw new Error("Social adapter must be read-only");
  const args = operation === "search" ? { query: input, limit: 20, filter: "top" }
    : platform === "xiaohongshu" ? { "note-id": input } : { "tweet-id": input, limit: 50, "top-by-engagement": 0 };
  try {
    const browserCredentials = platform === "twitter" ? createTwitterReadPage(page, adapter.allowedBrowserScripts) : null;
    const rows = await adapter.func(browserCredentials?.page || page, args);
    browserCredentials?.assertSafeResult(rows);
    const final = await inspect();
    if (final.loginState === "logged_out") throw platformError(platform, "CONNECTION_LOGIN_REQUIRED", 401);
    if (final.loginState !== "logged_in") throw platformError(platform, "CONNECTION_LOGIN_UNCONFIRMED", 409);
    if (!Array.isArray(rows)) throw new Error("Social adapter returned an invalid result");
    return { rows, observation: { ...final, [operation === "search" ? "searchReady" : "readReady"]: true } };
  } catch (error) {
    if (["AUTH_REQUIRED", "OPENCLI_AUTH_REQUIRED", "CONNECTION_LOGIN_REQUIRED"].includes(error?.code) || error?.statusCode === 401 || /^HTTP 401: (SearchTimeline|TweetDetail) fetch failed\b/.test(String(error?.message || ""))) throw platformError(platform, "CONNECTION_LOGIN_REQUIRED", 401);
    if (error?.code === "LOGIN_WALL") {
      const current = await inspect();
      if (current.loginState === "logged_out") throw platformError(platform, "CONNECTION_LOGIN_REQUIRED", 401);
      throw platformError(platform, "CONNECTION_LOGIN_UNCONFIRMED", 409);
    }
    throw error;
  }
}
