import Link from "next/link";
import { Bot, Check, ShieldCheck } from "lucide-react";
import type { SetupCheck } from "@/lib/setup-tasks";

export type RequiredSetupStep = {
  id: "environment" | "agent";
  title: string;
  description: string;
  ready: boolean;
};

export function buildRequiredSetupSteps(checks: SetupCheck[]): RequiredSetupStep[] {
  const environment = checks.filter((check) => check.group === "installation" && check.id !== "installation.console-auth" && check.requirement === "required-for-console");
  const agent = checks.filter((check) => check.group === "agent" && check.requirement === "required-for-agent");
  return [
    { id: "environment", title: "本机环境", description: "客户端、Core 与个人工作区已就绪", ready: isReady(environment) },
    { id: "agent", title: "验证主 Agent", description: "完成授权，并确认主对话可以真实回复", ready: isReady(agent) },
  ];
}

export function RequiredSetupGuide({ steps }: { steps: RequiredSetupStep[] }) {
  const completed = steps.filter((step) => step.ready).length;
  const remaining = steps.length - completed;
  const current = steps.findIndex((step) => !step.ready);
  return <section className="v72-card v72-required-setup-card">
    <div className="v72-required-setup-intro"><div><span className="v72-setup-eyebrow">开始使用前 · {completed} / {steps.length}</span><h2>还差 {remaining} 项必要设置</h2><p>完成本机环境与主 Agent 验证后即可工作，微信等连接可稍后按需配置。</p></div><Link className="button primary" href="/app/setup">继续初始化</Link></div>
    <ol className="v72-required-setup-steps" aria-label="必要初始化进度">{steps.map((step, index) => { const Icon = step.id === "environment" ? ShieldCheck : Bot; const state = step.ready ? "done" : current === index ? "current" : "pending"; return <li className={`v72-required-setup-step ${state}`} key={step.id}><span className="v72-required-setup-step-index">{step.ready ? <Check /> : index + 1}</span><span className="v72-required-setup-step-icon"><Icon /></span><span className="v72-required-setup-step-copy"><strong>{step.title}</strong><small>{step.description}</small></span><span className={`v72-badge ${step.ready ? "success" : state === "current" ? "warning" : ""}`}>{step.ready ? "已完成" : state === "current" ? "下一步" : "待完成"}</span></li>; })}</ol>
  </section>;
}

function isReady(checks: SetupCheck[]) {
  return checks.length > 0 && checks.every((check) => check.state === "ready");
}
