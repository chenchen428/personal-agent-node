import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildConnectionCatalog, readConnectionRegistry, resolveConnectionRegistryPath } from "../src/connections/catalog.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("connection catalog is the shared UI, Skill, and CLI contract", () => {
  const registry = readConnectionRegistry();
  const catalog = buildConnectionCatalog({ registry, platform: "win32", statuses: {
    notion: { state: "connected", statusLabel: "已连接" },
    xiaohongshu: { state: "ready", statusLabel: "浏览器可用", capabilities: ["internal_runtime_capability"], setup: { customExtensionRequired: false } },
  } });
  assert.deepEqual(catalog.map((item) => item.id), ["wechat", "wechat-personal", "xiaohongshu", "twitter", "notion", "mail", "sites"]);
  assert.equal(catalog.find((item) => item.id === "wechat").setupRequired, false);
  assert.equal(catalog.find((item) => item.id === "wechat").accessMode, "account");
  assert.equal(catalog.find((item) => item.id === "wechat").name, "微信 claw");
  assert.equal(catalog.find((item) => item.id === "wechat-personal").accessMode, "local");
  assert.equal(catalog.find((item) => item.id === "mail").defaultConnected, true);
  assert.equal(catalog.find((item) => item.id === "sites").defaultConnected, true);
  assert.equal(catalog.find((item) => item.id === "notion").cli.command, "ntn");
  assert.equal(catalog.find((item) => item.id === "xiaohongshu").accessMode, "browser");
  assert.equal(catalog.find((item) => item.id === "xiaohongshu").skill.name, "social-browser-read");
  assert.equal(catalog.find((item) => item.id === "xiaohongshu").setup.customExtensionRequired, false);
  assert.equal(catalog.find((item) => item.id === "twitter").accessMode, "browser");
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

test("personal WeChat is only included on Windows", () => {
  const registry = readConnectionRegistry();
  assert.equal(buildConnectionCatalog({ registry, platform: "win32" }).some((item) => item.id === "wechat-personal"), true);
  assert.equal(buildConnectionCatalog({ registry, platform: "darwin" }).some((item) => item.id === "wechat-personal"), false);
  assert.equal(buildConnectionCatalog({ registry, platform: "linux" }).some((item) => item.id === "wechat-personal"), false);
});

test("connection registry resolves from source and bundled agent layouts", () => {
  const expected = path.join(projectRoot, "registry", "connections.json");
  assert.equal(resolveConnectionRegistryPath(path.join(projectRoot, "core", "agent", "src", "connections", "catalog.js")), expected);
  assert.equal(resolveConnectionRegistryPath(path.join(projectRoot, "core", "agent", "app", "server.mjs")), expected);
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
