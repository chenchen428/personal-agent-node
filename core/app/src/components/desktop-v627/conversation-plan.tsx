import Link from "next/link";
import type { CurrentPlan } from "./types";

export function ConversationPlan({ plan }: { plan?: CurrentPlan | null }) {
  if (!plan?.steps.length) return null;
  return <section className="desktop-chat-checkpoint" aria-label="当前任务计划">
    <header>
      <div>
        <span className="desktop-chat-checkpoint-icon" aria-hidden="true">✓</span>
        <strong>{plan.title}</strong>
        <small>已完成 {plan.completed} / {plan.steps.length}</small>
      </div>
      {plan.href ? <Link href={plan.href}>查看任务</Link> : null}
    </header>
    <ol>{plan.steps.map((item, index) =>
      <li className={item.status === "completed" ? "done" : ""} data-plan-status={item.status} key={`${index}-${item.step}`}>
        <span aria-hidden="true" />{item.step}
      </li>)}
    </ol>
  </section>;
}
