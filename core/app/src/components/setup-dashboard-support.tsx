"use client";

import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { SetupState, SetupTask } from "@/lib/setup-tasks";
import { Check, ChevronDown, Circle, RefreshCw } from "lucide-react";

export function SetupTodoItem({ task, index, action }: { task: SetupTask; index: number; action: ReactNode }) {
  const [open, setOpen] = useState(index === 1 || task.actionId === "connections.wechat.bind");
  return <li className={`setup-task-row ${open ? "is-open" : ""}`}>
    <button type="button" className="setup-task-summary" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--canvas)] font-[var(--mono)] text-[10px] text-[var(--coral)] ring-1 ring-[var(--hairline)]">{String(index).padStart(2, "0")}</span>
      <span className="setup-task-title"><small>{task.category}</small><strong>{task.title}</strong></span>
      {task.waitingCount ? <span className="setup-task-waiting">后续 {task.waitingCount} 项</span> : null}
      <Badge variant="warning">需处理</Badge>
      <ChevronDown className="setup-task-chevron size-4" />
    </button>
    {open ? <div className="setup-task-content">
      <p>{task.check.guidance}</p>
      <details className="group text-xs text-[var(--muted)]"><summary className="flex w-max cursor-pointer list-none items-center gap-1">为什么需要这一步<ChevronDown className="size-3.5 transition-transform group-open:rotate-180" /></summary><p className="mt-2 mb-0 border-l-2 border-[var(--hairline)] pl-3 leading-relaxed">{task.check.why}</p></details>
      <div>{action}</div>
    </div> : null}
  </li>;
}

export function SetupStatusIcon({ state }: { state: SetupState }) {
  if (state === "ready") return <Check className="size-3.5 text-[var(--success)]" />;
  if (state === "checking") return <RefreshCw className="size-3.5 animate-spin text-[var(--coral)]" />;
  if (state === "blocked") return <Circle className="size-3.5 text-[var(--error)]" />;
  return <Circle className="size-3.5 text-[var(--warning)]" />;
}
