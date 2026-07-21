import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildConnectionCatalog, connectionPlatformSupport, readConnectionRegistry, resolveConnectionRegistryPath } from "../src/connections/catalog.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("connection catalog is the shared UI, Skill, and CLI contract", () => {
  const registry = readConnectionRegistry();
  const catalog = buildConnectionCatalog({ registry, platform: "win32", statuses: {
    notion: { state: "connected", statusLabel: "已连接" },
    xiaohongshu: { state: "ready", statusLabel: "浏览器可用", capabilities: ["internal_runtime_capability"], setup: { customExtensionRequired: false } },
  } });
  assert.deepEqual(catalog.map((item) => item.id), ["wechat", "dingtalk", "wechat-personal", "xiaohongshu", "twitter", "notion", "mail", "sites"]);
  assert.equal(catalog.find((item) => item.id === "wechat").setupRequired, false);
  assert.equal(catalog.find((item) => item.id === "wechat").accessMode, "account");
  assert.equal(catalog.find((item) => item.id === "wechat").name, "微信 claw");
  assert.equal(catalog.find((item) => item.id === "dingtalk").origin.version, "2.1.4");
  assert.equal(catalog.find((item) => item.id === "wechat-personal").accessMode, "local");
  assert.deepEqual(catalog.find((item) => item.id === "wechat-personal").platforms, ["win32"]);
  assert.equal(catalog.find((item) => item.id === "mail").defaultConnected, true);
  assert.equal(catalog.find((item) => item.id === "sites").defaultConnected, true);
  assert.equal(catalog.find((item) => item.id === "notion").cli.command, "ntn");
  assert.equal(catalog.find((item) => item.id === "xiaohongshu").accessMode, "browser");
  assert.deepEqual(catalog.find((item) => item.id === "xiaohongshu").platforms, ["win32", "darwin"]);
  assert.equal(catalog.find((item) => item.id === "xiaohongshu").skill.name, "social-browser-read");
  assert.equal(catalog.find((item) => item.id === "xiaohongshu").setup.customExtensionRequired, false);
  assert.equal(catalog.find((item) => item.id === "twitter").accessMode, "browser");
  assert.deepEqual(catalog.find((item) => item.id === "twitter").platforms, ["win32", "darwin"]);
  assert.equal(catalog.find((item) => item.id === "xiaohongshu").capabilities.includes("搜索笔记"), true);
  assert.equal(catalog.find((item) => item.id === "xiaohongshu").capabilities.includes("internal_runtime_capability"), false);

  const generatedSkill = fs.readFileSync(path.join(projectRoot, registry.skill.reference), "utf8");
  for (const connection of registry.connections) {
    assert.match(generatedSkill, new RegExp(`connectors/${connection.id}\\.md`));
    const connectorReference = fs.readFileSync(path.join(projectRoot, connection.skillReference), "utf8");
    assert.match(connectorReference, new RegExp(escapeRegExp(connection.cli.command)));
    assert.equal(catalog.find((item) => item.id === connection.id).skill.document, connectorReference);
  }
});

test("platform-specific connections are included only on supported systems", () => {
  const registry = readConnectionRegistry();
  const ids = (platform) => buildConnectionCatalog({ registry, platform }).map((item) => item.id);
  assert.equal(ids("win32").includes("wechat-personal"), true);
  assert.equal(ids("darwin").includes("wechat-personal"), false);
  assert.equal(ids("linux").includes("wechat-personal"), false);
  assert.equal(ids("win32").includes("xiaohongshu"), true);
  assert.equal(ids("darwin").includes("xiaohongshu"), true);
  assert.equal(ids("linux").includes("xiaohongshu"), false);
  assert.equal(ids("linux").includes("twitter"), false);
  assert.deepEqual(connectionPlatformSupport("wechat-personal", { registry, platform: "linux" }), { known: true, supported: false, name: "个人微信", platforms: ["win32"] });
  assert.deepEqual(connectionPlatformSupport("xiaohongshu", { registry, platform: "darwin" }), { known: true, supported: true, name: "小红书", platforms: ["win32", "darwin"] });
});

test("connection registry resolves from source and bundled agent layouts", () => {
  const expected = path.join(projectRoot, "registry", "connections.json");
  assert.equal(resolveConnectionRegistryPath(path.join(projectRoot, "core", "agent", "src", "connections", "catalog.js")), expected);
  assert.equal(resolveConnectionRegistryPath(path.join(projectRoot, "core", "agent", "app", "server.mjs")), expected);
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
