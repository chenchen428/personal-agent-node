import assert from "node:assert/strict";
import test from "node:test";
import { buildChannelCatalog } from "../src/channels/catalog.ts";

test("channel catalog exposes user channels without treating the Web console as a channel", () => {
  const channels = buildChannelCatalog({
    wechat: { connected: false, credentialsFile: "/private/credentials.json" },
    managedPlatform: { provider: "xiaohongshu", label: "小红书", state: "logged_in", statusLabel: "已登录", loggedIn: true, readOnly: true, capabilities: ["search"] },
  });
  assert.deepEqual(channels.map((channel) => channel.provider), ["wechat", "xiaohongshu"]);
  assert.equal(channels[0].state, "needs_login");
  assert.equal(channels[1].state, "logged_in");
  assert.equal(channels[1].healthCheck, true);
  assert.doesNotMatch(JSON.stringify(channels), /credentials\.json|\/private\//);
});
