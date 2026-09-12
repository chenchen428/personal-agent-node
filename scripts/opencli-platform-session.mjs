import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PLATFORMS, runPlatformSession } from "./lib/social-platform-session.mjs";

// Private process entrypoint: only the fixed, pinned OpenCLI read adapters load
// here. The parent supplies its minimal browser environment, never Agent secrets.
try {
  const verifyOnly = process.argv[3] === "--verify-runtime";
  const chunks = []; let bytes = 0;
  if (!verifyOnly) for await (const chunk of process.stdin) { bytes += chunk.length; if (bytes > 8192) throw new Error("Invalid request"); chunks.push(chunk); }
  const request = verifyOnly ? { platform: "xiaohongshu", operation: "status", session: "pa-social-000000000000000000000000-xiaohongshu" } : JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const { platform, operation, input = "", session } = request;
  if (!PLATFORMS[platform] || !["open", "status", "search", "read"].includes(operation) || typeof input !== "string" || input.length > 4096 || !/^pa-social-[a-f0-9]{24}-(xiaohongshu|twitter)$/.test(session) || !session.endsWith(`-${platform}`)) throw new Error("Invalid request");
  if (operation === "search" && (!input.trim() || input.length > (platform === "xiaohongshu" ? 80 : 240))) throw new Error("Invalid query");
  if (operation === "read") {
    if (!(platform === "twitter" && /^\d{6,32}$/.test(input))) {
      const url = new URL(input);
      const validHost = platform === "xiaohongshu" ? ["www.xiaohongshu.com", "xiaohongshu.com"] : ["x.com", "www.x.com", "twitter.com", "www.twitter.com"];
      if (url.protocol !== "https:" || url.username || url.password || !validHost.includes(url.hostname)) throw new Error("Invalid read URL");
    }
  }
  const entrypoint = path.resolve(process.argv[2] || "");
  const packageRoot = path.resolve(path.dirname(entrypoint), "../..");
  const metadata = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  if (metadata.name !== "@jackwener/opencli" || metadata.version !== "1.8.6" || path.basename(entrypoint) !== "main.js") throw new Error("Unsupported browser runtime");
  const load = (relative) => import(pathToFileURL(path.join(packageRoot, relative)).href);
  const { browserSession, getBrowserFactory } = await load("dist/src/runtime.js");
  const { profileRouteParams, resolveProfileSelection } = await load("dist/src/browser/profile.js");
  const { getRegistry } = await load("dist/src/registry.js");
  if (verifyOnly) {
    if (![browserSession, getBrowserFactory, profileRouteParams, resolveProfileSelection, getRegistry].every((value) => typeof value === "function")) throw new Error("SDK contract unavailable");
    for (const [site, names] of [["xiaohongshu", ["search", "note"]], ["twitter", ["search", "thread"]]]) {
      for (const name of names) { await load(`clis/${site}/${name}.js`); const adapter = getRegistry().get(`${site}/${name}`); if (adapter?.access !== "read" || typeof adapter.func !== "function") throw new Error("Read adapter unavailable"); }
    }
    process.stdout.write(JSON.stringify({ ok: true, version: metadata.version, boundedAdapters: 4, browserAccessed: false }));
    process.exit(0);
  }
  const result = await browserSession(getBrowserFactory(platform), async (page) => runPlatformSession({
    platform, operation, input, page,
    loadAdapter: async (site, name) => {
      await load(`clis/${site}/${name}.js`);
      const adapter = getRegistry().get(`${site}/${name}`);
      const allowedBrowserScripts = [];
      if (site === "twitter" && name === "search") {
        const { resolveTwitterOperationMetadata } = await load("clis/twitter/shared.js");
        // Capture the exact pinned public-metadata script without accessing a
        // browser. All other non-request evaluation is rejected by the proxy.
        await resolveTwitterOperationMetadata({ evaluate: async (source) => { allowedBrowserScripts.push(source); return null; } }, "SearchTimeline", { queryId: "unused", features: {}, fieldToggles: {} });
      }
      return { ...adapter, allowedBrowserScripts };
    },
  }), { session, surface: "adapter", siteSession: "persistent", windowMode: operation === "open" ? "foreground" : "background", ...profileRouteParams(resolveProfileSelection()) });
  process.stdout.write(JSON.stringify({ ok: true, result }));
} catch (error) {
  const known = ["CONNECTION_LOGIN_REQUIRED", "CONNECTION_LOGIN_UNCONFIRMED", "AUTH_REQUIRED", "SECURITY_BLOCK", "BROWSER_CONNECT", "TIMEOUT", "EMPTY_RESULT"];
  const code = known.includes(error?.code) ? error.code : "OPENCLI_EXECUTION_FAILED";
  // Never return SDK messages, account data, headers, or raw browser output.
  process.stdout.write(JSON.stringify({ ok: false, error: { code } }));
}
