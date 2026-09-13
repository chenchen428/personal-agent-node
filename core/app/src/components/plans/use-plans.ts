"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useClientResource } from "@/lib/use-client-resource";
import type { PlansResult } from "./types";

export function usePlans() {
  const params = useSearchParams();
  const linkedId = params.get("id") || params.get("task") || "";
  const [selectedId, setSelectedId] = useState(linkedId);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("all");
  const [offset, setOffset] = useState(0);
  useEffect(() => { setSelectedId(linkedId); }, [linkedId]);
  const search = new URLSearchParams({ limit: "50", offset: String(offset), query });
  if (mode !== "all") search.set("executionMode", mode);
  const result = useClientResource<PlansResult>(`/api/plans?${search}`);
  return { ...result, selectedId, setSelectedId, query, setQuery: (value: string) => { setQuery(value); setOffset(0); }, mode,
    setMode: (value: string) => { setMode(value); setOffset(0); }, offset, setOffset };
}
