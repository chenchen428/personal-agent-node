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
    if (parts.length !== 5 || parts[0] !== "v2") return false;
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
    const payload = ["v2", expiresAt, crypto.randomBytes(18).toString("base64url"), encodedScope].join(".");
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
    const verifier = readVerifier(this.verifierFile);
    const credentialGeneration = verifier?.verifier
      || crypto.createHash("sha256").update(this.password).digest("base64url");
    const signingKey = crypto.createHmac("sha256", this.cookieSecret)
      .update("personal-agent-cookie-v2\0")
      .update(credentialGeneration)
      .digest();
    return crypto.createHmac("sha256", signingKey).update(payload).digest("base64url");
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
    :root{color-scheme:light;--canvas:#f4f4f1;--surface:#fff;--subtle:#f7f7f5;--ink:#20201f;--body:#555552;--muted:#858580;--faint:#b7b7b1;--line:#e7e7e3;--line-strong:#d9d9d4;--primary:#262625;--primary-hover:#111110;--accent:#cc785c;--danger:#c43a32;--danger-soft:#fbecea;--radius:14px;--control-radius:11px;--shadow:0 1px 2px rgba(0,0,0,.04),0 18px 45px rgba(0,0,0,.06);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Microsoft YaHei",sans-serif}
    *{box-sizing:border-box;letter-spacing:0}
    html,body{min-height:100%;margin:0}
    body{background:var(--canvas);color:var(--ink)}
    button,input{font:inherit}
    button{cursor:pointer}
    .auth-shell{min-height:100vh;min-height:100dvh;display:grid;grid-template-rows:auto 1fr auto;padding:max(20px,env(safe-area-inset-top)) max(24px,env(safe-area-inset-right)) max(18px,env(safe-area-inset-bottom)) max(24px,env(safe-area-inset-left));overflow:hidden}
    .auth-header,.auth-footer{width:min(1180px,100%);margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:20px}
    .brand{display:flex;align-items:center;gap:10px;color:var(--ink);text-decoration:none;font-size:13px;font-weight:680}
    .brand-mark{width:30px;height:30px;display:grid;place-items:center;border-radius:9px;background:var(--primary);color:#fff;font-size:12px;font-weight:750;letter-spacing:-.02em}
    .privacy{display:flex;align-items:center;gap:7px;color:var(--muted);font-size:12px}
    .privacy svg{width:14px;height:14px;color:var(--body)}
    .auth-main{width:min(1000px,100%);margin:auto;display:grid;grid-template-columns:minmax(280px,1fr) minmax(360px,420px);gap:clamp(64px,10vw,136px);align-items:center;padding:64px 0}
    .auth-intro{max-width:480px}
    .eyebrow{margin:0 0 18px;color:var(--accent);font-size:11px;font-weight:750;letter-spacing:.12em;text-transform:uppercase}
    h1{max-width:520px;margin:0;font-family:"Iowan Old Style","Songti SC","STSong",serif;font-size:clamp(48px,5vw,66px);font-weight:500;line-height:1.06;letter-spacing:-.035em}
    .intro-copy{max-width:410px;margin:24px 0 0;color:var(--body);font-size:15px;line-height:1.85}
    .intro-meta{display:flex;align-items:center;gap:9px;margin-top:30px;color:var(--muted);font-size:12px}
    .intro-meta:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 4px rgba(204,120,92,.12)}
    .auth-panel{position:relative;border:1px solid var(--line);border-radius:var(--radius);padding:34px;background:var(--surface);box-shadow:var(--shadow)}
    .panel-topline{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:30px}
    .panel-index{margin:0;color:var(--muted);font-size:10px;font-weight:720;letter-spacing:.11em;text-transform:uppercase}
    .host-badge{max-width:210px;overflow:hidden;border:1px solid var(--line);border-radius:999px;padding:5px 9px;background:var(--subtle);color:var(--muted);font-size:10px;text-overflow:ellipsis;white-space:nowrap}
    .auth-panel h2{margin:0 0 8px;font-family:"Iowan Old Style","Songti SC","STSong",serif;font-size:30px;font-weight:550;letter-spacing:-.02em}
    .panel-copy{margin:0 0 26px;color:var(--muted);font-size:13px;line-height:1.7}
    .field-label{display:block;margin:0 0 9px;font-size:12px;font-weight:650}
    .password-field{display:grid;grid-template-columns:1fr 46px;height:48px;border:1px solid var(--line-strong);border-radius:var(--control-radius);background:#fff;transition:border-color .16s,box-shadow .16s}
    .password-field:focus-within{border-color:var(--primary);box-shadow:0 0 0 3px rgba(38,38,37,.1)}
    .password-field input{width:100%;min-width:0;border:0;outline:0;padding:0 14px;background:transparent;color:var(--ink);font-size:15px}
    .password-field button{display:grid;place-items:center;border:0;border-left:1px solid var(--line);border-radius:0 10px 10px 0;background:transparent;color:var(--muted)}
    .password-field button:hover{background:var(--subtle);color:var(--ink)}
    .password-field button:focus-visible,.submit-button:focus-visible,.brand:focus-visible{outline:3px solid rgba(38,38,37,.18);outline-offset:2px}
    .password-field svg{width:18px;height:18px}
    .auth-error{display:grid;grid-template-columns:20px 1fr;gap:9px;align-items:start;margin:0 0 18px;padding:11px 12px;border-radius:9px;background:var(--danger-soft);color:var(--danger);font-size:12px}
    .auth-error span{width:18px;height:18px;display:grid;place-items:center;border:1px solid currentColor;border-radius:50%;font-size:10px;font-weight:800}
    .auth-error p{margin:0;line-height:1.5}
    .submit-button{width:100%;height:48px;margin-top:14px;display:flex;align-items:center;justify-content:center;gap:10px;padding:0 16px;border:1px solid var(--primary);border-radius:var(--control-radius);background:var(--primary);color:#fff;font-size:13px;font-weight:650;transition:background .16s,transform .16s}
    .submit-button:hover{background:var(--primary-hover)}
    .submit-button:active{transform:translateY(1px)}
    .submit-button:disabled{cursor:wait;opacity:.72}
    .submit-button svg{width:17px;height:17px}
    .session-note{display:flex;align-items:center;gap:7px;margin:16px 0 0;color:var(--muted);font-size:10px;line-height:1.5}
    .session-note svg{width:13px;height:13px;flex:0 0 auto}
    .auth-footer{color:var(--muted);font-size:11px}
    .host-label{max-width:70vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    @media(max-width:760px){.auth-shell{padding-right:max(16px,env(safe-area-inset-right));padding-left:max(16px,env(safe-area-inset-left));overflow:visible}.auth-header{min-height:40px}.privacy span{display:none}.auth-main{width:min(440px,100%);grid-template-columns:1fr;gap:28px;align-content:center;padding:42px 0}.auth-intro{padding:0 4px}.eyebrow{margin-bottom:12px}h1{font-size:40px;line-height:1.08}.intro-copy{margin-top:15px;font-size:13px;line-height:1.7}.intro-meta{display:none}.auth-panel{padding:26px 22px}.panel-topline{margin-bottom:24px}.host-badge{max-width:180px}.auth-panel h2{font-size:28px}.password-field,.submit-button{height:50px}.auth-footer{padding-top:8px}}
    @media(max-width:380px){.auth-main{padding:30px 0;gap:22px}h1{font-size:36px}.intro-copy{max-width:310px}.auth-panel{padding:23px 18px}.host-badge{max-width:150px}.auth-footer{font-size:10px}}
    @media(prefers-reduced-motion:no-preference){.auth-intro{animation:enter .36s ease-out both}.auth-panel{animation:enter .36s .06s ease-out both}@keyframes enter{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}}
  </style>
</head>
<body>
  <main class="auth-shell">
    <header class="auth-header">
      <a class="brand" href="/" aria-label="Personal Agent"><span class="brand-mark">PA</span><span>Personal Agent</span></a>
      <div class="privacy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg><span>安全访问</span></div>
    </header>
    <section class="auth-main">
      <div class="auth-intro">
        <p class="eyebrow">Private workspace</p>
        <h1>欢迎回来。</h1>
        <p class="intro-copy">连接到你的 Personal Agent，继续查看这台设备上的工作与结果。</p>
        <p class="intro-meta">安全连接 · 数据仍保留在你的设备</p>
      </div>
      <section class="auth-panel" aria-labelledby="login-title">
        <div class="panel-topline"><p class="panel-index">身份验证</p><span class="host-badge">${safeHost}</span></div>
        <h2 id="login-title">进入 Personal Agent</h2>
        <p class="panel-copy">请输入为远程访问设置的密码。</p>
        ${errorMarkup}
        <form method="post" action="/login" data-auth-form>
          <input type="hidden" name="return_to" value="${safeReturnTo}">
          <label class="field-label" for="password">访问密码</label>
          <div class="password-field">
            <input id="password" name="password" type="password" autocomplete="current-password" required autofocus aria-describedby="login-title">
            <button type="button" data-password-toggle aria-label="显示密码" title="显示密码"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2.1 12s3.6-6 9.9-6 9.9 6 9.9 6-3.6 6-9.9 6-9.9-6-9.9-6Z"/><circle cx="12" cy="12" r="2.6"/></svg></button>
          </div>
          <button class="submit-button" type="submit"><span data-submit-label>继续</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
        </form>
        <p class="session-note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg>登录状态仅用于当前访问地址</p>
      </section>
    </section>
    <footer class="auth-footer"><span class="host-label">Personal Agent · 私人工作空间</span><span>© ${new Date().getUTCFullYear()}</span></footer>
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
