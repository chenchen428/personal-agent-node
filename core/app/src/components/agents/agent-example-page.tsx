"use client";

import Link from "next/link";
import { ArrowLeft, Monitor, Smartphone } from "lucide-react";
import { useJson } from "@/components/desktop-v627/shared";
import { agentExampleHref, resolveAgentExamplePresentation } from "./agent-example-presentation";
import { AgentExampleMedia } from "./agent-example-media";
import type { AgentDirectoryItem } from "./types";

export function AgentExamplePage({ agentId, exampleId }: { agentId: string; exampleId: string }) {
  const url = `/api/agents/${encodeURIComponent(agentId)}`;
  const { value, loading, error, refresh } = useJson<{ agent: AgentDirectoryItem }>(url);
  const agent = value?.agent;
  const presentation = agent ? resolveAgentExamplePresentation(agent.id, agent.profile.examples, exampleId) : null;
  const profileHref = `/app/agents/${encodeURIComponent(agentId)}`;

  return <div className="agent-example-immersive-page">
    <header className="agent-example-immersive-bar">
      <Link href={profileHref}><ArrowLeft aria-hidden="true" /><span>返回 Agent 详情</span></Link>
      <div>
        <small>{agent?.displayName || "代表产物"}</small>
        <strong>{presentation?.example.title || (loading ? "正在读取代表产物" : "无法打开代表产物")}</strong>
      </div>
      {presentation ? <span className="agent-example-device">
        {presentation.device === "mobile" ? <Smartphone aria-hidden="true" /> : <Monitor aria-hidden="true" />}
        {presentation.device === "mobile" ? "移动端作品" : "桌面端作品"}
      </span> : <span />}
    </header>
    <section className={`agent-example-immersive-stage is-${presentation?.device || "desktop"}`}>
      {loading && !agent ? <ExampleState title="正在读取代表产物" detail="内容准备好后会自动显示。" /> : null}
      {error || (!loading && !agent) ? <ExampleState
        title="暂时无法读取代表产物"
        detail={error || "找不到该 Agent。"}
        action={<button type="button" onClick={() => void refresh()}>重试</button>}
      /> : null}
      {agent && !presentation ? <ExampleState
        title="找不到该代表产物"
        detail="该产物可能已更新，请返回 Agent 详情重新选择。"
        action={agent.profile.examples.length ? <Link href={agentExampleHref(agent.id, "1")}>查看第一个代表产物</Link> : undefined}
      /> : null}
      {presentation ? <AgentExampleMedia presentation={presentation} immersive /> : null}
    </section>
  </div>;
}

function ExampleState({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  return <div className="agent-example-immersive-state" role="status">
    <strong>{title}</strong><p>{detail}</p>{action}
  </div>;
}
