import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { InstallationConnectionOwnership } from "../src/connections/connection-ownership.ts";

test("WeChat claw and personal WeChat identities are exclusive to one isolated Space", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-connection-ownership-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ownership = new InstallationConnectionOwnership({ installationDataRoot: root });
  const personal = "sp_personal00000001";
  const work = "sp_work000000000000";

  ownership.replace("wechat-claw", ["bot_owner", "wxid_owner"], personal);
  assert.throws(
    () => ownership.assertOrClaim("wechat-claw", ["bot_owner", "wxid_owner"], work),
    (error) => error.code === "WECHAT_SPACE_CONFLICT" && error.statusCode === 409,
  );
  assert.throws(
    () => ownership.assertOrClaim("wechat-personal", ["wxid_owner"], work),
    (error) => error.code === "WECHAT_SPACE_CONFLICT",
  );

  ownership.replace("wechat-personal", ["wxid_second"], work);
  assert.equal(ownership.assertOrClaim("wechat-personal", ["wxid_second"], work).owned, true);
});

test("replacing a Space connection releases its previous account without exposing account ids", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-connection-replace-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ownership = new InstallationConnectionOwnership({ installationDataRoot: root });
  const personal = "sp_personal00000001";
  const work = "sp_work000000000000";

  ownership.replace("wechat-claw", ["old-account"], personal);
  ownership.replace("wechat-claw", ["new-account"], personal);
  assert.equal(ownership.assertOrClaim("wechat-claw", ["old-account"], work).owned, true);
  assert.equal(ownership.release("wechat-claw", personal).released, 1);
  assert.equal(ownership.assertOrClaim("wechat-claw", ["new-account"], work).owned, true);
  const persisted = fs.readFileSync(path.join(root, "installation", "config", "connection-ownership.json"), "utf8");
  assert.equal(fs.existsSync(path.join(root, "config")), false);
  assert.doesNotMatch(persisted, /old-account|new-account/);
});

test("WeChat claw connector fails closed before polling or sending from a conflicting Space", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-wechat-claw-conflict-"));
  const channelDataDir = path.join(root, "space-b-channel");
  fs.mkdirSync(channelDataDir, { recursive: true });
  fs.writeFileSync(path.join(channelDataDir, "account.json"), JSON.stringify({
    token: "test-token",
    baseUrl: "https://wechat.invalid",
    accountId: "bot-exclusive",
    userId: "wxid-exclusive",
    savedAt: new Date().toISOString(),
  }));
  const previousDataDir = process.env.CLI_BRIDGE_DATA_DIR;
  process.env.CLI_BRIDGE_DATA_DIR = channelDataDir;
  t.after(() => {
    if (previousDataDir === undefined) delete process.env.CLI_BRIDGE_DATA_DIR;
    else process.env.CLI_BRIDGE_DATA_DIR = previousDataDir;
    fs.rmSync(root, { recursive: true, force: true });
  });

  const ownership = new InstallationConnectionOwnership({ installationDataRoot: root });
  ownership.replace("wechat-claw", ["bot-exclusive", "wxid-exclusive"], "sp_personal00000001");
  const { WeChatConnector } = await import(`../src/channels/wechat/connector.ts?space-conflict=${Date.now()}`);
  const connector = new WeChatConnector({ log() {}, error() {} }, { store: ownership, spaceId: "sp_work000000000000" });

  assert.deepEqual(connector.catalogStatus(), {
    connected: false,
    loginState: "space-conflict",
    reason: "该微信连接已被另一个隔离空间占用，不能在当前 Space 共同引用",
    polling: false,
    pollingEnabled: false,
    configured: true,
  });
  await assert.rejects(
    connector.sendText("recipient", "blocked"),
    (error) => error.code === "WECHAT_SPACE_CONFLICT" && error.statusCode === 409,
  );
  fs.writeFileSync(path.join(channelDataDir, "sync_buf.txt"), "{}");
  fs.writeFileSync(path.join(channelDataDir, "context_tokens.json"), "{}");
  const ownerConnector = new WeChatConnector({ log() {}, error() {} }, { store: ownership, spaceId: "sp_personal00000001" });
  assert.equal(ownerConnector.catalogStatus().configured, true);
  assert.deepEqual(ownerConnector.clearConfiguration(), { cleared: true, configuredBefore: true });
  for (const name of ["account.json", "sync_buf.txt", "context_tokens.json"]) assert.equal(fs.existsSync(path.join(channelDataDir, name)), false);
  assert.equal(ownerConnector.catalogStatus().configured, false);
  assert.equal(ownership.assertOrClaim("wechat-claw", ["bot-exclusive", "wxid-exclusive"], "sp_work000000000000").owned, true);
});
