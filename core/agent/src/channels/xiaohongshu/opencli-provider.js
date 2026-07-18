import crypto from "node:crypto";
import { ChannelInputError } from "./channel.js";
import { OpenCliError } from "../../connections/opencli/runner.js";

const READ_INTERVAL_MS = 2_500;
const HOME_URL = "https://www.xiaohongshu.com/";

export class OpenCliXiaohongshuProvider {
  constructor({ runner, now = () => Date.now(), wait = delay } = {}) {
    if (!runner) throw new TypeError("runner is required");
    this.runner = runner;
    this.now = now;
    this.wait = wait;
    this.statusPromise = null;
    this.lastStatus = null;
    this.lastReadAt = 0;
    this.readQueue = Promise.resolve();
  }

  async status() {
    if (!this.statusPromise) {
      this.statusPromise = this.checkStatus()
        .then((status) => {
          this.lastStatus = status;
          return status;
        })
        .finally(() => {
          this.statusPromise = null;
        });
    }
    return this.statusPromise;
  }

  catalogStatus() {
    return this.lastStatus || this.statusPayload("needs_setup", "OpenCLI 待检测");
  }

  async checkStatus() {
    let runtime;
    try {
      runtime = await this.runner.probe();
    } catch (error) {
      return this.statusPayload("error", "浏览器不可用", error);
    }
    try {
      const bridge = await this.runner.browserBridgeStatus();
      if (bridge.needsSetup) return this.statusPayload("needs_setup", "OpenCLI 桥接未就绪", null, runtime, bridge);
      return this.statusPayload("ready", "OpenCLI 可用", null, runtime, bridge);
    } catch (error) {
      if (["OPENCLI_BROWSER_UNAVAILABLE", "OPENCLI_CONFIG_INVALID"].includes(error?.code)) {
        return this.statusPayload("needs_setup", "OpenCLI 桥接未就绪", error, runtime);
      }
      return this.statusPayload("error", "浏览器不可用", error, runtime);
    }
  }

  async open() {
    await this.ensureAvailable();
    const browserSession = `pa-xhs-${crypto.randomBytes(8).toString("hex")}`;
    await this.runner.openBrowserSession(browserSession, HOME_URL);
    return {
      ok: true,
      provider: "xiaohongshu",
      backend: "opencli",
      opened: true,
      url: HOME_URL,
      interaction: "browser",
      connectionCreated: false,
    };
  }

  async search(keyword) {
    const normalized = String(keyword || "").trim();
    if (!normalized || normalized.length > 80) throw new ChannelInputError("Search keyword must contain 1 to 80 characters.");
    return this.withReadSpacing(async () => {
      const rows = await this.runner.json(
        ["xiaohongshu", "search", normalized, "--limit", "20", "--format", "json"],
        { timeoutMs: 120_000 },
      );
      if (!Array.isArray(rows)) throw new OpenCliError("OPENCLI_INVALID_OUTPUT", "OpenCLI search returned an invalid response.", 502);
      const feeds = rows.map(normalizeSearchRow).filter(Boolean);
      return { ok: true, provider: "xiaohongshu", backend: "opencli", keyword: normalized, feeds, count: feeds.length };
    });
  }

  async detail({ feedId, xsecToken, url } = {}) {
    const signedUrl = resolveSignedNoteUrl({ feedId, xsecToken, url });
    return this.withReadSpacing(async () => {
      const rows = await this.runner.json(
        ["xiaohongshu", "note", signedUrl.toString(), "--format", "json"],
        { timeoutMs: 120_000 },
      );
      if (!Array.isArray(rows)) throw new OpenCliError("OPENCLI_INVALID_OUTPUT", "OpenCLI note returned an invalid response.", 502);
      const detail = normalizeNoteRows(rows);
      const identity = noteIdentity(signedUrl);
      return { ok: true, provider: "xiaohongshu", backend: "opencli", feedId: identity.id, url: signedUrl.toString(), detail };
    });
  }

  statusPayload(state, statusLabel, error, runtime, bridge) {
    return {
      ok: true,
      provider: "xiaohongshu",
      backend: "opencli",
      availableBackends: ["opencli"],
      label: "Xiaohongshu",
      state,
      statusLabel,
      error: error ? safeErrorCode(error) : undefined,
      runtime: runtime ? [
        { label: "OpenCLI 运行时", value: runtime.source === "bundled" ? `内置 ${runtime.version}` : `兼容模式 ${runtime.version}` },
        { label: "OpenCLI 浏览器桥接", value: bridge?.browserBridge === "connected" ? "已就绪" : "待修复" },
      ] : [{ label: "OpenCLI 运行时", value: "不可用" }],
      browserOwnedSession: true,
      loginStateInspected: false,
      egress: "direct-required",
      readOnly: true,
      capabilities: ["browser_open", "search", "note_detail"],
      setup: state === "needs_setup" ? openCliSetup() : undefined,
      primaryAction: "在浏览器打开小红书",
    };
  }

  async ensureAvailable() {
    const status = await this.status();
    if (status.state === "needs_setup") throw new OpenCliError("OPENCLI_NOT_READY", "The OpenCLI browser bridge is not ready.", 503);
    if (status.state === "error") throw new OpenCliError("OPENCLI_NOT_READY", "OpenCLI browser executor is not ready.", 503);
  }

  withReadSpacing(action) {
    const operation = this.readQueue.then(async () => {
      const waitMs = Math.max(0, READ_INTERVAL_MS - (this.now() - this.lastReadAt));
      if (waitMs) await this.wait(waitMs);
      try {
        return await action();
      } finally {
        this.lastReadAt = this.now();
      }
    });
    this.readQueue = operation.catch(() => undefined);
    return operation;
  }
}

export function resolveSignedNoteUrl({ feedId, xsecToken, url } = {}) {
  const direct = String(url || "").trim();
  let parsed;
  if (direct) {
    if (direct.length > 4_096) throw new ChannelInputError("Xiaohongshu note URL is too long.");
    try {
      parsed = new URL(direct);
    } catch {
      throw new ChannelInputError("Xiaohongshu note URL is invalid.");
    }
  } else {
    const id = String(feedId || "").trim();
    const token = String(xsecToken || "").trim();
    if (!/^[a-f0-9]{8,64}$/i.test(id)) throw new ChannelInputError("Xiaohongshu note id is invalid.");
    if (!token || token.length > 2_048) throw new ChannelInputError("xsec_token is invalid; use a recent search result.");
    parsed = new URL(`https://www.xiaohongshu.com/explore/${encodeURIComponent(id)}`);
    parsed.searchParams.set("xsec_token", token);
  }

  const hostname = parsed.hostname.toLowerCase();
  const supportedHost = hostname === "xiaohongshu.com" || hostname.endsWith(".xiaohongshu.com");
  const supportedPath = /^\/(?:explore|note|search_result|discovery\/item)\/[a-f0-9]+\/?$/i.test(parsed.pathname)
    || /^\/user\/profile\/[^/?#]+\/[a-f0-9]+\/?$/i.test(parsed.pathname);
  const token = String(parsed.searchParams.get("xsec_token") || "").trim();
  if (parsed.protocol !== "https:" || !supportedHost || !supportedPath || !token || token.length > 2_048) {
    throw new ChannelInputError("A signed Xiaohongshu HTTPS note URL with xsec_token is required.");
  }
  parsed.hash = "";
  return parsed;
}

function normalizeSearchRow(row) {
  if (!row || typeof row !== "object") return null;
  let url;
  try {
    url = resolveSignedNoteUrl({ url: row.url });
  } catch {
    return null;
  }
  const identity = noteIdentity(url);
  return {
    id: identity.id,
    xsecToken: identity.xsecToken,
    title: String(row.title || "Untitled").slice(0, 500),
    author: String(row.author || "").slice(0, 200),
    avatar: "",
    cover: "",
    likedCount: String(row.likes || "0").slice(0, 40),
    commentCount: "",
    publishedAt: String(row.published_at || "").slice(0, 40),
    url: url.toString(),
    authorUrl: safeXiaohongshuUrl(row.author_url),
  };
}

function normalizeNoteRows(rows) {
  const allowed = new Set(["title", "author", "content", "likes", "collects", "comments", "tags"]);
  const result = {};
  for (const row of rows) {
    const field = String(row?.field || "").trim();
    if (!allowed.has(field)) continue;
    const value = String(row?.value ?? "").slice(0, 200_000);
    result[field] = field === "tags"
      ? value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 100)
      : value;
  }
  if (!result.title && !result.author && !result.content) {
    throw new OpenCliError("OPENCLI_EMPTY_RESULT", "OpenCLI did not return readable note content.", 404);
  }
  return result;
}

function noteIdentity(url) {
  const match = /\/(?:explore|note|search_result|discovery\/item)\/([a-f0-9]+)/i.exec(url.pathname)
    || /\/user\/profile\/[^/?#]+\/([a-f0-9]+)/i.exec(url.pathname);
  return { id: match?.[1] || "", xsecToken: String(url.searchParams.get("xsec_token") || "") };
}

function safeXiaohongshuUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:" && (hostname === "xiaohongshu.com" || hostname.endsWith(".xiaohongshu.com")) ? url.toString() : "";
  } catch {
    return "";
  }
}

function safeErrorCode(error) {
  return String(error?.code || error?.name || "OPENCLI_ERROR").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "OPENCLI_ERROR";
}

function openCliSetup() {
  return {
    runtimeBundled: true,
    browserBridge: "OpenCLI Browser Bridge",
    browserBridgeInstallUrl: "https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk",
    userConfirmationRequired: true,
    customExtensionRequired: false,
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
