import type { TokenUsageRange } from "./types";
import { tokenUsageRanges } from "./types";

export function TokenUsageRangeSelector({ value, onChange, compact = false }: {
  value: TokenUsageRange;
  onChange: (range: TokenUsageRange) => void;
  compact?: boolean;
}) {
  return <div className={`token-range-selector${compact ? " compact" : ""}`} aria-label="Token 统计范围">{tokenUsageRanges.map((range) => <button aria-pressed={value === range.value} className={value === range.value ? "active" : ""} key={range.value} onClick={() => onChange(range.value)} type="button">{range.label}</button>)}</div>;
}
