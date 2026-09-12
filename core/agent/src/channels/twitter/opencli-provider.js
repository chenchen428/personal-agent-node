import { ChannelInputError } from "../xiaohongshu/channel.js";
import { OpenCliError } from "../../connections/opencli/runner.js";
import { SocialBrowserProvider } from "../../connections/opencli/social-provider.js";

export class OpenCliTwitterProvider extends SocialBrowserProvider {
  constructor(options = {}) { super({ ...options, platform: "twitter" }); }

  async search(query) {
    const normalized = String(query || "").trim();
    if (!normalized || normalized.length > 240) throw new ChannelInputError("Twitter search query must contain 1 to 240 characters.");
    return this.withReadSpacing(async () => {
      const rows = await this.readRows("search", normalized);
      if (!Array.isArray(rows)) throw new OpenCliError("OPENCLI_INVALID_OUTPUT", "OpenCLI Twitter search returned an invalid response.", 502);
      const tweets = rows.map(normalizeTweet).filter(Boolean);
      return { ok: true, provider: "twitter", backend: "opencli", query: normalized, tweets, count: tweets.length };
    });
  }

  async detail({ tweetId, url } = {}) {
    const target = resolveTweetTarget({ tweetId, url });
    return this.withReadSpacing(async () => {
      const rows = await this.readRows("read", target.argument);
      if (!Array.isArray(rows)) throw new OpenCliError("OPENCLI_INVALID_OUTPUT", "OpenCLI Twitter thread returned an invalid response.", 502);
      const tweets = rows.map(normalizeTweet).filter(Boolean);
      if (!tweets.length) throw new OpenCliError("OPENCLI_EMPTY_RESULT", "OpenCLI did not return readable tweets.", 404);
      return { ok: true, provider: "twitter", backend: "opencli", tweetId: target.id || tweets[0].id, url: target.url || tweets[0].url, tweets, count: tweets.length };
    });
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
