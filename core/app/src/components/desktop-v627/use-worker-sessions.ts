"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson } from "./shared";
import type { Session } from "./types";

export function isWorkerRunning(status = "") {
  return ["start", "running"].includes(status);
}

export function useWorkerSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const selectedId = useRef("");

  const select = useCallback(async (sessionId: string, { background = false }: { background?: boolean } = {}) => {
    selectedId.current = sessionId;
    if (!background) setDetailLoading(true);
    try {
      const detail = (await fetchJson<{ session: Session }>(`/api/chat/sessions/${encodeURIComponent(sessionId)}`)).session;
      if (selectedId.current === sessionId) setSelected(detail);
      setError("");
    } catch (cause) {
      if (!background && selectedId.current === sessionId) setSelected(null);
      setError(cause instanceof Error ? cause.message : "暂时无法读取任务");
    } finally {
      if (!background && selectedId.current === sessionId) setDetailLoading(false);
    }
  }, []);

  const load = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    const list = await fetchJson<{ sessions: Session[] }>("/api/chat/sessions?limit=50");
    const workers = (list.sessions || []).filter((item) => item.role === "worker");
    setSessions(workers);
    const target = workers.find((item) => item.id === selectedId.current) || workers[0];
    if (!target) {
      selectedId.current = "";
      setSelected(null);
      return;
    }
    await select(target.id, { background });
  }, [select]);

  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : "暂时无法读取任务")).finally(() => setLoading(false)); }, [load]);
  const hasRunningWorker = sessions.some((session) => isWorkerRunning(session.status));
  useEffect(() => {
    if (!hasRunningWorker) return;
    const timer = window.setInterval(() => void load({ background: true }).catch(() => undefined), 2500);
    return () => window.clearInterval(timer);
  }, [hasRunningWorker, load]);

  return { sessions, selected, select, loading, detailLoading, error };
}
