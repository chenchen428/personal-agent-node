"use client";

import { Activity } from "lucide-react";
import { CompactTokenCount } from "../token-usage/compact-token-count";
import { formatTokenUpdatedAt } from "../token-usage/format";
import { TokenUsageHeatmap } from "../token-usage/token-usage-heatmap";
import { TokenUsageRangeSelector } from "../token-usage/token-usage-range-selector";
import { TokenUsageStatus } from "../token-usage/token-usage-status";
import { useTokenUsage } from "../token-usage/use-token-usage";
import { MobileAboutSectionSkeleton } from "./skeletons";

export function MobileTokenUsageSection() {
  const { range, setRange, usage, loading, error } = useTokenUsage();
  const state = loading ? "loading" : error ? "error" : !usage?.totalTokens ? "empty" : "ready";
  if (loading) return <MobileAboutSectionSkeleton />;
  return <section className="mobile-about-section mobile-token-usage" aria-labelledby="mobile-token-title">
    <header><div><Activity aria-hidden="true" /><h2 id="mobile-token-title">Token 统计</h2></div><span>{usage ? `更新于${formatTokenUpdatedAt(usage.updatedAt)}` : "本机数据"}</span></header>
    {state !== "ready" ? <TokenUsageStatus state={state} detail={error} /> : usage ? <>
      <TokenUsageRangeSelector compact value={range} onChange={setRange} />
      <div className="mobile-token-total"><span>累计使用</span><strong><CompactTokenCount value={usage.totalTokens} /></strong><small>Tokens · {usage.sessionCount} 次会话 · {usage.requestCount} 次请求</small></div>
      <div className="mobile-token-breakdown"><div><span>输入</span><strong><CompactTokenCount value={usage.inputTokens} /></strong><small>Tokens</small></div><div><span>缓存</span><strong><CompactTokenCount value={usage.cachedInputTokens} /></strong><small>Tokens</small></div><div><span>输出</span><strong><CompactTokenCount value={usage.outputTokens + usage.reasoningOutputTokens} /></strong><small>Tokens</small></div></div>
      <TokenUsageHeatmap compact days={usage.dailyUsage || []} />
    </> : null}
  </section>;
}
