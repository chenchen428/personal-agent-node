import { Activity, Database, Sparkles } from "lucide-react";
import { CompactTokenCount } from "../token-usage/compact-token-count";
import { formatTokenUpdatedAt } from "../token-usage/format";
import { TokenUsageHeatmap } from "../token-usage/token-usage-heatmap";
import { TokenUsageRangeSelector } from "../token-usage/token-usage-range-selector";
import { TokenUsageStatus } from "../token-usage/token-usage-status";
import type { TokenUsageRange, TokenUsageSummary } from "../token-usage/types";

export function TokenUsagePanel({ range, setRange, usage, loading, error }: {
  range: TokenUsageRange;
  setRange: (range: TokenUsageRange) => void;
  usage: TokenUsageSummary | null;
  loading: boolean;
  error: string;
}) {
  const metrics = usage ? [
    { label: "输入", value: usage.inputTokens, tone: "coral" },
    { label: "缓存输入", value: usage.cachedInputTokens, tone: "sage" },
    { label: "输出", value: usage.outputTokens, tone: "blue" },
    { label: "推理输出", value: usage.reasoningOutputTokens, tone: "violet" },
  ] : [];
  const state = loading ? "loading" : error ? "error" : !usage?.totalTokens ? "empty" : "ready";

  return <section className="desktop-token-panel" aria-labelledby="desktop-token-title">
    <header className="desktop-token-header"><div className="desktop-token-heading"><span className="desktop-token-icon"><Activity aria-hidden="true" /></span><div><span>本机 Agent 用量</span><h2 id="desktop-token-title">用量概览</h2></div></div><TokenUsageRangeSelector value={range} onChange={setRange} /></header>
    {state !== "ready" ? <TokenUsageStatus state={state} detail={error} /> : usage ? <>
      <div className="desktop-token-overview"><div className="desktop-token-total"><span>累计使用</span><strong><CompactTokenCount value={usage.totalTokens} /></strong><small>Tokens · {usage.sessionCount} 次会话 · {usage.requestCount} 次请求</small></div><div className="desktop-token-cache"><span><Database aria-hidden="true" />缓存输入占比</span><strong>{usage.cacheRate}%</strong><small>重复上下文优先复用缓存</small></div></div>
      <div className="desktop-token-metrics">{metrics.map((metric) => <div className={metric.tone} key={metric.label}><span>{metric.label}</span><strong><CompactTokenCount value={metric.value} /></strong><small>Tokens</small></div>)}</div>
      <div className="desktop-token-details">
        <section className="desktop-token-trend" aria-label="Token 使用热力图"><header><strong>使用热力图</strong><span>更新于{formatTokenUpdatedAt(usage.updatedAt)}</span></header><TokenUsageHeatmap days={usage.dailyUsage || []} /></section>
        <section className="desktop-token-sessions" aria-label="最近会话 Token 使用"><header><strong>最近会话</strong><Sparkles aria-hidden="true" /></header>{usage.recentSessions.slice(0, 3).map((session) => <div key={session.sessionId}><span><strong>{session.title || "未命名会话"}</strong><small>{formatTokenUpdatedAt(session.updatedAt)}</small></span><b><CompactTokenCount value={session.totalTokens} /> Tokens</b></div>)}</section>
      </div>
    </> : null}
  </section>;
}
