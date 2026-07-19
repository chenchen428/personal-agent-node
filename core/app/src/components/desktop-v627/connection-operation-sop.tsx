"use client";

import { Check, ChevronDown, ChevronUp, Circle, LoaderCircle, X } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

export type ConnectionOperationStep = {
  id: string;
  label: string;
  status: "pending" | "active" | "passed" | "failed";
};

export function ConnectionOperationSop({ icon, title, summary, tone, statusLabel, steps, collapsed = false, onToggle, stepPanels, children }: {
  icon: ReactNode;
  title: string;
  summary: string | null | undefined;
  tone: "working" | "success" | "danger" | "neutral";
  statusLabel: string;
  steps: ConnectionOperationStep[];
  collapsed?: boolean;
  onToggle?: () => void;
  stepPanels?: Record<string, ReactNode>;
  children?: ReactNode;
}) {
  const focusedStep = focusStep(steps);
  const focusedPanel = focusedStep ? stepPanels?.[focusedStep.id] : null;
  const head = <><span className="domain-sop-kind">{icon}</span><span><strong>{title}</strong><small>{summary}</small></span><em className={tone}>{statusLabel}</em>{onToggle ? collapsed ? <ChevronDown /> : <ChevronUp /> : <span />}</>;
  return <section className={`domain-sop connection-operation-sop${collapsed ? " collapsed" : ""}`} aria-label={`${title}流程`}>
    {onToggle ? <button className="domain-sop-head" type="button" onClick={onToggle} aria-expanded={!collapsed}>{head}</button> : <div className="domain-sop-head">{head}</div>}
    {!collapsed ? <div className="domain-sop-body"><ConnectionOperationSteps steps={steps} />{focusedPanel ? <div className="domain-sop-focus-panel" data-step={focusedStep?.id}>{focusedPanel}</div> : children}</div> : null}
  </section>;
}

export function ConnectionOperationSteps({ steps }: { steps: ConnectionOperationStep[] }) {
  return <div className="domain-sop-steps" style={{ "--connection-step-count": steps.length } as CSSProperties}>{steps.map((step, index) => <div className={`domain-sop-step ${step.status}`} key={step.id}><span>{step.status === "passed" ? <Check /> : step.status === "failed" ? <X /> : step.status === "active" ? <LoaderCircle className="connection-spinner" /> : <Circle />}</span><strong>{step.label}</strong><small>{step.status === "passed" ? "已通过" : step.status === "active" ? "进行中" : step.status === "failed" ? "未通过" : "待检测"}</small>{index < steps.length - 1 ? <i /> : null}</div>)}</div>;
}

export function focusStep(steps: ConnectionOperationStep[]) {
  return steps.find((step) => step.status === "failed")
    || steps.find((step) => step.status === "active")
    || steps.find((step) => step.status === "pending")
    || steps.at(-1)
    || null;
}
