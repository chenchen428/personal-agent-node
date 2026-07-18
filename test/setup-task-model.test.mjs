import assert from "node:assert/strict";
import test from "node:test";

import { buildSetupTaskModel, canonicalSetupAction, managedCloudActionMessage, validateLocalPasswordInput } from "../core/app/src/lib/setup-tasks.ts";

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

test("setup task model promotes public domain and Agent mail into one current task", () => {
  const model = buildSetupTaskModel([
    check("connectivity.mode", "conditional", "not-selected", "connectivity", ["connectivity.choose-mode"]),
    check("connectivity.enrollment", "conditional", "not-selected", "connectivity", ["connectivity.managed-authorize"]),
    check("mail.identity", "conditional", "not-selected", "mail-identity", ["connectivity.managed-authorize"]),
    check("mail.local-ingest", "optional", "not-selected", "local-mail", ["mail.enable"]),
    check("connections.wechat", "optional", "not-selected", "connections", ["connections.wechat.bind"]),
  ]);
  assert.equal(model.requiredTasks.length, 1);
  assert.equal(model.requiredTasks[0].check.id, "connectivity.public-and-mail");
  assert.equal(model.requiredTasks[0].title, "验证公网域名与 Agent 邮箱");
  assert.equal(model.requiredTasks[0].actionId, "connectivity.managed-authorize");
  assert.deepEqual(model.optionalTasks.map((task) => task.check.id), ["mail.local-ingest"]);
  assert.equal(model.onlineReady, false);
  assert.equal(canonicalSetupAction("connectivity.repair"), "connectivity.managed-authorize");
});

test("setup task model keeps a selected but broken remote connection actionable", () => {
  const model = buildSetupTaskModel([
    check("connectivity.mode", "conditional", "ready", "connectivity", ["connectivity.choose-mode"]),
    check("connectivity.enrollment", "conditional", "ready", "connectivity", ["connectivity.managed-authorize"]),
    check("connectivity.tunnel", "conditional", "action-required", "connectivity", ["connectivity.repair"]),
    check("mail.identity", "conditional", "action-required", "mail-identity", ["connectivity.managed-authorize"]),
  ]);
  assert.equal(model.optionalTasks.length, 0);
  assert.equal(model.requiredTasks.length, 1);
  assert.equal(model.requiredTasks[0].check.id, "connectivity.public-and-mail");
});

test("setup task model completes the unified task only after enrollment and mail identity are ready", () => {
  const model = buildSetupTaskModel([
    check("connectivity.enrollment", "conditional", "ready", "connectivity", ["connectivity.managed-authorize"]),
    check("mail.identity", "conditional", "ready", "mail-identity", ["connectivity.managed-authorize"]),
  ]);
  assert.equal(model.requiredTasks.length, 0);
  assert.equal(model.onlineReady, true);
});

test("local password validation explains every blocked submission", () => {
  assert.match(validateLocalPasswordInput("", ""), /请输入/);
  assert.match(validateLocalPasswordInput("short", "short"), /还差 7 个/);
  assert.match(validateLocalPasswordInput("customer-owned-password", ""), /再次输入/);
  assert.match(validateLocalPasswordInput("customer-owned-password", "different-password"), /不一致/);
  assert.equal(validateLocalPasswordInput("customer-owned-password", "customer-owned-password"), "");
});

test("managed Cloud action always explains waiting and failed states", () => {
  assert.match(managedCloudActionMessage({ state: "running", phase: "enrollment" }), /浏览器中确认/);
  assert.match(managedCloudActionMessage({ state: "running", phase: "resources" }), /正在分配公网域名/);
  assert.match(managedCloudActionMessage({ state: "failed", phase: "enrollment", code: "DEPENDENCY_UNAVAILABLE" }), /本机使用不受影响/);
  assert.match(managedCloudActionMessage({ state: "failed", phase: "enrollment", code: "UNKNOWN" }), /重新验证/);
});
