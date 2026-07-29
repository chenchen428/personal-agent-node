"use client";

import { Check, Circle, LoaderCircle, RotateCcw } from "lucide-react";
import type { Session } from "./types";
import { MarkdownContent } from "./markdown-content";
import { formatTime } from "./shared";
import { isWorkerRunning } from "./use-worker-sessions";
import { workerStatusLabel } from "./worker-status";
import { TaskLifecycleStatus } from "./task-lifecycle-status";

export function TaskConversation({ session, resuming, onResume }: {
  session: Session;
  resuming: boolean;
  onResume: (sessionId: string) => void;
}) {
  const messages = (session.messages || []).filter((item) => ["user", "assistant", "agent"].includes(item.role));
  const plan = session.currentPlan?.steps || [];
  const paused = session.status === "paused";

  return <div className="v72-task-conversation">
    <header className="v72-task-head">
      <div><span>任务 · {workerStatusLabel(session.status)}</span><h1>{session.title || "未命名任务"}</h1><p>{session.summary || session.taskDescription || "任务进展保存在本机工作区。"}</p></div>
      <div className="v72-task-head-actions">
        <span className={`v72-badge ${isWorkerRunning(session.status) || paused ? "warning" : "success"}`}>{workerStatusLabel(session.status)}</span>
        {paused ? <button className="v72-task-resume" type="button" disabled={resuming} onClick={() => onResume(session.id)}>
          {resuming ? <LoaderCircle className="v72-spin" aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
          {resuming ? "正在恢复" : "恢复任务"}
        </button> : null}
      </div>
    </header>
    <div className="v72-task-scroll"><div className="v72-task-thread">
      {messages.map((message, index) => <div key={message.id}><article className={`v72-task-message${message.role === "user" ? " user" : ""}`}><span className={`v72-task-avatar${message.role === "user" ? " user" : ""}`}>{message.role === "user" ? "你" : "PA"}</span><div><MarkdownContent className="v72-task-body" content={message.content} /><time>{formatTime(message.createdAt)}</time></div></article>{index === 0 && plan.length ? <TaskPlan session={session} /> : null}</div>)}
      {!messages.length ? <div className="v72-empty">任务暂无对话记录</div> : null}
      {plan.length && !messages.length ? <TaskPlan session={session} /> : null}
      <TaskLifecycleStatus session={session} />
    </div></div>
  </div>;
}

function TaskPlan({ session }: { session: Session }) {
  const steps = session.currentPlan?.steps || [];
  return <section className="v72-task-plan"><header><strong>{session.currentPlan?.title || "执行计划"}</strong><span>{steps.filter((item) => item.status === "completed").length}/{steps.length}</span></header><ol>{steps.map((item, index) => <li data-status={item.status} key={`${index}-${item.step}`}>{item.status === "completed" ? <Check /> : item.status === "in_progress" ? <LoaderCircle className="v72-spin" /> : <Circle />}<span>{item.step}</span></li>)}</ol></section>;
}
