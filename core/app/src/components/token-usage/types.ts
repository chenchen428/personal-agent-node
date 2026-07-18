export type TokenUsageRange = "today" | "7d" | "30d";

export type TokenUsageDay = {
  day: string;
  totalTokens: number;
  requestCount: number;
};

export type TokenUsageSession = {
  sessionId: string;
  title: string;
  totalTokens: number;
  updatedAt: string | null;
};

export type TokenUsageSummary = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  sessionCount: number;
  requestCount: number;
  cacheRate: number;
  updatedAt: string | null;
  range: TokenUsageRange;
  dailyUsage: TokenUsageDay[];
  recentSessions: TokenUsageSession[];
};

export const tokenUsageRanges: Array<{ value: TokenUsageRange; label: string }> = [
  { value: "today", label: "今日" },
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
];
