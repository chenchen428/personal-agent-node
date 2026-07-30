"use client";

import Link from "next/link";
import { ArrowRight, RefreshCw, SearchX } from "lucide-react";
import type { AgentProfile, AgentsResponse } from "./types";
import { AgentGlyph, AgentTagList } from "./agent-profile-elements";
import { useJson } from "./shared";
import { Badge, PageHeader, PageSurface } from "../desktop-v72/primitives";
import { LoadingState } from "../desktop-v72/loading-state";

export function AgentTeamPage() {
  const { value, loading, error, refresh } = useJson<AgentsResponse>("/api/agents");
  const agents = value?.agents || [];

  return <PageSurface className="agent-team-page">
    <PageHeader
      eyebrow="Specialist registry"
      title="Agent 团队"
      description="当前空间已注册的专业 Agent。"
      actions={<button className="icon-button" type="button" aria-label="重新读取 Agent 注册表" title="重新读取 Agent 注册表" disabled={loading} onClick={() => void refresh()}><RefreshCw className={loading ? "spin" : ""} /></button>}
    />
    {error && value ? <p className="agent-team-inline-error" role="alert">{error}</p> : null}
    {loading && !value ? <LoadingState label="正在读取 Agent 团队" /> : null}
    {!loading && error && !value ? <AgentTeamState title="暂时无法读取 Agent 团队" copy={error} onRetry={() => void refresh()} /> : null}
    {!loading && !error && !agents.length ? <AgentTeamState title="还没有注册专业 Agent" copy="注册完成后会自动显示在这里。" /> : null}
    {agents.length ? <section className="agent-team-grid" aria-label="已注册的专业 Agent">{agents.map((agent) => <AgentCard agent={agent} key={agent.id} />)}</section> : null}
  </PageSurface>;
}

function AgentCard({ agent }: { agent: AgentProfile }) {
  return <Link className="agent-team-card" href={`/app/agents/${encodeURIComponent(agent.id)}`}>
    <header><AgentGlyph agentId={agent.id} /><Badge tone="success">已注册</Badge></header>
    <div className="agent-team-card-copy">
      <span>{agent.publicProfile.role}</span>
      <h2>{agent.displayName}</h2>
      <p>{agent.description}</p>
    </div>
    <AgentTagList items={agent.skills} limit={4} />
    <footer><span>v{agent.version}</span><strong>查看档案 <ArrowRight aria-hidden /></strong></footer>
  </Link>;
}

function AgentTeamState({ title, copy, onRetry }: { title: string; copy: string; onRetry?: () => void }) {
  return <div className="agent-team-state"><SearchX aria-hidden /><strong>{title}</strong><p>{copy}</p>{onRetry ? <button className="button" type="button" onClick={onRetry}><RefreshCw aria-hidden />重试</button> : null}</div>;
}
