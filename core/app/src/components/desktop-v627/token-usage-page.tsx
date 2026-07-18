"use client";

import { useTokenUsage } from "../token-usage/use-token-usage";
import { TokenUsagePanel } from "./token-usage-panel";

export function TokenUsagePage() {
  const tokenUsage = useTokenUsage();
  return <main className="v72-page statistics-token-page">
    <header className="v72-page-header"><div><span className="v72-setup-eyebrow">当前隔离空间</span><h1>Token 统计</h1><p>仅统计当前隔离空间内 Agent 对话和任务的 Token 使用、缓存占比与最近 12 周活跃情况。</p></div></header>
    <TokenUsagePanel {...tokenUsage} />
  </main>;
}
