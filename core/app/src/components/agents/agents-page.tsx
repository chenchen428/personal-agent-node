"use client";

import { Bot, Layers3, ShieldCheck } from "lucide-react";
import { Badge, PageHeader, PageSurface } from "@/components/desktop-v72/primitives";
import { LoadingState } from "@/components/desktop-v72/loading-state";
import { useJson } from "@/components/desktop-v627/shared";
import { AgentCard } from "./agent-card";
import { AgentsLoadState } from "./agents-load-state";
import type { AgentDirectoryItem } from "./types";

export function AgentsPage() {
  const { value, loading, error, refresh } = useJson<{ agents: AgentDirectoryItem[] }>("/api/agents");
  const agents = value?.agents || [];
  const availableCount = agents.filter((agent) => agent.status === "available").length;

  return <PageSurface className="agents-directory-page" width="wide">
    <PageHeader
      eyebrow="Agent Teams"
      title="Agent 团队"
      description="你始终只和主 Agent 沟通。它会根据任务领域选择专业成员，并在同一个项目上下文中持续协作。"
      actions={value ? <Badge tone={availableCount === agents.length ? "success" : "warning"}>
        <i className={`status-dot ${availableCount === agents.length ? "success" : "warning"}`} />
        {availableCount} / {agents.length} 位专业成员可用
      </Badge> : null}
    />
    <section className="agent-team-contract" aria-label="Agent 团队协作方式">
      <div><Bot aria-hidden="true" /><span><strong>主 Agent 统一分派</strong><small>一个沟通入口</small></span></div>
      <div><Layers3 aria-hidden="true" /><span><strong>项目上下文连续</strong><small>修改回到同一专业成员</small></span></div>
      <div><ShieldCheck aria-hidden="true" /><span><strong>专业边界清晰</strong><small>按能力和验收标准交付</small></span></div>
    </section>
    {loading && !value ? <LoadingState label="正在读取当前空间的 Agent 团队" /> : null}
    {!loading && error ? <AgentsLoadState error={error} onRetry={() => void refresh()} /> : null}
    {!loading && !error && !agents.length ? <AgentsLoadState /> : null}
    {agents.length ? <>
      <div className="agent-directory-heading"><div><span>专业成员</span><strong>查看能力、边界和代表产物</strong></div><small>{String(agents.length).padStart(2, "0")} MEMBERS</small></div>
      <section className="agent-directory-grid" aria-label="专业 Agent 列表">
        {agents.map((agent, index) => <AgentCard agent={agent} index={index} key={agent.id} />)}
      </section>
    </> : null}
  </PageSurface>;
}
