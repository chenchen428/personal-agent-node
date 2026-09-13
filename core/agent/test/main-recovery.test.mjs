import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BridgeStore } from "../src/store/store.js";
import { SessionOrchestrator } from "../src/server/orchestrator.js";

function setup(t, run, options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cove-main-recovery-"));
  const store = new BridgeStore({ dataDir });
  const main = store.getOrCreateDesktopMainSession({ workspaceRoot: dataDir });
  store.updateSession(main.id, { status: "running", cliSessionId: "existing-thread" });
  const orchestrator = new SessionOrchestrator({ store, hub: { broadcast() {} }, channels: {}, siteDataRoot: dataDir,
    progressTimerEnabled: false, dailyTokenLimit: () => ({ dailyLimitMillions: 0, dailyLimitTokens: 0 }),
    runner: { runAppServerCommand: run, stopAppServerCommand: () => false }, ...options });
  t.after(() => { orchestrator.stop(); store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  return { store, main, orchestrator, dataDir };
}
function user(store, id, content) { store.appendEvent(id, "session.user_message", { content, source: "desktop" }); }
async function reply(config, content) {
  await config.onSessionEvent({ sessionId: config.sessionId, kind: "session.user_message", payload: { content: config.stdin } });
  await config.onSessionEvent({ sessionId: config.sessionId, kind: "session.assistant_message", payload: { content, metadata: { streamState: "completed" } } });
  await config.onSessionEvent({ sessionId: config.sessionId, kind: "session.complete", payload: { success: true, idle: true } });
  return { success: true };
}

test("unfinished main request resumes the same session and thread once with original history", async t => {
  const calls = [];
  const { store, main, orchestrator } = setup(t, async config => { calls.push(config); return reply(config, "剩余步骤已完成。"); });
  user(store, main.id, "旧问题");
  user(store, main.id, "完成最新一份报告并交付");
  store.appendEvent(main.id, "session.tool_result", { content: "报告底稿已生成，还差汇总和交付" });
  const before = store.getSession(main.id).events.map(event => event.id);
  const [first, second] = await Promise.all([orchestrator.recoverInterruptedMainSessions(), orchestrator.recoverInterruptedMainSessions()]);
  assert.deepEqual(first, second); assert.equal(first.completed, 1); assert.equal(calls.length, 1);
  assert.equal(calls[0].sessionId, main.id); assert.equal(calls[0].cliSessionId, "existing-thread"); assert.equal(calls[0].allowCreateThread, false);
  assert.match(calls[0].stdin, /^\[main-recovery:continue\]/); assert.match(calls[0].stdin, /完成最新一份报告并交付/); assert.match(calls[0].stdin, /报告底稿已生成/);
  assert.match(calls[0].appServerDeveloperInstructions, /主 Agent/);
  assert.equal(store.getSessionRecord(main.id).status, "idle");
  assert.deepEqual(store.getSession(main.id).events.slice(0, before.length).map(event => event.id), before);
  assert.equal(store.getSession(main.id).messages.filter(message => message.role === "user").length, 2);
  await orchestrator.recoverInterruptedMainSessions(); assert.equal(calls.length, 1);
});

test("finished work lacking its final reply reuses the completion evidence without redoing work", async t => {
  let sentReplies = 0; let repeatedWrites = 0;
  const { store, main, orchestrator } = setup(t, async config => {
    assert.match(config.stdin, /页面已发布，回执 page-fixture/);
    assert.match(config.stdin, /已完成但尚未向用户交付的工作，直接补全最终回复/);
    if (!config.stdin.includes("页面已发布，回执 page-fixture")) repeatedWrites += 1;
    sentReplies += 1; return reply(config, "页面已完成，结果已补充到原对话。");
  });
  user(store, main.id, "制作页面并告诉我结果");
  store.appendEvent(main.id, "session.tool_result", { content: "页面已发布，回执 page-fixture" });
  await orchestrator.recoverInterruptedMainSessions();
  assert.equal(sentReplies, 1); assert.equal(repeatedWrites, 0); assert.equal(store.getSession(main.id).messages.at(-1).content, "页面已完成，结果已补充到原对话。");
});

test("unknown external side effects are explicitly checked before any recovery retry", async t => {
  const { store, main, orchestrator } = setup(t, async config => {
    assert.match(config.stdin, /发送请求已提交，但回执未知/);
    assert.match(config.stdin, /先通过对应能力查询真实状态和已有回执/);
    assert.match(config.stdin, /不得盲目重试/);
    assert.match(config.stdin, /已经交付的结果不要再次执行或重复发送/);
    return reply(config, "已有回执确认发送完成，没有重复发送。");
  });
  user(store, main.id, "发送已经确认的报告");
  store.appendEvent(main.id, "session.tool_use", { content: "发送请求已提交，但回执未知" });
  await orchestrator.recoverInterruptedMainSessions(); assert.equal(store.getSessionRecord(main.id).status, "idle");
});

test("runtime resume failure pauses exactly once with a safe actionable cause", async t => {
  const { store, main, orchestrator } = setup(t, async () => { throw new Error("credential invalid: secret-fixture-value"); });
  user(store, main.id, "继续完成报告");
  const result = await orchestrator.recoverInterruptedMainSessions();
  assert.equal(result.failed, 1); assert.equal(store.getSessionRecord(main.id).status, "paused");
  const errors = store.getSession(main.id).events.filter(event => event.kind === "session.error");
  assert.equal(errors.length, 1); assert.match(errors[0].payload.content, /运行设置恢复登录/); assert.doesNotMatch(errors[0].payload.content, /secret-fixture-value/);
  await orchestrator.recoverInterruptedMainSessions(); assert.equal(store.getSession(main.id).events.filter(event => event.kind === "session.error").length, 1);
});

test("runner persisted failure or an explicit stop retains its existing terminal event", async t => {
  for (const kind of ["session.error", "session.status"]) {
    const { store, main, orchestrator } = setup(t, async config => {
      await config.onSessionEvent({ sessionId: config.sessionId, kind, payload: { content: "已明确暂停本次恢复", status: "paused" } });
      return { success: false, status: "interrupted" };
    });
    user(store, main.id, "处理我的请求"); await orchestrator.recoverInterruptedMainSessions();
    assert.equal(store.getSessionRecord(main.id).status, "paused");
    assert.equal(store.getSession(main.id).events.filter(event => event.kind === "session.error" || event.payload.status === "paused").length, 1);
  }
});

test("start without an engine thread may create one, and absent user intent is safely paused", async t => {
  let calls = 0;
  const { store, main, orchestrator } = setup(t, async config => { calls += 1; assert.equal(config.cliSessionId, undefined); assert.equal(config.allowCreateThread, true); return reply(config, "已完成"); });
  store.updateSession(main.id, { status: "start", cliSessionId: "" }); user(store, main.id, "刚收到但还没启动的请求");
  await orchestrator.recoverInterruptedMainSessions(); assert.equal(calls, 1);
  const absent = setup(t, async () => { throw new Error("must not run"); });
  await absent.orchestrator.recoverInterruptedMainSessions();
  assert.equal(absent.store.getSessionRecord(absent.main.id).status, "paused"); assert.match(absent.store.getSession(absent.main.id).messages.at(-1).content, /未找到可核实的原始用户请求/);
});

test("idle/paused mains and an already executing main are never restarted", async t => {
  const { store, main, orchestrator } = setup(t, async () => { throw new Error("must not run"); });
  user(store, main.id, "原请求"); orchestrator.running.add(main.id);
  const result = await orchestrator.recoverInterruptedMainSessions();
  assert.deepEqual(result.skippedSessionIds, [main.id]); assert.equal(result.recovered, 0);
  orchestrator.running.delete(main.id);
  for (const status of ["idle", "paused"]) {
    const other = setup(t, async () => { throw new Error("must not run"); }); other.store.updateSession(other.main.id, { status });
    assert.equal((await other.orchestrator.recoverInterruptedMainSessions()).discovered, 0);
  }
});

test("a runner returning without a terminal event is paused rather than left running", async t => {
  const { store, main, orchestrator } = setup(t, async () => ({ success: true }));
  user(store, main.id, "请完成原任务");
  const result = await orchestrator.recoverInterruptedMainSessions();
  assert.equal(result.failed, 1); assert.equal(store.getSessionRecord(main.id).status, "paused");
  assert.match(store.getSession(main.id).messages.at(-1).content, /未收到明确完成状态/);
});

test("an older failed recovery cannot overwrite a newer user turn's state", async t => {
  const { store, main, orchestrator } = setup(t, async () => ({ success: true }));
  user(store, main.id, "原任务");
  // Race at the awaited turn boundary: a new user turn takes ownership before recovery returns.
  orchestrator.runTurn = async () => {
    orchestrator.turnVersions.set(main.id, 1);
    await Promise.resolve();
    orchestrator.turnVersions.set(main.id, 2);
    store.updateSession(main.id, { status: "running" });
    throw new Error("old recovery failed");
  };
  await orchestrator.recoverInterruptedMainSessions();
  assert.equal(store.getSessionRecord(main.id).status, "running");
  assert.equal(store.getSession(main.id).events.filter(event => event.kind === "session.error").length, 0);
});

test("normal service stop preserves main recovery, while user stop stays paused after restart", async t => {
  for (const userStopped of [false, true]) {
    let stopTurn;
    const { store, main, orchestrator, dataDir } = setup(t, config => new Promise(resolve => {
      stopTurn = async () => {
        await config.onSessionEvent({ sessionId: main.id, kind: "session.complete", payload: { success: false, aborted: true, content: "Turn interrupted" } });
        resolve({ success: false, status: "interrupted" });
      };
    }));
    user(store, main.id, "完成已开始的报告");
    orchestrator.runner.stopAppServerCommand = () => { void stopTurn(); return true; };
    const turn = orchestrator.runTurn(main.id, "完成已开始的报告");
    if (userStopped) orchestrator.stopSession(main.id);
    orchestrator.stop(); await turn;
    assert.equal(store.getSessionRecord(main.id).status, userStopped ? "paused" : "running");
    let recovered = 0;
    const restarted = new SessionOrchestrator({ store, hub: { broadcast() {} }, channels: {}, siteDataRoot: dataDir,
      progressTimerEnabled: false, dailyTokenLimit: () => ({ dailyLimitMillions: 0, dailyLimitTokens: 0 }),
      runner: { runAppServerCommand: async config => { recovered += 1; return reply(config, "重启后已完成原报告。"); }, stopAppServerCommand: () => false } });
    await restarted.recoverInterruptedMainSessions(); restarted.stop();
    assert.equal(recovered, userStopped ? 0 : 1);
    assert.equal(store.getSessionRecord(main.id).status, userStopped ? "paused" : "idle");
  }
});

test("a main that finishes successfully during shutdown remains completed", async t => {
  let complete;
  const { store, main, orchestrator } = setup(t, config => new Promise(resolve => { complete = async () => { resolve(await reply(config, "已完成并交付。")); }; }));
  user(store, main.id, "完成报告");
  orchestrator.runner.stopAppServerCommand = () => { void complete(); return true; };
  const turn = orchestrator.runTurn(main.id, "完成报告"); orchestrator.stop(); await turn;
  assert.equal(store.getSessionRecord(main.id).status, "idle");
  assert.equal(orchestrator.shutdownMainSessions.has(main.id), false);
});
