import { ChannelInputError } from "./channel.js";
import { OpenCliError } from "../../connections/opencli/runner.js";
import { SocialBrowserProvider } from "../../connections/opencli/social-provider.js";

export class OpenCliXiaohongshuProvider extends SocialBrowserProvider {
  constructor(options = {}) { super({ ...options, platform: "xiaohongshu" }); }

  async search(keyword) {
    const normalized = String(keyword || "").trim();
    if (!normalized || normalized.length > 80) throw new ChannelInputError("Search keyword must contain 1 to 80 characters.");
    return this.withReadSpacing(async () => {
      const rows = await this.readRows("search", normalized);
      if (!Array.isArray(rows)) throw new OpenCliError("OPENCLI_INVALID_OUTPUT", "OpenCLI search returned an invalid response.", 502);
      const feeds = rows.map(normalizeSearchRow).filter(Boolean);
      return { ok: true, provider: "xiaohongshu", backend: "opencli", keyword: normalized, feeds, count: feeds.length };
    });
  }

  async detail({ feedId, xsecToken, url } = {}) {
    const signedUrl = resolveSignedNoteUrl({ feedId, xsecToken, url });
    return this.withReadSpacing(async () => {
      const rows = await this.readRows("read", signedUrl.toString());
      if (!Array.isArray(rows)) throw new OpenCliError("OPENCLI_INVALID_OUTPUT", "OpenCLI note returned an invalid response.", 502);
      const detail = normalizeNoteRows(rows);
      const identity = noteIdentity(signedUrl);
      return { ok: true, provider: "xiaohongshu", backend: "opencli", feedId: identity.id, url: signedUrl.toString(), detail };
    });
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
