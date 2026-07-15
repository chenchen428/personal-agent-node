import assert from "node:assert/strict";
import test from "node:test";

import { buildSetupTaskModel, canonicalSetupAction } from "../core/app/src/lib/setup-tasks.ts";

const check = (id, requirement, state, group = "installation", actionIds = [`${id}.action`]) => ({
  id, requirement, state, group, actionIds, summary: id, why: `why ${id}`, guidance: `guide ${id}`,
});

test("setup task model lists only actionable required checks and counts blocked dependents", () => {
  const model = buildSetupTaskModel([
    check("installation.release", "required-for-console", "ready"),
    check("agent.codex.executable", "required-for-agent", "action-required", "agent", ["agent.codex.install-guide"]),
    check("agent.codex.version", "required-for-agent", "blocked", "agent"),
    check("agent.codex.authentication", "required-for-agent", "blocked", "agent"),
  ]);
  assert.equal(model.requiredTasks.length, 1);
  assert.equal(model.requiredTasks[0].check.id, "agent.codex.executable");
  assert.equal(model.requiredTasks[0].waitingCount, 2);
  assert.equal(model.completedRequired, 1);
  assert.equal(model.totalRequired, 4);
  assert.equal(model.progress, 25);
});

test("setup task model keeps optional entry points separate and deduplicates cloud repair actions", () => {
  const model = buildSetupTaskModel([
    check("connectivity.mode", "conditional", "not-selected", "connectivity", ["connectivity.choose-mode"]),
    check("connectivity.tunnel", "conditional", "blocked", "connectivity", ["connectivity.repair"]),
    check("mail.local-ingest", "optional", "not-selected", "local-mail", ["mail.enable"]),
    check("channels.wechat", "optional", "not-selected", "optional-channels", ["channels.wechat.bind"]),
  ]);
  assert.deepEqual(model.optionalTasks.map((task) => task.check.id), ["connectivity.mode", "mail.local-ingest"]);
  assert.equal(model.optionalTasks[0].title, "验证公网域名与 Agent 邮箱");
  assert.equal(model.optionalTasks[0].actionId, "connectivity.managed-authorize");
  assert.equal(canonicalSetupAction("connectivity.repair"), "connectivity.managed-authorize");
});

test("setup task model keeps a selected but broken remote connection actionable", () => {
  const model = buildSetupTaskModel([
    check("connectivity.mode", "conditional", "ready", "connectivity", ["connectivity.choose-mode"]),
    check("connectivity.enrollment", "conditional", "ready", "connectivity", ["connectivity.managed-authorize"]),
    check("connectivity.tunnel", "conditional", "action-required", "connectivity", ["connectivity.repair"]),
    check("mail.identity", "conditional", "action-required", "mail-identity", ["connectivity.managed-authorize"]),
  ]);
  assert.equal(model.optionalTasks.length, 1);
  assert.equal(model.optionalTasks[0].check.id, "connectivity.tunnel");
  assert.equal(model.optionalTasks[0].title, "恢复公网域名与 Agent 邮箱");
});
