import assert from "node:assert/strict";
import test from "node:test";
import { OpenCliTwitterProvider, resolveTweetTarget } from "../src/channels/twitter/opencli-provider.js";

const tweetId = "1812345678901234567";
const tweetUrl = `https://x.com/example/status/${tweetId}`;

test("OpenCLI Twitter provider exposes only normalized search and thread reads", async () => {
  const commands = [];
  const runner = {
    probe: async () => ({ available: true, version: "1.8.6" }),
    browserBridgeStatus: async () => ({ ready: true }),
    platformOperation: async (site, operation, input) => {
      const args = [site, operation, input];
      commands.push(args);
      const base = {
        id: tweetId,
        author: "example",
        bio: "bio",
        text: "hello",
        created_at: "2026-07-18T08:00:00Z",
        likes: 12,
        retweets: 3,
        replies: 2,
        views: 100,
        url: tweetUrl,
        has_media: true,
        media_urls: ["https://pbs.twimg.com/media/example.jpg", "http://unsafe.example/image.jpg"],
      };
      return { rows: [base], observation: { loginState: "logged_in", searchReady: true, readReady: true } };
    },
  };
  const provider = new OpenCliTwitterProvider({ runner, now: () => 10_000, wait: async () => {} });
  const search = await provider.search(" personal agents ");
  assert.deepEqual(search.tweets[0], {
    id: tweetId,
    author: "example",
    bio: "bio",
    text: "hello",
    createdAt: "2026-07-18T08:00:00Z",
    likes: "12",
    retweets: "3",
    replies: "2",
    bookmarks: "0",
    views: "100",
    url: tweetUrl,
    mediaUrls: ["https://pbs.twimg.com/media/example.jpg"],
    hasMedia: true,
  });
  const detail = await provider.detail({ url: tweetUrl });
  assert.equal(detail.tweetId, tweetId);
  assert.equal(detail.count, 1);
  assert.deepEqual(commands, [
    ["twitter", "search", "personal agents"],
    ["twitter", "read", tweetUrl],
  ]);
});

test("OpenCLI Twitter open remains available before platform login", async () => {
  let opened;
  const runner = {
    probe: async () => ({ available: true, version: "1.8.6" }),
    browserBridgeStatus: async () => ({ ready: true, needsSetup: false, daemon: "running", browserBridge: "connected" }),
    platformOperation: async (site, operation) => { if(operation === "status") return { loginState: "logged_out" }; opened = { site, operation }; return { opened: true, url: "https://x.com/i/flow/login", connectionCreated: false }; },
  };
  const provider = new OpenCliTwitterProvider({ runner });
  const status = await provider.status();
  assert.equal(status.state, "needs_login");
  assert.equal(status.statusLabel, "请登录平台账号");
  assert.equal(status.loginStateInspected, true);
  assert.equal("loggedIn" in status, false);
  const result = await provider.open();
  assert.equal(result.connectionCreated, false);
  assert.equal(opened.operation, "open");
  assert.equal(result.url, "https://x.com/i/flow/login");
});

test("Twitter read validation accepts ids and status URLs only", () => {
  assert.deepEqual(resolveTweetTarget({ tweetId }), { argument: tweetId, id: tweetId, url: "" });
  assert.deepEqual(resolveTweetTarget({ url: `https://twitter.com/example/status/${tweetId}?s=20` }), {
    argument: tweetUrl,
    id: tweetId,
    url: tweetUrl,
  });
  assert.throws(() => resolveTweetTarget({ url: `https://example.com/example/status/${tweetId}` }));
  assert.throws(() => resolveTweetTarget({ url: "https://x.com/home" }));
});

test("OpenCLI Twitter setup reports browser bridge repair metadata", async () => {
  const provider = new OpenCliTwitterProvider({ runner: {
    probe: async () => ({ available: true, version: "1.8.6", source: "bundled" }),
    browserBridgeStatus: async () => ({ ready: false, needsSetup: true, daemon: "running", browserBridge: "disconnected" }),
  } });
  const status = await provider.status();
  assert.equal(status.state, "needs_setup");
  assert.equal(status.setup.runtimeBundled, true);
  assert.equal(status.setup.browserBridgeInstallUrl, "https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk");
  assert.equal(status.setup.userConfirmationRequired, true);
  assert.equal("installCommand" in status.setup, false);
});
