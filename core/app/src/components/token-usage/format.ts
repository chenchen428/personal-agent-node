export const TOKEN_UNIT_DETAILS = {
  K: { divisor: 1_000, description: "K（Kilo）：千（10³）", accessibleDescription: "K，Kilo，千，10 的 3 次方" },
  M: { divisor: 1_000_000, description: "M（Million）：百万（10⁶）", accessibleDescription: "M，Million，百万，10 的 6 次方" },
  B: { divisor: 1_000_000_000, description: "B（Billion）：十亿（10⁹）", accessibleDescription: "B，Billion，十亿，10 的 9 次方" },
  T: { divisor: 1_000_000_000_000, description: "T（Trillion）：万亿（10¹²）", accessibleDescription: "T，Trillion，万亿，10 的 12 次方" },
} as const;

export type TokenUnit = keyof typeof TOKEN_UNIT_DETAILS;

export function compactTokenUnit(value: number): TokenUnit | null {
  const absolute = Math.abs(value);
  if (absolute >= TOKEN_UNIT_DETAILS.T.divisor) return "T";
  if (absolute >= TOKEN_UNIT_DETAILS.B.divisor) return "B";
  if (absolute >= TOKEN_UNIT_DETAILS.M.divisor) return "M";
  if (absolute >= TOKEN_UNIT_DETAILS.K.divisor) return "K";
  return null;
}

export function formatCompactTokenCount(value: number) {
  const suffix = compactTokenUnit(value);
  const unit = suffix ? TOKEN_UNIT_DETAILS[suffix] : null;
  if (!unit) return new Intl.NumberFormat("zh-CN").format(value);
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value / unit.divisor)}${suffix}`;
}

export function formatTokenDay(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", timeZone: "UTC" }).format(date)
    : value;
}

export function formatTokenUpdatedAt(value: string | null) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "暂无记录";
  const elapsed = Date.now() - date.getTime();
  if (elapsed < 60_000) return "刚刚";
  if (elapsed < 3_600_000) return `${Math.max(1, Math.floor(elapsed / 60_000))} 分钟前`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}
