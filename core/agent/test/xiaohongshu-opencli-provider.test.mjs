import assert from "node:assert/strict";
import test from "node:test";
import { OpenCliXiaohongshuProvider, resolveSignedNoteUrl } from "../src/channels/xiaohongshu/opencli-provider.js";

const noteId = "65b123456789abcdef123456";
const signedUrl = `https://www.xiaohongshu.com/search_result/${noteId}?xsec_token=signed-token`;

test("OpenCLI Xiaohongshu provider normalizes search and note output", async () => {
  const commands = [];
  const runner = {
    probe: async () => ({ available: true, version: "1.8.6" }),
    json: async (args) => {
      commands.push(args);
      if (args[1] === "search") {
        return [{ title: "测试笔记", author: "作者", likes: "12", published_at: "2026-07-18", url: signedUrl }];
      }
      return [
        { field: "title", value: "测试笔记" },
        { field: "author", value: "作者" },
        { field: "content", value: "正文" },
        { field: "tags", value: "#AI, #Agent" },
      ];
    },
  };
  const provider = new OpenCliXiaohongshuProvider({ runner, now: () => 10_000, wait: async () => {} });
  const search = await provider.search(" 测试 ");
  assert.deepEqual(search.feeds[0], {
    id: noteId,
    xsecToken: "signed-token",
    title: "测试笔记",
    author: "作者",
    avatar: "",
    cover: "",
    likedCount: "12",
    commentCount: "",
    publishedAt: "2026-07-18",
    url: signedUrl,
    authorUrl: "",
  });

  const detail = await provider.detail({ url: signedUrl });
  assert.equal(detail.feedId, noteId);
  assert.deepEqual(detail.detail.tags, ["#AI", "#Agent"]);
  assert.deepEqual(commands, [
    ["xiaohongshu", "search", "测试", "--limit", "20", "--format", "json"],
    ["xiaohongshu", "note", signedUrl, "--format", "json"],
  ]);
});

test("OpenCLI Xiaohongshu open uses a fixed homepage without inspecting login state", async () => {
  let opened;
  const runner = {
    probe: async () => ({ available: true, version: "1.8.6" }),
    browserBridgeStatus: async () => ({ ready: true, needsSetup: false, daemon: "running", browserBridge: "connected" }),
    openBrowserSession: async (session, url) => { opened = { session, url }; },
  };
  const provider = new OpenCliXiaohongshuProvider({ runner });
  const status = await provider.status();
  assert.equal(status.state, "ready");
  assert.equal(status.statusLabel, "已就绪");
  assert.equal(status.loginStateInspected, false);
  assert.equal("loggedIn" in status, false);
  const result = await provider.open();
  assert.equal(result.connectionCreated, false);
  assert.equal(opened.url, "https://www.xiaohongshu.com/");
  assert.match(opened.session, /^pa-xhs-[a-f0-9]{16}$/);
});

test("Xiaohongshu signed URL validation rejects other hosts and unsigned notes", () => {
  assert.equal(resolveSignedNoteUrl({ url: signedUrl }).toString(), signedUrl);
  assert.throws(() => resolveSignedNoteUrl({ url: `https://example.com/search_result/${noteId}?xsec_token=token` }));
  assert.throws(() => resolveSignedNoteUrl({ url: `https://www.xiaohongshu.com/search_result/${noteId}` }));
});

test("OpenCLI Xiaohongshu setup reports browser bridge repair metadata", async () => {
  const provider = new OpenCliXiaohongshuProvider({ runner: {
    probe: async () => ({ available: true, version: "1.8.6", source: "bundled" }),
    browserBridgeStatus: async () => ({ ready: false, needsSetup: true, daemon: "running", browserBridge: "disconnected" }),
  } });
  const status = await provider.status();
  assert.equal(status.state, "needs_setup");
  assert.equal(status.setup.runtimeBundled, true);
  assert.equal(status.setup.browserBridgeInstallUrl, "https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk");
  assert.equal(status.setup.userConfirmationRequired, true);
  assert.equal(status.setup.customExtensionRequired, false);
  assert.equal("installCommand" in status.setup, false);
});

test("OpenCLI Xiaohongshu reports a damaged runtime as an application error", async () => {
  const provider = new OpenCliXiaohongshuProvider({ runner: { probe: async () => { throw Object.assign(new Error("missing"), { code: "OPENCLI_NOT_INSTALLED" }); } } });
  const status = await provider.status();
  assert.equal(status.state, "error");
  assert.equal(status.setup, undefined);
});
