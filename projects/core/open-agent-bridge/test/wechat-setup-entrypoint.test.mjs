import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { isDirectWechatSetup } from "../src/channels/wechat/runtime/entrypoint-guard.mjs";

test("WeChat setup only auto-runs as its dedicated CLI entrypoint", () => {
  assert.equal(isDirectWechatSetup({ metaMain: true, metaUrl: pathToFileURL("/tmp/setup.ts").href }), true);
  assert.equal(isDirectWechatSetup({ metaMain: true, metaUrl: pathToFileURL("/tmp/setup.mjs").href }), true);
  assert.equal(isDirectWechatSetup({ metaMain: true, metaUrl: pathToFileURL("/tmp/server.mjs").href }), false);
  assert.equal(isDirectWechatSetup({ metaMain: false, metaUrl: pathToFileURL("/tmp/setup.ts").href }), false);
  assert.equal(isDirectWechatSetup({ metaMain: true, metaUrl: "not-a-file-url" }), false);
});
