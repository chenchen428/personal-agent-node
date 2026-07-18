import crypto from "node:crypto";
import { ChannelInputError } from "../xiaohongshu/channel.js";
import { OpenCliError } from "../../connections/opencli/runner.js";

const READ_INTERVAL_MS = 2_500;
const HOME_URL = "https://x.com/home";

export class OpenCliTwitterProvider {
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
    return this.lastStatus || this.statusPayload("needs_setup", "浏览器操作待检测");
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
      if (bridge.needsSetup) return this.statusPayload("needs_setup", "浏览器连接待修复", null, runtime, bridge);
      return this.statusPayload("ready", "已就绪", null, runtime, bridge);
    } catch (error) {
      if (["OPENCLI_BROWSER_UNAVAILABLE", "OPENCLI_CONFIG_INVALID"].includes(error?.code)) {
        return this.statusPayload("needs_setup", "浏览器连接待修复", error, runtime);
      }
      return this.statusPayload("error", "浏览器不可用", error, runtime);
    }
  }

  async open() {
    await this.ensureAvailable();
    const browserSession = `pa-twitter-${crypto.randomBytes(8).toString("hex")}`;
    await this.runner.openBrowserSession(browserSession, HOME_URL);
    return { ok: true, provider: "twitter", backend: "opencli", opened: true, url: HOME_URL, interaction: "browser", connectionCreated: false };
  }

  async search(query) {
    const normalized = String(query || "").trim();
    if (!normalized || normalized.length > 240) throw new ChannelInputError("Twitter search query must contain 1 to 240 characters.");
    return this.withReadSpacing(async () => {
      const rows = await this.runner.json(
        ["twitter", "search", normalized, "--limit", "20", "--format", "json"],
        { timeoutMs: 120_000 },
      );
      if (!Array.isArray(rows)) throw new OpenCliError("OPENCLI_INVALID_OUTPUT", "OpenCLI Twitter search returned an invalid response.", 502);
      const tweets = rows.map(normalizeTweet).filter(Boolean);
      return { ok: true, provider: "twitter", backend: "opencli", query: normalized, tweets, count: tweets.length };
    });
  }

  async detail({ tweetId, url } = {}) {
    const target = resolveTweetTarget({ tweetId, url });
    return this.withReadSpacing(async () => {
      const rows = await this.runner.json(
        ["twitter", "thread", target.argument, "--limit", "50", "--format", "json"],
        { timeoutMs: 120_000 },
      );
      if (!Array.isArray(rows)) throw new OpenCliError("OPENCLI_INVALID_OUTPUT", "OpenCLI Twitter thread returned an invalid response.", 502);
      const tweets = rows.map(normalizeTweet).filter(Boolean);
      if (!tweets.length) throw new OpenCliError("OPENCLI_EMPTY_RESULT", "OpenCLI did not return readable tweets.", 404);
      return { ok: true, provider: "twitter", backend: "opencli", tweetId: target.id || tweets[0].id, url: target.url || tweets[0].url, tweets, count: tweets.length };
    });
  }

  statusPayload(state, statusLabel, error, runtime, bridge) {
    return {
      ok: true,
      provider: "twitter",
      backend: "opencli",
      availableBackends: ["opencli"],
      label: "Twitter / X",
      state,
      statusLabel,
      error: error ? safeErrorCode(error) : undefined,
      runtime: runtime ? [
        { label: "浏览器操作", value: bridge?.browserBridge === "connected" ? "已就绪" : "待修复" },
      ] : [{ label: "浏览器操作", value: "不可用" }],
      browserOwnedSession: true,
      loginStateInspected: false,
      egress: "direct-required",
      readOnly: true,
      capabilities: ["browser_open", "search", "thread_read"],
      setup: state === "needs_setup" ? openCliSetup() : undefined,
      primaryAction: "在浏览器打开 Twitter / X",
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

export function resolveTweetTarget({ tweetId, url } = {}) {
  const direct = String(url || "").trim();
  if (!direct) {
    const id = String(tweetId || "").trim();
    if (!/^\d{6,32}$/.test(id)) throw new ChannelInputError("A valid Twitter tweet id or status URL is required.");
    return { argument: id, id, url: "" };
  }
  if (direct.length > 2_048) throw new ChannelInputError("Twitter status URL is too long.");
  let parsed;
  try {
    parsed = new URL(direct);
  } catch {
    throw new ChannelInputError("Twitter status URL is invalid.");
  }
  const hostname = parsed.hostname.toLowerCase();
  const supportedHost = ["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(hostname);
  const match = /^\/([A-Za-z0-9_]{1,50})\/status\/(\d{6,32})\/?$/.exec(parsed.pathname);
  if (parsed.protocol !== "https:" || !supportedHost || !match) throw new ChannelInputError("A valid x.com or twitter.com status URL is required.");
  const normalized = new URL(`https://x.com/${match[1]}/status/${match[2]}`).toString();
  return { argument: normalized, id: match[2], url: normalized };
}

function normalizeTweet(row) {
  if (!row || typeof row !== "object") return null;
  const sourceUrl = safeTweetUrl(row.url);
  const id = /^\d{6,32}$/.test(String(row.id || "")) ? String(row.id) : /\/status\/(\d{6,32})/.exec(sourceUrl)?.[1] || "";
  if (!id) return null;
  return {
    id,
    author: String(row.author || "").slice(0, 200),
    bio: String(row.bio || "").slice(0, 1_000),
    text: String(row.text || "").slice(0, 50_000),
    createdAt: String(row.created_at || "").slice(0, 80),
    likes: metric(row.likes),
    retweets: metric(row.retweets),
    replies: metric(row.replies),
    bookmarks: metric(row.bookmarks),
    views: metric(row.views),
    url: sourceUrl,
    mediaUrls: Array.isArray(row.media_urls) ? row.media_urls.map(safeHttpsUrl).filter(Boolean).slice(0, 20) : [],
    hasMedia: row.has_media === true || row.has_media === "true",
  };
}

function safeTweetUrl(value) {
  try {
    return resolveTweetTarget({ url: value }).url;
  } catch {
    return "";
  }
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function metric(value) {
  const text = String(value ?? "").trim().replace(/,/g, "");
  return /^\d+(?:\.\d+)?[KMB]?$/i.test(text) ? text.slice(0, 32) : "0";
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
