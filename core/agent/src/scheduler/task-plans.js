import { planWorkspace } from "../calendar/plan-workspace.js";

const TERMINAL = new Set(["completed", "failed", "interrupted", "skipped", "cancelled"]);

export function takeLegacyScheduleOwnership(calendarStore, legacyStore) {
  const rows = legacyStore.listScheduledTasks();
  // Save the original facts before pausing the old consumer's rows. A rollback
  // must not revive an obsolete rule that the unified plan has since cancelled.
  calendarStore.importLegacyScheduledTasks(rows);
  for (const row of rows) if (row.enabled) legacyStore.updateScheduledTask(row.id, { enabled: false });
}

// There is exactly one consumer of time plans. The durable claim precedes every
// side effect; a crash after claim is an interrupted run, never an implicit retry.
export class TaskPlanRunner {
  constructor({ calendarStore, store, broker, orchestrator, workspaceRoot = process.cwd(), logger = console, tickMs = 15_000, now = Date.now } = {}) {
    Object.assign(this, { calendarStore, store, broker, orchestrator, workspaceRoot, logger, tickMs, now });
    this.timer = null;
    this.startedAt = new Date(now()).toISOString();
    this.cursor = this.startedAt;
    this.ticking = false;
    this.active = new Map();
    this.closed = false;
  }

  start() {
    if (this.timer) return;
    this.closed = false;
    this.recoverInterruptedRuns();
    this.timer = setInterval(() => this.tick().catch(() => this.logger.error?.("[task-plans] 调度检查失败")), this.tickMs);
    this.timer.unref?.();
    void this.tick().catch(() => this.logger.error?.("[task-plans] 首次调度检查失败"));
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.closed = true;
  }

  recoverInterruptedRuns() {
    // Materialize before updating so changes cannot shift an offset page.
    const runs = [];
    for (let offset = 0; ; offset += 1000) {
      const page = this.calendarStore.listRuns({ limit: 1000, offset });
      runs.push(...page.items.filter((run) => !TERMINAL.has(run.status)));
      if (!page.hasMore) break;
    }
    for (const run of runs) {
      const session = run.sessionId ? this.store.getSessionRecord(run.sessionId) : null;
      const command = run.result?.commandId ? this.store.getCommand?.(run.result.commandId) : null;
      const completion = session ? this.store.getLatestEvent?.(session.id, ["session.complete"]) : null;
      if (command?.status === "queued") continue;
      if (command?.status === "done" || (completion?.payload?.success === true && (!completion.createdAt || completion.createdAt >= run.occurrenceAt))) {
        this.calendarStore.updateRun(run.id, { status: "completed", error: "", finishedAt: new Date(this.now()).toISOString() });
        continue;
      }
      this.calendarStore.updateRun(run.id, {
        status: "interrupted", error: "上次执行被中断，结果尚未确认；请查看任务后决定是否继续。",
        finishedAt: new Date(this.now()).toISOString(),
      });
      if (session && ["start", "running"].includes(session.status)) this.store.updateSession(session.id, { status: "paused" });
    }
  }

  async tick(now = new Date(this.now())) {
    if (this.ticking || this.closed) return;
    this.ticking = true;
    try {
      this.reconcileBrokerRuns();
      const asOf = now.toISOString();
      const due = this.calendarStore.schedulerDue({ asOf, startedAt: this.cursor });
      for (const occurrence of Array.isArray(due) ? due : due.items) {
        await this.trigger(occurrence.planId || occurrence.id, { now, occurrenceAt: occurrence.occurrenceAt || occurrence.startAt });
      }
      this.cursor = asOf;
    } finally { this.ticking = false; }
  }

  async trigger(planId, { now = new Date(this.now()), manual = false, occurrenceAt } = {}) {
    const identity = occurrenceAt || now.toISOString();
    const run = this.calendarStore.claimRun(planId, identity, { manual, manualOccurrence: manual && !occurrenceAt });
    if (!run) return { skipped: true, reason: "该次已领取、已取消或不需要执行" };
    const plan = { ...run.snapshot, id: planId };
    let session;
    try {
      const linkedMain = plan.mainSessionId ? this.store.getSessionRecord(plan.mainSessionId) : null;
      // Legacy rules do not carry a verified main identity. Bind their facts to
      // the local desktop owner instead of choosing a recent remote recipient.
      const main = linkedMain || this.store.getOrCreateDesktopMainSession?.({ workspaceRoot: this.workspaceRoot });
      const parentSessionId = main?.role === "main" && !main.parentSessionId ? main.id : null;
      if (!parentSessionId) throw new Error("PLAN_MAIN_SESSION_UNAVAILABLE");
      const context = { ...(plan.executionContext || plan.legacy || {}) };
      // Preserve old workspace facts in the imported plan, but never execute
      // another Space's or an operator's workspace through the legacy value.
      try { context.workspaceRoot = planWorkspace(context.workspaceRoot, this.workspaceRoot); }
      catch { context.workspaceRoot = planWorkspace(this.workspaceRoot, this.workspaceRoot); }
      const prompt = taskPlanPrompt(plan, identity);
      session = this.broker.createBrokerSession({
        action: "new", role: "worker", parentSessionId,
        workspaceName: context.workspaceName, workspaceRoot: context.workspaceRoot,
        title: `${plan.executionMode === "remind" ? "提醒" : "计划"}：${plan.title}`,
        taskDescription: taskPlanDescription(plan, identity),
      });
      this.store.updateSession(session.id, { metadata: {
        ...(session.metadata || {}), planId: plan.id, occurrenceAt: identity, planRunId: run.id,
        executionMode: plan.executionMode, source: "task-plan",
      } });
      this.calendarStore.updateRun(run.id, { status: "running", sessionId: session.id });
      if (this.orchestrator) {
        // Return immediately after dispatch, keep the claim while the ordinary
        // task executes and let its existing parent hook handle user delivery.
        const execution = this.orchestrator.runTurn(session.id, prompt, { allowCreateThread: true, userMessagePersisted: true });
        this.active.set(run.id, execution);
        void execution.then((result) => {
          if (this.closed) return;
          const failed = result?.success !== true || result?.status === "failed" || result?.blocked;
          this.calendarStore.updateRun(run.id, { status: failed ? "failed" : "completed", finishedAt: new Date(this.now()).toISOString(),
            error: failed ? "任务未完成，请查看关联任务。" : "" });
        }, () => {
          if (!this.closed) this.calendarStore.updateRun(run.id, { status: "failed", error: "执行未完成，请查看关联任务。", finishedAt: new Date(this.now()).toISOString() });
        }).catch(() => {
          this.logger.error?.("[task-plans] 执行状态写入未完成，保留已有记录供检查");
        }).finally(() => this.active.delete(run.id));
        return { task: this.calendarStore.requirePlan(planId), run: this.calendarStore.listRuns({ planId, limit: 1 }).items[0], session, delivered: true };
      }
      const result = await this.broker.dispatchSessionAction(session.id, {
        action: "send", content: prompt, workspaceName: context.workspaceName, workspaceRoot: context.workspaceRoot,
        payload: { planId: plan.id, occurrenceAt: identity, planRunId: run.id },
      });
      const updated = this.calendarStore.updateRun(run.id, { status: "dispatched", sessionId: session.id, result: { commandId: result.command.id } });
      return { task: this.calendarStore.requirePlan(planId), run: updated, session, command: result.command, delivered: result.delivered };
    } catch {
      this.calendarStore.updateRun(run.id, { status: "failed", error: session ? "任务已建立但未确认开始，请查看任务后决定是否继续。" : "无法建立计划任务，请在主对话检查执行环境。", finishedAt: now.toISOString() });
      return { skipped: false, failed: true, reason: "计划执行失败，请查看执行记录。", session };
    }
  }

  reconcileBrokerRuns() {
    if (this.orchestrator) return;
    const pending = this.calendarStore.listRuns({ status: "dispatched", limit: 1000 }).items;
    for (const run of pending) {
      const command = this.store.getCommand?.(run.result?.commandId);
      if (!["done", "failed"].includes(command?.status)) continue;
      this.calendarStore.updateRun(run.id, { status: command.status === "done" ? "completed" : "failed", finishedAt: new Date(this.now()).toISOString(),
        error: command.status === "failed" ? "执行未完成，请查看关联任务。" : "" });
    }
  }
}

export function taskPlanPrompt(plan, occurrenceAt) {
  return [
    "这是用户已授权的计划本次发生所创建的普通任务。",
    `计划 ID：${plan.id}`, `计划名称：${plan.title}`, `原始发生标识：${occurrenceAt}`,
    `本次安排时间：${plan.manual ? occurrenceAt : plan.startAt}`, `显示时区：${plan.timeZone}`,
    plan.executionMode === "remind"
      ? "执行方式：仅提醒本人。整理本次提醒内容与明确日期时间，交由主 Agent 通知；不要代做事项或联系参与人。"
      : "执行方式：由 Cove 完成下列已授权工作；完成后把结果交由主 Agent 统一交付。",
    "这只是本次执行；不要新建重复计划，不要改动整个系列。不要直接调用通知、发信或渠道发送命令。",
    "", plan.executionPrompt,
  ].join("\n");
}

function taskPlanDescription(plan, occurrenceAt) {
  const when = new Intl.DateTimeFormat("zh-CN", { timeZone: plan.timeZone, dateStyle: "full", timeStyle: "short" }).format(new Date(plan.manual ? occurrenceAt : plan.startAt));
  return [`${plan.title} · ${plan.executionMode === "remind" ? "仅提醒本人" : "交给 Cove"}`, `本次时间：${when}（${plan.timeZone}）`, "", plan.executionPrompt].join("\n");
}
