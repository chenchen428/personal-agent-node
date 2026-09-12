"use client";

import { useState } from "react";
import { useClientResource } from "@/lib/use-client-resource";
import type { TokenUsageRange, TokenUsageSummary } from "./types";

export function useTokenUsage(initialRange: TokenUsageRange = "7d") {
  const [range, setRange] = useState<TokenUsageRange>(initialRange);
  const result = useClientResource<{ tokenUsage: TokenUsageSummary }>(`/api/token-usage?range=${range}`);
  return { range, setRange, usage: result.value?.tokenUsage ?? null, loading: result.loading, error: result.error,
    refreshing: result.refreshing, staleError: result.staleError, refresh: result.refresh };
}
