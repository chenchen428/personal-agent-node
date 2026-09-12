import { randomBytes } from "node:crypto";

/** Preserve the pinned adapter API without transferring browser credentials. */
export function createTwitterReadPage(page, allowedScripts = []) {
  const marker = `PA_CSRF_PLACEHOLDER_${randomBytes(24).toString("hex")}`;
  const boundaryError = () => Object.assign(new Error("平台读取未通过凭据边界检查。"), { code: "CONNECTION_CREDENTIAL_BOUNDARY" });
  const assertSafeResult = (value) => {
    if (JSON.stringify(value)?.includes(marker)) throw boundaryError();
    return value;
  };
  const proxy = {
    async getCookies(options) {
      if (options?.url !== "https://x.com" || Object.keys(options).some((key) => key !== "url")) throw boundaryError();
      // The adapter only needs a nonempty ct0 placeholder. Never delegate this
      // call to page.getCookies or obtain auth_token in this Node process.
      return [{ name: "ct0", value: marker }];
    },
    async goto(url, options) {
      const target = new URL(url);
      if (target.origin !== "https://x.com" || target.href.includes(marker)) throw boundaryError();
      return page.goto(url, options);
    },
    wait: (...args) => page.wait(...args),
    async evaluate(source) {
      if (typeof source !== "string") throw boundaryError();
      if (!source.includes(marker)) {
        if (!allowedScripts.includes(source)) throw boundaryError();
        return assertSafeResult(await page.evaluate(source));
      }
      const header = `"X-Csrf-Token":${JSON.stringify(marker)}`;
      // Only the exact JSON header emitted by the audited 1.8.6 adapters may
      // receive the browser-local token; a marker in URL/body/code is rejected.
      if (source.split(marker).length !== 2 || !source.includes(header)) throw boundaryError();
      if (/\b(?:document|window|navigator|localStorage|sessionStorage|indexedDB|XMLHttpRequest|WebSocket|globalThis)\s*[.\[]|\b(?:eval|Function|btoa|atob)\s*\(/.test(source)) throw boundaryError();
      const request = source.replace(header, '"X-Csrf-Token":__paCsrf');
      const wrapped = `async () => {
        if (location.origin !== 'https://x.com') return { __paAuthRequired: true };
        let __paCsrf = '';
        try { const pair = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('ct0=')); if (pair) __paCsrf = decodeURIComponent(pair.slice(4)); } catch {}
        if (!__paCsrf) return { __paAuthRequired: true };
        const fetch = async (resource, init) => {
          const target = new URL(resource, location.href);
          if (target.origin !== 'https://x.com' || !/^\\/i\\/api\\/graphql\\/[A-Za-z0-9_-]+\\/(SearchTimeline|TweetDetail)$/.test(target.pathname) || target.href.includes(__paCsrf) || String(init?.body || '').includes(__paCsrf)) throw Error('blocked');
          return globalThis.fetch(target.toString(), init);
        };
        try {
          const value = await (${request})();
          if (JSON.stringify(value)?.includes(__paCsrf)) return { __paCredentialBoundaryRejected: true };
          return value;
        } catch { return { __paCredentialBoundaryRejected: true }; }
      }`;
      const result = await page.evaluate(wrapped);
      const value = result?.session && result?.data ? result.data : result;
      if (value?.__paAuthRequired) throw Object.assign(new Error("请在X官方页面登录后重试。"), { code: "CONNECTION_LOGIN_REQUIRED", statusCode: 401 });
      if (value?.__paCredentialBoundaryRejected) throw boundaryError();
      return assertSafeResult(result);
    },
  };
  return { page: proxy, assertSafeResult };
}
