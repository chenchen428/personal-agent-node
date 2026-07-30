"use client";

import Link from "next/link";
import { ArrowLeft, Box, CheckCircle2, CircleHelp, Layers3, RefreshCw, ShieldCheck } from "lucide-react";
import type { AgentProfile, AgentsResponse } from "./types";
import { AgentFeaturedOutput } from "./agent-featured-output";
import { AgentGlyph, AgentProfileList, AgentTagList } from "./agent-profile-elements";
import { useJson } from "./shared";
import { Badge, PageSurface } from "../desktop-v72/primitives";
import { LoadingState } from "../desktop-v72/loading-state";

export function AgentProfilePage({ agentId }: { agentId: string }) {
  const { value, loading, error, refresh } = useJson<AgentsResponse>("/api/agents");
  const agent = value?.agents.find((entry) => entry.id === agentId);

  if (loading && !value) return <PageSurface className="agent-profile-page"><LoadingState label="正在读取 Agent 档案" /></PageSurface>;
  if (error && !value) return <PageSurface className="agent-profile-page"><ProfileState title="暂时无法读取 Agent 档案" copy={error} onRetry={() => void refresh()} /></PageSurface>;
  if (!agent) return <PageSurface className="agent-profile-page"><ProfileState title="Agent 未注册" copy={`注册表中不存在 ${agentId}。`} /></PageSurface>;
  return <AgentProfileContent agent={agent} staleError={error} />;
}

function AgentProfileContent({ agent, staleError }: { agent: AgentProfile; staleError: string }) {
  return <PageSurface className="agent-profile-page">
    <Link className="agent-profile-back" href="/app/agents"><ArrowLeft aria-hidden />Agent 团队</Link>
    {staleError ? <p className="agent-team-inline-error" role="alert">{staleError}</p> : null}
    <header className="agent-profile-hero">
      <AgentGlyph agentId={agent.id} />
      <div><span>{agent.publicProfile.role}</span><h1>{agent.displayName}</h1><p>{agent.description}</p></div>
      <div className="agent-profile-status"><Badge tone="success">已注册</Badge><span>v{agent.version}</span></div>
    </header>
    <p className="agent-profile-tagline">{agent.publicProfile.tagline}</p>
    {agent.example ? <section className="agent-profile-chapter">
      <header><span>01</span><div><h2>代表产物</h2><p>这个 Agent 专业能力、工作方法和交付质量的完整示例。</p></div></header>
      <AgentFeaturedOutput agent={agent} />
    </section> : null}
    <section className="agent-profile-chapter">
      <header><span>02</span><div><h2>专业说明</h2><p>能力、输入、边界与交付保持在同一份专业契约中。</p></div></header>
      <div className="agent-profile-layout">
        <div className="agent-profile-primary">
          <AgentProfileList title="核心能力" icon={<Layers3 aria-hidden />} items={agent.publicProfile.capabilities} />
          <AgentProfileList title="交付内容" icon={<CheckCircle2 aria-hidden />} items={agent.publicProfile.outputs} />
        </div>
        <aside className="agent-profile-secondary">
          <AgentProfileList title="需要提供" icon={<CircleHelp aria-hidden />} items={agent.publicProfile.inputs} />
          <AgentProfileList title="工作边界" icon={<ShieldCheck aria-hidden />} items={agent.publicProfile.boundaries} />
          <section className="agent-profile-section"><h2><span><Box aria-hidden /></span>优先技能</h2><AgentTagList items={agent.skills} /></section>
          {agent.styles.length ? <section className="agent-profile-section"><h2><span><Layers3 aria-hidden /></span>创作风格</h2><div className="agent-style-list">{agent.styles.map((style) => <div key={style.id}><strong>{style.displayName}</strong><p>{style.summary}</p>{agent.defaultStyleId === style.id ? <Badge tone="info">默认</Badge> : null}</div>)}</div></section> : null}
        </aside>
      </div>
    </section>
  </PageSurface>;
}

function ProfileState({ title, copy, onRetry }: { title: string; copy: string; onRetry?: () => void }) {
  return <div className="agent-team-state"><strong>{title}</strong><p>{copy}</p>{onRetry ? <button className="button" type="button" onClick={onRetry}><RefreshCw aria-hidden />重试</button> : <Link className="button" href="/app/agents"><ArrowLeft aria-hidden />返回团队</Link>}</div>;
}
