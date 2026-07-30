"use client";

import Link from "next/link";
import { ArrowLeft, Brush, ChartNoAxesCombined, Map, Sofa } from "lucide-react";
import { Badge, PageSurface } from "@/components/desktop-v72/primitives";
import { LoadingState } from "@/components/desktop-v72/loading-state";
import { useJson } from "@/components/desktop-v627/shared";
import { AgentDeliverySystem } from "./agent-delivery-system";
import { AgentFeaturedOutput } from "./agent-featured-output";
import { AgentProfileOverview } from "./agent-profile-overview";
import { AgentStatusBadge } from "./agent-status";
import { AgentsLoadState } from "./agents-load-state";
import type { AgentDirectoryItem } from "./types";

const icons = {
  "finance-analyst": ChartNoAxesCombined,
  "interior-designer": Sofa,
  "poster-designer": Brush,
  "travel-planner": Map,
};

export function AgentProfilePage({ agentId }: { agentId: string }) {
  const url = `/api/agents/${encodeURIComponent(agentId)}`;
  const { value, loading, error, refresh } = useJson<{ agent: AgentDirectoryItem }>(url);
  const agent = value?.agent;
  if (loading && !agent) return <PageSurface className="agent-profile-page" width="wide"><LoadingState label="正在读取专业 Agent 资料" /></PageSurface>;
  if (error || !agent) return <PageSurface className="agent-profile-page" width="wide">
    <Link className="agent-profile-back" href="/app/agents"><ArrowLeft aria-hidden="true" />返回 Agent 团队</Link>
    <AgentsLoadState error={error || "找不到该专业 Agent"} onRetry={() => void refresh()} />
  </PageSurface>;

  const profile = agent.profile;
  const Icon = icons[agent.id as keyof typeof icons] || Brush;
  const color = profile.visualIdentity?.accent || profile.visualIdentity?.color || "#5f6f66";
  return <PageSurface className={`agent-profile-page profile-${agent.id}`} width="wide">
    <Link className="agent-profile-back" href="/app/agents"><ArrowLeft aria-hidden="true" />返回 Agent 团队</Link>
    <section className="agent-profile-hero" style={{ "--agent-color": color } as React.CSSProperties}>
      <div className="agent-profile-identity">
        <div className="agent-profile-kicker"><span>TEAM MEMBER</span><AgentStatusBadge status={agent.status} /></div>
        <div className="agent-profile-nameplate"><span><Icon aria-hidden="true" /></span><div><small>{profile.overview.role}</small><h1>{agent.displayName}</h1><p>{profile.overview.tagline}</p></div></div>
        <dl>
          <div><dt>{profile.capabilities.length}</dt><dd>核心能力</dd></div>
          <div><dt>{profile.deliverables.length}</dt><dd>产出类型</dd></div>
          <div><dt>{profile.workflow.length}</dt><dd>专业步骤</dd></div>
        </dl>
      </div>
      <aside className="agent-profile-brief">
        <span>专业契约</span><h2>负责什么</h2><p>{agent.description}</p>
        <div className="agent-profile-skills">{inferSkills(agent).map((skill) => <Badge key={skill}>{skill}</Badge>)}</div>
        <small>主 Agent 只会传递完成当前项目所需的上下文和受治理产物。</small>
      </aside>
    </section>
    <ProfileSection index="01" title="代表产物" description="这些案例用于展示专业质量和交付方式，不是可选择或复用的模板。">
      <AgentFeaturedOutput agentId={agent.id} examples={profile.examples} />
    </ProfileSection>
    <ProfileSection index="02" title="能力与使用边界" description="先明确能解决的问题、所需输入，以及仍应由人负责的判断。">
      <AgentProfileOverview profile={profile} />
    </ProfileSection>
    <ProfileSection index="03" title="工作方法与交付" description="从输入到验收保持同一条专业链路，后续修改继续沿用当前项目上下文。">
      <AgentDeliverySystem profile={profile} />
    </ProfileSection>
  </PageSurface>;
}

function ProfileSection({ index, title, description, children }: { index: string; title: string; description: string; children: React.ReactNode }) {
  return <section className="agent-profile-section"><header><span>{index}</span><div><h2>{title}</h2><p>{description}</p></div></header>{children}</section>;
}

function inferSkills(agent: AgentDirectoryItem) {
  return (agent.profile.skillSummaries || []).map((skill) => skill.id);
}
