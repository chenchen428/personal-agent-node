"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "@/lib/client-json";
import type { TokenUsageRange, TokenUsageSummary } from "./types";

export function useTokenUsage(initialRange: TokenUsageRange = "7d") {
  const [range, setRange] = useState<TokenUsageRange>(initialRange);
  const [usage, setUsage] = useState<TokenUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setUsage(null);
    try {
      const result = await fetchJson<{ tokenUsage: TokenUsageSummary }>(`/api/token-usage?range=${range}`);
      setUsage(result.tokenUsage);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法读取 Token 统计");
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { void refresh(); }, [refresh]);
  return { range, setRange, usage, loading, error, refresh };
}
