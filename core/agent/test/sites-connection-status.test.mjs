import assert from "node:assert/strict";
import test from "node:test";
import { buildSitesConnectionStatus } from "../src/connections/sites-status.js";

const verification = { phase: "verified" };

test("sites connection reports a healthy public tunnel independently from domain binding", () => {
  const status = buildSitesConnectionStatus({
    domainReady: true,
    domain: "owner.example.test",
    verified: true,
    external: { ready: true, reason: "ready", origin: "https://owner.example.test" },
    verification,
  });

  assert.equal(status.state, "connected");
  assert.equal(status.statusLabel, "公网访问正常");
  assert.equal(status.details.publicReady, true);
  assert.equal(status.details.publicStatus, "ready");
});

test("sites connection becomes degraded when the bound reverse tunnel is offline", () => {
  const status = buildSitesConnectionStatus({
    domainReady: true,
    domain: "owner.example.test",
    verified: true,
    external: { ready: false, reason: "tunnel-offline", origin: "" },
    verification,
  });

  assert.equal(status.state, "degraded");
  assert.equal(status.statusLabel, "公网穿透离线");
  assert.equal(status.details.platformDomainBound, true);
  assert.equal(status.details.publicReady, false);
  assert.equal(status.details.publicStatus, "tunnel-offline");
  assert.equal(status.runtime.find((item) => item.label === "公网访问")?.value, "安全穿透离线");
});

test("sites connection remains locally connected before a platform domain is bound", () => {
  const status = buildSitesConnectionStatus({
    domainReady: false,
    domain: "",
    verified: false,
    external: { ready: false, reason: "local-only", origin: "" },
    verification: { phase: "idle" },
  });

  assert.equal(status.state, "connected");
  assert.equal(status.statusLabel, "本地已连接");
  assert.equal(status.details.publicStatus, "not-bound");
});
