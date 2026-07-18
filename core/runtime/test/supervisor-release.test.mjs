import assert from "node:assert/strict";
import test from "node:test";
import { supervisorReleaseState } from "../src/supervisor.ts";

test("reuses a living supervisor from the current release", () => {
  assert.equal(supervisorReleaseState({ pid: 42, releaseRoot: "/opt/personal-agent/releases/v2" }, "/opt/personal-agent/releases/v2", { alive: true }), "current");
});

test("replaces a living supervisor from another release", () => {
  assert.equal(supervisorReleaseState({ pid: 42, releaseRoot: "/opt/personal-agent/releases/v1" }, "/opt/personal-agent/releases/v2", { alive: true }), "replace");
});

test("replaces a legacy living supervisor without release identity", () => {
  assert.equal(supervisorReleaseState({ pid: 42 }, "/opt/personal-agent/releases/v2", { alive: true }), "replace");
});

test("starts normally when the recorded supervisor is not alive", () => {
  assert.equal(supervisorReleaseState({ pid: 42, releaseRoot: "/opt/personal-agent/releases/v1" }, "/opt/personal-agent/releases/v2", { alive: false }), "stopped");
});
