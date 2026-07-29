"use client";

import { AlertCircle, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { firstCharacter, formatDateTime, relativeTaskTime, richText } from "./data";
import type { ChatAttachment, PlanStep, TaskDisplayEvent } from "./types";

export function TaskConversationContent({
  items,
  plan,
  userName,
  loadingEarlier,
  positioned,
  runtime,
}: {
  items: TaskDisplayEvent[];
  plan: PlanStep[];
  userName: string;
  loadingEarlier: boolean;
  positioned: boolean;
  runtime: ReactNode;
}) {
  return <section className="mobile-task-conversation" data-positioned={positioned}>
    <div className="mobile-task-thread" aria-live="polite">
      {loadingEarlier ? <div className="mobile-task-history-loader" role="status"><i aria-hidden="true" />正在读取更早进展</div> : null}
      {items.map((item, index) => <div key={item.displayEventId}>
        <TaskMessage item={item} userName={userName} />
        {index === 1 && plan.length ? <TaskPlan steps={plan} /> : null}
      </div>)}
      {plan.length && items.length < 2 ? <TaskPlan steps={plan} /> : null}
      {runtime}
    </div>
  </section>;
}

function TaskMessage({ item, userName }: { item: TaskDisplayEvent; userName: string }) {
  const user = item.role === "user";
  const content = <div>
    {item.content?.trim() ? <div className="mobile-task-message-body">{richText(item.content)}</div> : null}
    <TaskMessageAttachments attachments={item.metadata?.attachments || []} />
    <time dateTime={item.createdAt} title={formatDateTime(item.createdAt)}>{relativeTaskTime(item.createdAt)}</time>
  </div>;
  return <article className={`mobile-task-message ${user ? "user" : "agent"}`}>
    {user
      ? <><span className="mobile-task-avatar user" aria-label={userName}>{firstCharacter(userName)}</span>{content}</>
      : <><span className="mobile-task-avatar agent" aria-label="PA">PA</span>{content}</>}
  </article>;
}

function TaskMessageAttachments({ attachments }: { attachments: ChatAttachment[] }) {
  if (!attachments.length) return null;
  return <div className="mobile-task-message-attachments">{attachments.map((attachment) => attachment.kind === "image" && attachment.previewUrl
    ? <a href={attachment.previewUrl} target="_blank" rel="noreferrer" key={attachment.objectId || attachment.name}>
      <img src={attachment.previewUrl} alt={attachment.alt || attachment.name} width={attachment.width} height={attachment.height} />
      <span><strong>{attachment.caption || attachment.name}</strong><small>{attachment.width && attachment.height ? `${attachment.width} × ${attachment.height} · ` : ""}{attachmentDeliveryLabel(attachment.deliveryState)}</small></span>
    </a>
    : (attachment.downloadUrl || attachment.previewUrl) ? <a className="mobile-task-file" href={attachment.downloadUrl || attachment.previewUrl} key={attachment.objectId || attachment.name}>
      <i aria-hidden="true">{fileType(attachment.name)}</i>
      <span><strong>{attachment.caption || attachment.name}</strong><small>{formatAttachmentBytes(attachment.sizeBytes)} · {attachmentDeliveryLabel(attachment.deliveryState)}</small></span>
      <em>下载</em>
    </a> : null)}</div>;
}

function TaskPlan({ steps }: { steps: PlanStep[] }) {
  const completed = steps.filter((step) => step.status === "completed").length;
  return <section className="mobile-task-plan" aria-label="本轮计划">
    <header><strong>本轮计划</strong><span>{completed} / {steps.length}</span></header>
    <ol>{steps.map((step, index) => <li data-status={step.status} key={`${index}-${step.step}`}><i aria-hidden="true">{step.status === "completed" ? "✓" : ""}</i><span>{step.step}</span></li>)}</ol>
  </section>;
}

export function TaskLoading() {
  return <div className="mobile-task-state loading" role="status" aria-label="正在加载任务详情">
    <div className="mobile-task-loading-thread" aria-hidden="true">
      <div className="mobile-task-loading-message user"><div className="mobile-task-skeleton bubble"><i /><i /></div><div className="mobile-task-skeleton avatar" /></div>
      <div className="mobile-task-loading-message agent"><div className="mobile-task-skeleton avatar" /><div className="mobile-task-loading-copy"><i /><i /><i /></div></div>
      <div className="mobile-task-skeleton plan"><div className="mobile-task-loading-plan-header"><i /><i /></div><div className="mobile-task-loading-step"><b /><i /></div><div className="mobile-task-loading-step"><b /><i /></div><div className="mobile-task-loading-step"><b /><i /></div></div>
    </div>
    <div className="mobile-task-loading-label"><i aria-hidden="true" /><span>正在读取最新进展</span></div>
  </div>;
}

export function TaskUnavailable({ error = false }: { error?: boolean }) {
  const Icon = error ? AlertCircle : Inbox;
  return <div className={`mobile-task-state ${error ? "error" : "empty"}`} role="status">
    <Icon aria-hidden="true" />
    <strong>{error ? "暂时无法读取任务" : "还没有可展示的进展"}</strong>
    <p>{error ? "连接恢复后重新打开本页即可继续查看。" : "任务产生可见回复后，会按时间顺序显示在这里。"}</p>
  </div>;
}

function attachmentDeliveryLabel(state?: ChatAttachment["deliveryState"]) {
  return state === "failed" ? "发送失败" : state === "sending" ? "发送中" : state === "sent" ? "已发送" : "待发送";
}

function fileType(name: string) { return name.split(".").pop()?.slice(0, 5).toUpperCase() || "FILE"; }
function formatAttachmentBytes(value = 0) { if (value < 1024) return `${value} B`; if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`; return `${(value / 1024 ** 2).toFixed(1)} MB`; }
