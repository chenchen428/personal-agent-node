import { formatCompactTokenCount, formatTokenDay } from "./format";
import type { TokenUsageDay } from "./types";

export function TokenUsageHeatmap({ days, compact = false }: { days: TokenUsageDay[]; compact?: boolean }) {
  const visibleDays = days.slice(-84);
  const maximum = Math.max(0, ...visibleDays.map((day) => day.totalTokens));
  return <div className={`token-heatmap${compact ? " compact" : ""}`}>
    <div className="token-heatmap-grid" role="img" aria-label="过去 12 周每日 Token 使用热力图">
      {visibleDays.map((day) => <span aria-hidden="true" className={`level-${intensity(day.totalTokens, maximum)}`} key={day.day} title={`${formatTokenDay(day.day)}：${formatCompactTokenCount(day.totalTokens)} Tokens`} />)}
    </div>
    <footer><span>过去 12 周</span><div aria-label="热力强度图例"><span>少</span>{[0, 1, 2, 3, 4].map((level) => <i className={`level-${level}`} key={level} />)}<span>多</span></div></footer>
  </div>;
}

function intensity(value: number, maximum: number) {
  if (!value || !maximum) return 0;
  return Math.min(4, Math.max(1, Math.ceil((value / maximum) * 4)));
}
