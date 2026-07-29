import assert from "node:assert/strict";
import test from "node:test";
import { isLocalDesktopSpaceManagementRequest } from "../core/app/src/lib/request-device.ts";

function headers(values) {
  const normalized = new Map(Object.entries(values).map(([name, value]) => [name.toLowerCase(), value]));
  return { get: (name) => normalized.get(name.toLowerCase()) || null };
}

test("space management is accepted only from the marked local desktop surface", () => {
  assert.equal(isLocalDesktopSpaceManagementRequest(headers({ host: "127.0.0.1:8791", "user-agent": "Desktop", "x-personal-agent-surface": "desktop" })), true);
  assert.equal(isLocalDesktopSpaceManagementRequest(headers({ host: "[::1]:8791", "user-agent": "Desktop", "x-personal-agent-surface": "desktop" })), true);
  assert.equal(isLocalDesktopSpaceManagementRequest(headers({ host: "127.0.0.1:8791", "user-agent": "Desktop" })), false);
  assert.equal(isLocalDesktopSpaceManagementRequest(headers({ host: "127.0.0.1:8791", "user-agent": "Mobile Safari", "x-personal-agent-surface": "desktop" })), false);
  assert.equal(isLocalDesktopSpaceManagementRequest(headers({ host: "space.example.com", "user-agent": "Desktop", "x-personal-agent-surface": "desktop" })), false);
});
