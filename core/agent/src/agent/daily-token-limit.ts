import fs from "node:fs";
import path from "node:path";

const TOKENS_PER_MILLION = 1_000_000;
const MAX_DAILY_LIMIT_MILLIONS = 1_000_000;

export type DailyTokenLimit = {
  dailyLimitMillions: number;
  dailyLimitTokens: number;
  enabled: boolean;
  unit: "M";
  resetTimezone: "Asia/Shanghai";
};

export function readDailyTokenLimit(filePath: string): DailyTokenLimit {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return dailyTokenLimitSettings(normalizeDailyLimitMillions(value?.dailyLimitMillions));
  } catch {
    return dailyTokenLimitSettings(0);
  }
}

export function writeDailyTokenLimit(filePath: string, dailyLimitMillions: unknown) {
  const normalized = normalizeDailyLimitMillions(dailyLimitMillions, { strict: true });
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({
    schemaVersion: 1,
    dailyLimitMillions: normalized,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
  return dailyTokenLimitSettings(normalized);
}

export function dailyTokenLimitSettings(dailyLimitMillions: number): DailyTokenLimit {
  const normalized = normalizeDailyLimitMillions(dailyLimitMillions);
  return {
    dailyLimitMillions: normalized,
    dailyLimitTokens: Math.round(normalized * TOKENS_PER_MILLION),
    enabled: normalized > 0,
    unit: "M",
    resetTimezone: "Asia/Shanghai",
  };
}

export function dailyTokenLimitExceeded(limit: DailyTokenLimit, usedTokens: number) {
  return limit.enabled && Math.max(Number(usedTokens) || 0, 0) >= limit.dailyLimitTokens;
}

export function dailyTokenLimitError(limit: DailyTokenLimit, usedTokens: number) {
  const usedMillions = Math.max(Number(usedTokens) || 0, 0) / TOKENS_PER_MILLION;
  return {
    code: "DAILY_TOKEN_LIMIT_EXCEEDED",
    message: `今日 Token 用量已达到每日限额 ${formatMillions(limit.dailyLimitMillions)} M（当前 ${formatMillions(usedMillions)} M），暂时无法发起新的对话。限额将在明天 00:00（Asia/Shanghai）重置；也可以在系统设置中调高限额，或设为 0 取消限制。`,
  };
}

function normalizeDailyLimitMillions(value: unknown, { strict = false } = {}) {
  const text = String(value ?? "").trim();
  const parsed = typeof value === "number" ? value : text ? Number(text) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_DAILY_LIMIT_MILLIONS) {
    if (strict) throw Object.assign(new Error(`每日 Token 限额必须在 0 到 ${MAX_DAILY_LIMIT_MILLIONS} M 之间`), {
      code: "INVALID_DAILY_TOKEN_LIMIT",
      statusCode: 400,
    });
    return 0;
  }
  return Math.round(parsed * 1_000) / 1_000;
}

function formatMillions(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 3 }).format(value);
}
