import crypto from "node:crypto";
import { XiaohongshuVerificationClient } from "./verification-client.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const SESSION_TTL_MS = 4 * 60 * 1000;
const READ_INTERVAL_MS = 2_500;

export class XiaohongshuChannel {
  constructor({ baseUrl = "http://127.0.0.1:18060", fetchImpl = fetch, now = () => Date.now(), logger = console, onSessionState = async () => {}, verificationClient } = {}) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.logger = logger;
    this.onSessionState = onSessionState;
    this.verificationClient = verificationClient || new XiaohongshuVerificationClient({ baseUrl: this.baseUrl });
    this.sessions = new Map();
    this.statusPromise = null;
    this.lastReadAt = 0;
    this.readQueue = Promise.resolve();
  }

  async status() {
    if (!this.statusPromise) {
      this.statusPromise = this.checkStatus().finally(() => {
        this.statusPromise = null;
      });
    }
    return this.statusPromise;
  }

  async checkStatus() {
    this.pruneSessions();
    try {
      await this.request("/health", { timeoutMs: 5_000 });
    } catch (error) {
      return this.statusPayload("offline", false, "小红书运行时不可用", safeError(error));
    }
    try {
      const data = await this.request("/api/v1/login/status", { timeoutMs: 60_000 });
      const login = unwrapData(data);
      const loggedIn = login?.is_logged_in === true;
      const loginState = normalizeLoginState(login?.login_state);
      return this.statusPayload(loggedIn ? "logged_in" : "needs_login", loggedIn, loggedIn ? "已登录" : "需要扫码登录", "", loginState);
    } catch (error) {
      return this.statusPayload("error", false, "登录状态检测失败", safeError(error));
    }
  }

  async startLogin() {
    this.pruneSessions();
    const response = await this.request("/api/v1/login/qrcode", { timeoutMs: 45_000 });
    const data = unwrapData(response);
    const loggedIn = data?.is_logged_in === true;
    const qrImage = loggedIn ? "" : validateQrImage(data?.img);
    const session = crypto.randomBytes(32).toString("base64url");
    const expiresAt = this.now() + parseDuration(data?.timeout, SESSION_TTL_MS);
    const loginSession = { session, status: loggedIn ? "confirmed" : "pending", expiresAt, notified: new Set() };
    this.sessions.set(session, loginSession);
    await this.notifySessionState(loginSession);
    return {
      ok: true,
      provider: "xiaohongshu",
      session,
      status: loggedIn ? "confirmed" : "pending",
      expiresAt: new Date(expiresAt).toISOString(),
      qrImage,
    };
  }

  async pollLogin(sessionId) {
    this.pruneSessions();
    const session = this.sessions.get(String(sessionId || ""));
    if (!session) return { ok: true, provider: "xiaohongshu", status: "missing" };
    if (session.status === "confirmed") return this.sessionPayload(session);
    if (session.expiresAt <= this.now()) {
      session.status = "expired";
      await this.notifySessionState(session);
      return this.sessionPayload(session);
    }
    const status = await this.status();
    if (status.loggedIn) session.status = "confirmed";
    else if (status.loginState === "expired") session.status = "expired";
    else if (status.loginState === "scanned" || status.loginState === "verification_required") {
      session.status = status.loginState;
    } else if (session.status === "scanned" || session.status === "verification_required") {
      session.status = "pending";
    } else if (status.state === "offline" || status.state === "error") session.status = "error";
    await this.notifySessionState(session);
    return { ...this.sessionPayload(session), channel: status };
  }

  async submitVerificationCode(sessionId, code) {
    this.pruneSessions();
    const session = this.sessions.get(String(sessionId || ""));
    if (!session || !["pending", "scanned", "verification_required"].includes(session.status) || session.expiresAt <= this.now()) {
      throw new ChannelInputError("小红书登录会话已失效，请重新扫码。" );
    }
    const normalized = String(code || "").trim();
    if (!/^\d{4,8}$/.test(normalized)) throw new ChannelInputError("验证码格式无效。" );
    await this.verificationClient.submit(normalized);
    return { ok: true, provider: "xiaohongshu", session: session.session, status: "submitted" };
  }

  async logout() {
    await this.request("/api/v1/login/cookies", { method: "DELETE" });
    this.sessions.clear();
    return { ok: true, provider: "xiaohongshu", state: "needs_login" };
  }

  async search(keyword) {
    const normalized = String(keyword || "").trim();
    if (!normalized || normalized.length > 80) throw new ChannelInputError("搜索词长度必须在 1 到 80 个字符之间");
    return this.withReadSpacing(async () => {
      const response = await this.request("/api/v1/feeds/search", {
        method: "POST",
        body: { keyword: normalized },
        timeoutMs: 120_000,
      });
      const result = unwrapData(response) || {};
      return {
        ok: true,
        provider: "xiaohongshu",
        keyword: normalized,
        feeds: Array.isArray(result.feeds) ? result.feeds.map(normalizeFeed).filter(Boolean) : [],
        count: Number(result.count || (Array.isArray(result.feeds) ? result.feeds.length : 0)),
      };
    });
  }

  async detail({ feedId, xsecToken }) {
    const id = String(feedId || "").trim();
    const token = String(xsecToken || "").trim();
    if (!id || id.length > 128) throw new ChannelInputError("笔记 ID 无效");
    if (!token || token.length > 2048) throw new ChannelInputError("xsec_token 无效，请先通过搜索获取笔记");
    return this.withReadSpacing(async () => {
      const response = await this.request("/api/v1/feeds/detail", {
        method: "POST",
        body: { feed_id: id, xsec_token: token, load_all_comments: false },
        timeoutMs: 120_000,
      });
      const result = unwrapData(response) || {};
      return { ok: true, provider: "xiaohongshu", feedId: id, detail: result.data || result };
    });
  }

  statusPayload(state, loggedIn, label, error, loginState = "") {
    return {
      ok: true,
      provider: "xiaohongshu",
      label: "小红书",
      state,
      loggedIn,
      statusLabel: label,
      error: error || undefined,
      loginState: loginState || undefined,
      egress: "direct-required",
      readOnly: true,
      capabilities: ["qr_login", "verification_code_runtime_gated", "logout", "search", "note_detail"],
    };
  }

  sessionPayload(session) {
    return {
      ok: true,
      provider: "xiaohongshu",
      session: session.session,
      status: session.status,
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
  }

  pruneSessions() {
    const staleBefore = this.now() - 60_000;
    for (const [id, session] of this.sessions) {
      if (session.expiresAt < staleBefore) this.sessions.delete(id);
    }
  }

  async notifySessionState(session) {
    if (!["confirmed", "expired", "error"].includes(session.status) || session.notified.has(session.status)) return;
    session.notified.add(session.status);
    try {
      await this.onSessionState({ provider: "xiaohongshu", status: session.status, expiresAt: new Date(session.expiresAt).toISOString() });
    } catch (error) {
      this.logger.error?.(`[xiaohongshu] login notification failed: ${safeError(error)}`);
    }
  }

  withReadSpacing(action) {
    const operation = this.readQueue.then(async () => {
      const waitMs = Math.max(0, READ_INTERVAL_MS - (this.now() - this.lastReadAt));
      if (waitMs) await delay(waitMs);
      try {
        return await action();
      } finally {
        this.lastReadAt = this.now();
      }
    });
    this.readQueue = operation.catch(() => undefined);
    return operation;
  }

  async request(pathname, { method = "GET", body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
        method,
        headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new ChannelRuntimeError(`小红书运行时连接失败：${safeError(error)}`);
    }
    const contentLength = Number(response.headers?.get?.("content-length") || 0);
    if (contentLength > MAX_RESPONSE_BYTES) throw new ChannelRuntimeError("小红书运行时响应过大");
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new ChannelRuntimeError("小红书运行时响应过大");
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new ChannelRuntimeError("小红书运行时返回了无效响应");
    }
    if (!response.ok || data?.success === false || data?.error) {
      const upstream = String(data?.error || data?.message || `HTTP ${response.status}`).slice(0, 240);
      throw new ChannelRuntimeError(`小红书运行时请求失败：${upstream}`);
    }
    return data;
  }
}

export class ChannelInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "ChannelInputError";
    this.statusCode = 400;
  }
}

export class ChannelRuntimeError extends Error {
  constructor(message) {
    super(message);
    this.name = "ChannelRuntimeError";
    this.statusCode = 502;
  }
}

function unwrapData(response) {
  return response && typeof response === "object" && "data" in response ? response.data : response;
}

function validateQrImage(value) {
  const image = String(value || "");
  if (!/^data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(image)) {
    throw new ChannelRuntimeError("小红书运行时没有返回有效二维码");
  }
  if (image.length > 4 * 1024 * 1024) throw new ChannelRuntimeError("小红书登录二维码过大");
  return image;
}

function normalizeFeed(feed) {
  if (!feed || typeof feed !== "object") return null;
  const note = feed.noteCard || {};
  const cover = note.cover || {};
  const user = note.user || {};
  const interaction = note.interactInfo || {};
  const id = String(feed.id || "");
  const xsecToken = String(feed.xsecToken || "");
  if (!id || !xsecToken) return null;
  return {
    id,
    xsecToken,
    title: String(note.displayTitle || "无标题"),
    author: String(user.nickname || user.nickName || ""),
    avatar: safePublicUrl(user.avatar),
    cover: safePublicUrl(cover.urlDefault || cover.url || cover.urlPre),
    likedCount: String(interaction.likedCount || "0"),
    commentCount: String(interaction.commentCount || "0"),
  };
}

function safePublicUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function parseDuration(value, fallback) {
  const match = /^(\d+)(ms|s|m)$/.exec(String(value || ""));
  if (!match) return fallback;
  const amount = Number(match[1]);
  const milliseconds = match[2] === "ms" ? amount : match[2] === "s" ? amount * 1000 : amount * 60_000;
  return Math.max(1_000, Math.min(milliseconds, 5 * 60_000));
}

function normalizeLoginState(value) {
  const state = String(value || "");
  return ["missing", "pending", "scanned", "verification_required", "confirmed", "expired"].includes(state) ? state : "";
}

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 240);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
