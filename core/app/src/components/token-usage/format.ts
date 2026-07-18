export function formatCompactTokenCount(value: number) {
  const absolute = Math.abs(value);
  const unit = absolute >= 100_000_000
    ? { divisor: 100_000_000, suffix: "B" }
    : absolute >= 1_000_000
      ? { divisor: 1_000_000, suffix: "M" }
      : absolute >= 1_000
        ? { divisor: 1_000, suffix: "K" }
        : null;
  if (!unit) return new Intl.NumberFormat("zh-CN").format(value);
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value / unit.divisor)}${unit.suffix}`;
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
