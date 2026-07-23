"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson } from "./shared";
import type { Session } from "./types";

export function isWorkerRunning(status = "") {
  return ["start", "running"].includes(status);
}

export function useWorkerSessions(initialSessionId?: string | null) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<Session | null>(null);
  const [selectedId, setSelectedId] = useState(initialSessionId || "");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [error, setError] = useState("");
  const selectedIdRef = useRef(initialSessionId || "");

  const select = useCallback(async (sessionId: string, { background = false }: { background?: boolean } = {}) => {
    selectedIdRef.current = sessionId;
    setSelectedId(sessionId);
    if (!background) setDetailLoading(true);
    try {
      const detail = (await fetchJson<{ session: Session }>(`/api/chat/sessions/${encodeURIComponent(sessionId)}`)).session;
      if (selectedIdRef.current === sessionId) setSelected(detail);
      setError("");
    } catch (cause) {
      if (!background && selectedIdRef.current === sessionId) setSelected(null);
      setError(cause instanceof Error ? cause.message : "暂时无法读取任务");
    } finally {
      if (!background && selectedIdRef.current === sessionId) setDetailLoading(false);
    }
  }, []);

  const load = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    const list = await fetchJson<{ sessions: Session[] }>("/api/chat/sessions?limit=50");
    const workers = (list.sessions || []).filter((item) => item.role === "worker");
    setSessions(workers);
    const requestedId = selectedIdRef.current;
    const target = requestedId ? workers.find((item) => item.id === requestedId) : workers[0];
    if (!target) {
      if (requestedId) {
        await select(requestedId, { background });
        return;
      }
      selectedIdRef.current = "";
      setSelectedId("");
      setSelected(null);
      return;
    }
    await select(target.id, { background });
  }, [select]);

  const resume = useCallback(async (sessionId: string) => {
    setResumeLoading(true);
    setError("");
    try {
      const result = await fetchJson<{ session: Session }>(`/api/chat/sessions/${encodeURIComponent(sessionId)}/input`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "请继续完成这个任务。先检查已有进展和暂停原因，再从未完成处继续。" }),
      });
      const resumedSession = { ...result.session, status: result.session.status === "paused" ? "start" : result.session.status };
      setSessions((current) => current.map((session) => session.id === sessionId ? { ...session, ...resumedSession } : session));
      if (selectedIdRef.current === sessionId) setSelected(resumedSession);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法恢复任务");
    } finally {
      setResumeLoading(false);
    }
  }, []);

  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : "暂时无法读取任务")).finally(() => setLoading(false)); }, [load]);
  useEffect(() => {
    if (!initialSessionId || initialSessionId === selectedIdRef.current) return;
    void select(initialSessionId);
  }, [initialSessionId, select]);
  const hasRunningWorker = sessions.some((session) => isWorkerRunning(session.status));
  useEffect(() => {
    if (!hasRunningWorker) return;
    const timer = window.setInterval(() => void load({ background: true }).catch(() => undefined), 2500);
    return () => window.clearInterval(timer);
  }, [hasRunningWorker, load]);

  return { sessions, selected, selectedId, select, resume, loading, detailLoading, resumeLoading, error };
}
