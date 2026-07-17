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
  const selectedId = useRef("");

  const select = useCallback(async (sessionId: string) => {
    selectedId.current = sessionId;
    const detail = (await fetchJson<{ session: Session }>(`/api/chat/sessions/${encodeURIComponent(sessionId)}`)).session;
    if (selectedId.current === sessionId) setSelected(detail);
  }, []);

  const load = useCallback(async () => {
    const list = await fetchJson<{ sessions: Session[] }>("/api/chat/sessions?limit=50");
    const workers = (list.sessions || []).filter((item) => item.role === "worker");
    setSessions(workers);
    const target = workers.find((item) => item.id === selectedId.current) || workers[0];
    if (!target) {
      selectedId.current = "";
      setSelected(null);
      return;
    }
    await select(target.id);
  }, [select]);

  useEffect(() => { void load().catch(() => undefined); }, [load]);
  const hasRunningWorker = sessions.some((session) => isWorkerRunning(session.status));
  useEffect(() => {
    if (!hasRunningWorker) return;
    const timer = window.setInterval(() => void load().catch(() => undefined), 2500);
    return () => window.clearInterval(timer);
  }, [hasRunningWorker, load]);

  return { sessions, selected, select };
}
