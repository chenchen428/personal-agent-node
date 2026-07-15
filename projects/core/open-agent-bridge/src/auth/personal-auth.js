import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PERSONAL_AUTH_DEFAULT_TTL_SECONDS = 365 * 24 * 60 * 60;

export class PersonalAuth {
  constructor({
    password,
    cookieSecret,
    cookieName = "__Host-personal_agent",
    ttlSeconds = PERSONAL_AUTH_DEFAULT_TTL_SECONDS,
    cookieDomains = [],
    cookieHostOnly = true,
    apiToken = "",
    now = () => Date.now(),
    setupBootstrapFile = "",
    verifierFile = "",
  } = {}) {
    this.password = String(password || "");
    this.cookieSecret = String(cookieSecret || "");
    this.cookieName = /^(?:__Host-)?[A-Za-z0-9_-]+$/.test(cookieName) ? cookieName : "__Host-personal_agent";
    this.ttlSeconds = normalizeTtl(ttlSeconds);
    this.cookieDomains = [...new Set(cookieDomains.map(normalizeDomain).filter(Boolean))]
      .sort((left, right) => right.length - left.length);
    this.cookieHostOnly = cookieHostOnly !== false;
    this.apiToken = String(apiToken || "");
    this.now = now;
    this.setupBootstrapFile = String(setupBootstrapFile || "");
    this.verifierFile = String(verifierFile || "");
    if (!this.password && !readVerifier(this.verifierFile)) throw new Error("PERSONAL_AGENT_AUTH_PASSWORD or a local auth verifier is required");
    if (!this.cookieSecret) throw new Error("PERSONAL_AGENT_AUTH_COOKIE_SECRET is required");
  }

  async handle(request, response, url) {
    if (url.pathname === "/_auth/check") {
      this.handleCheck(request, response);
      return true;
    }
    if (url.pathname === "/login") {
      await this.handleLogin(request, response, url);
      return true;
    }
    if (url.pathname === "/setup/bootstrap") {
      this.handleSetupBootstrap(request, response, url);
      return true;
    }
    if (url.pathname === "/logout") {
      this.handleLogout(request, response);
      return true;
    }
    return false;
  }

  handleCheck(request, response) {
    if (this.isBearerAuthorized(request) || this.isCookieAuthorized(request)) {
      response.writeHead(204, authResponseHeaders());
      response.end();
      return;
    }
    response.writeHead(401, authResponseHeaders());
    response.end();
  }

  async handleLogin(request, response, url) {
    const returnTo = normalizeReturnTo(url.searchParams.get("return_to"));
    if (request.method === "GET" || request.method === "HEAD") {
      sendLoginPage(response, { returnTo, host: requestHost(request), head: request.method === "HEAD" });
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, { ...authResponseHeaders(), Allow: "GET, HEAD, POST" });
      response.end();
      return;
    }

    const form = await readForm(request);
    const submittedReturnTo = normalizeReturnTo(form.get("return_to") || returnTo);
    if (!this.matchesPassword(form.get("password") || "")) {
      sendLoginPage(response, {
        returnTo: submittedReturnTo,
        host: requestHost(request),
        error: "密码不正确，请重新输入。",
        statusCode: 401,
      });
      return;
    }

    const cookie = this.issueCookie(request);
    response.writeHead(303, {
      ...authResponseHeaders(),
      Location: submittedReturnTo,
      "Set-Cookie": cookie,
    });
    response.end();
  }

  matchesPassword(candidate) {
    const verifier = readVerifier(this.verifierFile);
    if (verifier) return verifyPasswordVerifier(candidate, verifier);
    return timingSafeTextEqual(candidate, this.password);
  }

  handleLogout(request, response) {
    response.writeHead(303, {
      ...authResponseHeaders(),
      Location: "/login",
      "Set-Cookie": this.clearCookie(request),
    });
    response.end();
  }

  handleSetupBootstrap(request, response, url) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { ...authResponseHeaders(), Allow: "GET, HEAD" });
      response.end();
      return;
    }
    const sourceAddress = String(request.headers["x-real-ip"] || request.socket?.remoteAddress || "").replace(/^::ffff:/, "");
    const token = String(url.searchParams.get("token") || "");
    const document = readBootstrap(this.setupBootstrapFile);
    const valid = ["127.0.0.1", "::1"].includes(sourceAddress)
      && /^[A-Za-z0-9_-]{43,128}$/.test(token)
      && document?.schemaVersion === 1
      && Number.isFinite(Date.parse(document.expiresAt))
      && Date.parse(document.expiresAt) > this.now()
      && timingSafeTextEqual(document.sha256 || "", crypto.createHash("sha256").update(token).digest("hex"));
    if (!valid) {
      response.writeHead(401, authResponseHeaders());
      response.end();
      return;
    }
    const consumed = `${this.setupBootstrapFile}.consumed-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
    try {
      fs.renameSync(this.setupBootstrapFile, consumed);
      fs.rmSync(consumed, { force: true });
    }
    catch {
      response.writeHead(409, authResponseHeaders());
      response.end();
      return;
    }
    response.writeHead(303, {
      ...authResponseHeaders(),
      Location: "/app/setup",
      "Set-Cookie": this.issueCookie(request),
    });
    response.end();
  }

  isBearerAuthorized(request) {
    return Boolean(this.apiToken) && String(request.headers.authorization || "") === `Bearer ${this.apiToken}`;
  }

  isCookieAuthorized(request) {
    const token = readCookie(request.headers.cookie, this.cookieName);
    if (!token) return false;
    const host = requestHost(request);
    const scope = this.scopeForHost(host);
    const parts = token.split(".");
    if (parts.length !== 5 || parts[0] !== "v1") return false;
    const [version, expiresText, nonce, encodedScope, signature] = parts;
    const expiresAt = Number(expiresText);
    const nowSeconds = Math.floor(this.now() / 1000);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= nowSeconds || expiresAt > nowSeconds + this.ttlSeconds + 60) return false;
    if (!/^[A-Za-z0-9_-]{16,}$/.test(nonce)) return false;
    let tokenScope = "";
    try {
      tokenScope = Buffer.from(encodedScope, "base64url").toString("utf8");
    } catch {
      return false;
    }
    if (tokenScope !== scope) return false;
    const payload = [version, expiresText, nonce, encodedScope].join(".");
    return timingSafeTextEqual(signature, this.sign(payload));
  }

  issueCookie(request) {
    const now = this.now();
    const expiresAt = Math.floor(now / 1000) + this.ttlSeconds;
    const scope = this.scopeForHost(requestHost(request));
    const encodedScope = Buffer.from(scope).toString("base64url");
    const payload = ["v1", expiresAt, crypto.randomBytes(18).toString("base64url"), encodedScope].join(".");
    const value = `${payload}.${this.sign(payload)}`;
    return serializeCookie(this.cookieName, value, {
      maxAge: this.ttlSeconds,
      expires: new Date(now + this.ttlSeconds * 1000),
      domain: this.cookieDomainForHost(requestHost(request)),
      secure: this.cookieName.startsWith("__Host-") || requestProtocol(request) === "https",
    });
  }

  clearCookie(request) {
    return serializeCookie(this.cookieName, "", {
      maxAge: 0,
      expires: new Date(0),
      domain: this.cookieDomainForHost(requestHost(request)),
      secure: this.cookieName.startsWith("__Host-") || requestProtocol(request) === "https",
    });
  }

  scopeForHost(host) {
    if (this.cookieHostOnly) return host || "localhost";
    return this.cookieDomains.find((domain) => host === domain || host.endsWith(`.${domain}`)) || host || "localhost";
  }

  cookieDomainForHost(host) {
    if (this.cookieHostOnly) return "";
    const scope = this.cookieDomains.find((domain) => host === domain || host.endsWith(`.${domain}`));
    return scope ? `.${scope}` : "";
  }

  sign(payload) {
    return crypto.createHmac("sha256", this.cookieSecret).update(payload).digest("base64url");
  }
}

function readBootstrap(filePath) {
  if (!filePath) return null;
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch { return null; }
}

export function createPasswordVerifier(password, { salt = crypto.randomBytes(16) } = {}) {
  const normalized = String(password || "");
  if (normalized.length < 12 || normalized.length > 256) throw new Error("Local access password must contain 12 to 256 characters");
  const saltBuffer = Buffer.isBuffer(salt) ? salt : Buffer.from(salt);
  if (saltBuffer.length < 16) throw new Error("Local access password salt is too short");
  const parameters = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
  const derived = crypto.scryptSync(normalized, saltBuffer, 32, parameters);
  return {
    schemaVersion: 1,
    algorithm: "scrypt",
    parameters: { N: parameters.N, r: parameters.r, p: parameters.p, keyLength: 32 },
    salt: saltBuffer.toString("base64url"),
    verifier: derived.toString("base64url"),
  };
}

export function writePasswordVerifier(filePath, password) {
  const document = createPasswordVerifier(password);
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  try { fs.renameSync(temporary, filePath); } finally { fs.rmSync(temporary, { force: true }); }
  try { fs.chmodSync(filePath, 0o600); } catch {}
  return document;
}

export function verifyPasswordVerifier(password, document) {
  try {
    if (document?.schemaVersion !== 1 || document.algorithm !== "scrypt") return false;
    const { N, r, p, keyLength } = document.parameters || {};
    if (N !== 32768 || r !== 8 || p !== 1 || keyLength !== 32) return false;
    const salt = Buffer.from(String(document.salt || ""), "base64url");
    const expected = Buffer.from(String(document.verifier || ""), "base64url");
    if (salt.length < 16 || expected.length !== keyLength) return false;
    const actual = crypto.scryptSync(String(password || ""), salt, keyLength, { N, r, p, maxmem: 64 * 1024 * 1024 });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}

function readVerifier(filePath) {
  if (!filePath) return null;
  try {
    const document = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return document?.schemaVersion === 1 && document.algorithm === "scrypt" ? document : null;
  } catch { return null; }
}

function sendLoginPage(response, { returnTo, host, error = "", statusCode = 200, head = false }) {
  const nonce = crypto.randomBytes(16).toString("base64url");
  const html = renderLoginPage({ returnTo, host, error, nonce });
  response.writeHead(statusCode, {
    ...authResponseHeaders(),
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html),
    "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
  });
  response.end(head ? undefined : html);
}

export function renderLoginPage({ returnTo = "/", host = "personal-agent.local", error = "", nonce = "test-nonce" } = {}) {
  const safeReturnTo = escapeAttr(normalizeReturnTo(returnTo));
  const safeHost = escapeHtml(normalizeHost(host) || "personal-agent.local");
  const errorMarkup = error
    ? `<div class="auth-error" role="alert"><span aria-hidden="true">!</span><p>${escapeHtml(error)}</p></div>`
    : "";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="light">
  <title>登录 · Personal Agent</title>
  <style nonce="${escapeAttr(nonce)}">
    :root{color-scheme:light;--paper:#f6f7f5;--surface:#ffffff;--ink:#171918;--muted:#68716c;--line:#d9dedb;--forest:#16624c;--forest-dark:#0e4938;--blue:#dfeaf6;--signal:#c95032;--shadow:0 24px 70px rgba(23,25,24,.11);font-family:"Avenir Next","PingFang SC","Hiragino Sans GB",sans-serif}
    *{box-sizing:border-box;letter-spacing:0}
    html,body{min-height:100%;margin:0}
    body{background:var(--paper);color:var(--ink)}
    button,input{font:inherit}
    button{cursor:pointer}
    .auth-shell{min-height:100vh;min-height:100dvh;display:grid;grid-template-rows:auto 1fr auto;padding:max(22px,env(safe-area-inset-top)) max(22px,env(safe-area-inset-right)) max(20px,env(safe-area-inset-bottom)) max(22px,env(safe-area-inset-left));position:relative;overflow:hidden}
    .auth-shell:before{content:"";position:absolute;inset:0 auto 0 0;width:8px;background:var(--forest)}
    .auth-header,.auth-footer{width:min(1120px,100%);margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:20px}
    .brand{display:flex;align-items:center;gap:11px;color:var(--ink);text-decoration:none;font-size:13px;font-weight:700;text-transform:uppercase}
    .brand-mark{width:28px;height:28px;display:grid;place-items:center;background:var(--ink);color:#fff;border-radius:6px;font-family:"Iowan Old Style","Songti SC",serif;font-size:15px}
    .privacy{display:flex;align-items:center;gap:7px;color:var(--muted);font-size:12px}
    .privacy svg{width:15px;height:15px;color:var(--forest)}
    .auth-main{width:min(1120px,100%);margin:auto;display:grid;grid-template-columns:minmax(260px,1fr) minmax(340px,430px);gap:clamp(54px,10vw,150px);align-items:center;padding:48px 0}
    .auth-intro{max-width:520px}
    .eyebrow{margin:0 0 18px;color:var(--signal);font-size:12px;font-weight:800;text-transform:uppercase}
    h1{margin:0;font-family:"Iowan Old Style","Songti SC",serif;font-size:64px;font-weight:500;line-height:1.04}
    .intro-rule{width:72px;height:3px;margin:28px 0 22px;background:var(--forest)}
    .intro-copy{max-width:380px;margin:0;color:var(--muted);font-size:16px;line-height:1.8}
    .auth-panel{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:clamp(28px,5vw,44px);box-shadow:var(--shadow);position:relative}
    .auth-panel:after{content:"";position:absolute;right:18px;top:-7px;width:38px;height:14px;background:var(--blue);border:1px solid #c7d7e8}
    .panel-index{margin:0 0 34px;color:var(--muted);font-size:11px;font-weight:700;text-transform:uppercase}
    .auth-panel h2{margin:0 0 8px;font-family:"Iowan Old Style","Songti SC",serif;font-size:30px;font-weight:600}
    .panel-copy{margin:0 0 30px;color:var(--muted);font-size:14px;line-height:1.7}
    .field-label{display:block;margin:0 0 10px;font-size:13px;font-weight:700}
    .password-field{display:grid;grid-template-columns:1fr 46px;height:52px;border:1px solid #bfc7c2;border-radius:6px;background:#fff;transition:border-color .18s,box-shadow .18s}
    .password-field:focus-within{border-color:var(--forest);box-shadow:0 0 0 3px rgba(22,98,76,.14)}
    .password-field input{width:100%;min-width:0;border:0;outline:0;padding:0 15px;background:transparent;color:var(--ink);font-size:16px}
    .password-field button{display:grid;place-items:center;border:0;border-left:1px solid var(--line);background:transparent;color:var(--muted);border-radius:0 5px 5px 0}
    .password-field button:hover{background:#f1f4f2;color:var(--ink)}
    .password-field svg{width:19px;height:19px}
    .auth-error{display:grid;grid-template-columns:22px 1fr;gap:9px;align-items:start;margin:0 0 18px;padding:11px 12px;border-left:3px solid var(--signal);background:#fff1ed;color:#7d2d1c;font-size:13px}
    .auth-error span{width:18px;height:18px;display:grid;place-items:center;border:1px solid currentColor;border-radius:50%;font-size:11px;font-weight:800}
    .auth-error p{margin:0;line-height:1.5}
    .submit-button{width:100%;height:52px;margin-top:18px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 17px;border:1px solid var(--forest);border-radius:6px;background:var(--forest);color:#fff;font-weight:700;transition:background .18s,transform .18s}
    .submit-button:hover{background:var(--forest-dark)}
    .submit-button:active{transform:translateY(1px)}
    .submit-button:disabled{cursor:wait;opacity:.72}
    .submit-button svg{width:19px;height:19px}
    .auth-footer{color:var(--muted);font-size:11px}
    .host-label{max-width:70vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    @media(max-width:760px){.auth-shell{padding-left:max(24px,env(safe-area-inset-left))}.auth-header{align-items:flex-start}.privacy span{display:none}.auth-main{grid-template-columns:1fr;gap:34px;padding:36px 0}.auth-intro{padding-top:8px}h1{font-size:46px}.intro-rule{margin:20px 0 15px}.intro-copy{font-size:14px;line-height:1.65}.auth-panel{padding:28px 22px}.panel-index{margin-bottom:24px}.auth-footer{padding-top:18px}}
    @media(max-width:380px){h1{font-size:40px}.auth-panel h2{font-size:27px}.auth-shell{padding-right:16px;padding-left:24px}.auth-panel{padding:24px 18px}}
    @media(prefers-reduced-motion:no-preference){.auth-intro{animation:enter .42s ease-out both}.auth-panel{animation:enter .42s .08s ease-out both}@keyframes enter{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}}
  </style>
</head>
<body>
  <main class="auth-shell">
    <header class="auth-header">
      <a class="brand" href="/" aria-label="Personal Agent"><span class="brand-mark">PA</span><span>Personal Agent</span></a>
      <div class="privacy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg><span>Private access</span></div>
    </header>
    <section class="auth-main">
      <div class="auth-intro">
        <p class="eyebrow">Personal space</p>
        <h1>回来就好。</h1>
        <div class="intro-rule" aria-hidden="true"></div>
        <p class="intro-copy">你的数据和助手都留在这台设备。输入访问密码后继续。</p>
      </div>
      <section class="auth-panel" aria-labelledby="login-title">
        <p class="panel-index">Access / 01</p>
        <h2 id="login-title">验证身份</h2>
        <p class="panel-copy">无需用户名，只需要你的访问密码。</p>
        ${errorMarkup}
        <form method="post" action="/login" data-auth-form>
          <input type="hidden" name="return_to" value="${safeReturnTo}">
          <label class="field-label" for="password">访问密码</label>
          <div class="password-field">
            <input id="password" name="password" type="password" autocomplete="current-password" required autofocus aria-describedby="login-title">
            <button type="button" data-password-toggle aria-label="显示密码" title="显示密码"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2.1 12s3.6-6 9.9-6 9.9 6 9.9 6-3.6 6-9.9 6-9.9-6-9.9-6Z"/><circle cx="12" cy="12" r="2.6"/></svg></button>
          </div>
          <button class="submit-button" type="submit"><span data-submit-label>进入空间</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
        </form>
      </section>
    </section>
    <footer class="auth-footer"><span class="host-label">${safeHost}</span><span>© ${new Date().getUTCFullYear()}</span></footer>
  </main>
  <script nonce="${escapeAttr(nonce)}">
    const input=document.querySelector('#password');const toggle=document.querySelector('[data-password-toggle]');toggle?.addEventListener('click',()=>{const visible=input.type==='text';input.type=visible?'password':'text';toggle.setAttribute('aria-label',visible?'显示密码':'隐藏密码');toggle.setAttribute('title',visible?'显示密码':'隐藏密码');input.focus()});document.querySelector('[data-auth-form]')?.addEventListener('submit',event=>{const button=event.currentTarget.querySelector('.submit-button');const label=event.currentTarget.querySelector('[data-submit-label]');button.disabled=true;if(label)label.textContent='验证中…'});
  </script>
</body>
</html>`;
}

function authResponseHeaders() {
  return {
    "Cache-Control": "no-store, max-age=0",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

async function readForm(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16 * 1024) throw new Error("Login request is too large");
    chunks.push(buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function requestHost(request) {
  return normalizeHost(request.headers["x-forwarded-host"] || request.headers.host || "localhost");
}

function requestProtocol(request) {
  return String(request.headers["x-forwarded-proto"] || "http").split(",")[0].trim().toLowerCase();
}

function normalizeHost(value) {
  const text = String(value || "").split(",")[0].trim().toLowerCase();
  if (text.startsWith("[")) return text.slice(1, text.indexOf("]"));
  return text.split(":")[0];
}

function normalizeDomain(value) {
  return String(value || "").trim().toLowerCase().replace(/^\.+/, "").replace(/\.+$/, "");
}

function normalizeTtl(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 60 ? parsed : PERSONAL_AUTH_DEFAULT_TTL_SECONDS;
}

function normalizeReturnTo(value) {
  const text = String(value || "/").trim();
  if (!text.startsWith("/") || text.startsWith("//") || text.includes("\\") || /%(?:2e|2f|5c)/i.test(text) || text.startsWith("/login") || text.startsWith("/logout")) return "/";
  return text.slice(0, 2048);
}

function readCookie(header, name) {
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    return part.slice(index + 1).trim();
  }
  return "";
}

function serializeCookie(name, value, { maxAge, expires, domain, secure }) {
  const parts = [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
    `Expires=${expires.toUTCString()}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (domain) parts.push(`Domain=${domain}`);
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function timingSafeTextEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
