import Link from "next/link";
import { Clock3, History, MessageSquareText } from "lucide-react";
import { Badge, DetailHeader, KeyValueGrid } from "../desktop-v72/primitives";
import { absoluteDateTime, describeCron, formatScheduleDateTime, timezoneLabel } from "./scheduled-task-formatters";
import type { ScheduledTask } from "./scheduled-task-types";

export function ScheduledTaskDetail({ task }: { task: ScheduledTask }) {
  const schedule = describeCron(task.cron);
  const timezone = timezoneLabel(task.timezone);
  const nextRun = task.enabled ? formatScheduleDateTime(task.nextRunAt, task.timezone) : "已暂停";
  const absoluteNextRun = absoluteDateTime(task.nextRunAt);

  return <div className="detail-wrap schedule-detail-wrap">
    <DetailHeader title={task.name} meta={`${schedule} · ${timezone}`} trailing={<Badge tone={task.enabled ? "success" : "warning"}>{task.enabled ? "运行中" : "已暂停"}</Badge>} />
    <section className="schedule-next-run" aria-label="下次运行">
      <Clock3 aria-hidden="true" />
      <div><span>下次运行</span>{absoluteNextRun && task.enabled ? <time dateTime={absoluteNextRun} title={absoluteNextRun}>{nextRun}</time> : <strong>{nextRun}</strong>}</div>
      <code>{task.cron}</code>
    </section>
    <section className="detail-section">
      <h2>计划设置</h2>
      <KeyValueGrid items={[
        { label: "执行频率", value: schedule },
        { label: "时区", value: timezone },
        { label: "工作区", value: task.workspaceName || "默认工作区" },
        { label: "完成通知", value: task.recipientId ? "指定微信联系人" : "最近微信联系人（如可用）" },
      ]} />
    </section>
    <section className="detail-section">
      <h2>任务内容</h2>
      <div className="schedule-prompt"><MessageSquareText aria-hidden="true" /><p>{task.prompt}</p></div>
    </section>
    <RecentScheduledRun task={task} />
  </div>;
}

function RecentScheduledRun({ task }: { task: ScheduledTask }) {
  const absoluteLastRun = absoluteDateTime(task.lastRunAt);
  return <section className="detail-section schedule-history-section">
    <h2>最近执行</h2>
    {task.lastRunAt ? <article className="schedule-run-row">
      <History aria-hidden="true" />
      <div>
        <time dateTime={absoluteLastRun} title={absoluteLastRun}>{formatScheduleDateTime(task.lastRunAt, task.timezone)}</time>
        <p>{task.lastError ? "任务已触发，但完成通知或本次执行需要注意。" : "已创建普通任务，可继续在任务列表中查看。"}</p>
        <small>累计触发 {task.runCount} 次</small>
      </div>
      <div className="schedule-run-actions">
        <Badge tone={task.lastError ? "warning" : "success"}>{task.lastError ? "需注意" : "已完成"}</Badge>
        {task.lastSessionId ? <Link href={`/app/workers?task=${encodeURIComponent(task.lastSessionId)}`}>查看任务</Link> : null}
      </div>
    </article> : <div className="schedule-history-empty"><History aria-hidden="true" /><span>{task.lastError ? "最近一次触发未完成，请检查本机 Agent。" : "还没有执行记录。"}</span></div>}
  </section>;
}
