import Link from "next/link";
import type { CurrentPlan } from "./types";

export function ConversationPlan({ plan }: { plan?: CurrentPlan | null }) {
  if (!plan?.steps.length) return null;
  return <section className="plan-block" aria-label="当前任务计划"><header><span>本轮计划</span><span>{plan.completed} / {plan.steps.length}</span></header>{plan.steps.map((item, index) => <div className={`plan-step${item.status === "completed" ? " done" : ""}`} data-plan-status={item.status} key={`${index}-${item.step}`}><span aria-hidden="true">{item.status === "completed" ? "✓" : <i className={`status-dot${item.status === "in_progress" ? " success" : ""}`} />}</span>{item.step}</div>)}{plan.href ? <Link className="plan-task-link" href={plan.href}>查看任务</Link> : null}</section>;
}
