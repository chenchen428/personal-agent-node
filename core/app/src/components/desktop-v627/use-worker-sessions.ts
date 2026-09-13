"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getPrefetchError, readPrefetched } from "@/lib/desktop-prefetch";
import { usePageRefresh } from "@/lib/use-client-resource";
import { fetchJson } from "./shared";
import type { Session } from "./types";

export function isWorkerRunning(status = "") {
  return ["start", "running"].includes(status);
}

export function useWorkerSessions(initialSessionId?: string | null) {
  const [initial] = useState(() => readPrefetched<{ sessions: Session[] }>("/api/chat/sessions?limit=50"));
  const [sessions, setSessions] = useState<Session[]>(() => (initial?.sessions || []).filter((item) => item.role === "worker"));
  const firstId = initialSessionId || sessions[0]?.id || "";
  const [selected, setSelected] = useState<Session | null>(() => firstId ? readPrefetched<{ session: Session }>(`/api/chat/sessions/${encodeURIComponent(firstId)}`)?.session ?? null : null);
  const [selectedId, setSelectedId] = useState(firstId);
  const [loading, setLoading] = useState(() => !initial && !getPrefetchError("/api/chat/sessions?limit=50"));
  const [detailLoading, setDetailLoading] = useState(false);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [error, setError] = useState(() => getPrefetchError("/api/chat/sessions?limit=50") || (firstId ? getPrefetchError(`/api/chat/sessions/${encodeURIComponent(firstId)}`) : ""));
  const selectedIdRef = useRef(firstId);
  const requests = useRef(new Map<string, AbortController>());

  const select = useCallback(async (sessionId: string, { background = false }: { background?: boolean } = {}) => {
    selectedIdRef.current = sessionId;
    setSelectedId(sessionId);
    requests.current.get("detail")?.abort(); const controller = new AbortController(); requests.current.set("detail", controller);
    const cached = readPrefetched<{ session: Session }>(`/api/chat/sessions/${encodeURIComponent(sessionId)}`)?.session;
    if (cached) setSelected(cached);
    if (!background) setDetailLoading(!cached);
    try {
      const detail = (await fetchJson<{ session: Session }>(`/api/chat/sessions/${encodeURIComponent(sessionId)}`, { signal: controller.signal })).session;
      if (selectedIdRef.current === sessionId) setSelected(detail);
      setError("");
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (!background && !cached && selectedIdRef.current === sessionId) setSelected(null);
      setError(cause instanceof Error ? cause.message : "暂时无法读取任务");
    } finally {
      if (!background && selectedIdRef.current === sessionId) setDetailLoading(false);
    }
  }, []);

  const load = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    requests.current.get("list")?.abort(); const controller = new AbortController(); requests.current.set("list", controller);
    const list = await fetchJson<{ sessions: Session[] }>("/api/chat/sessions?limit=50", { signal: controller.signal });
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

  const refresh = useCallback(() => { void load({ background: true }).catch((cause) => { if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : "暂时无法读取任务"); }).finally(() => setLoading(false)); }, [load]);
  useEffect(() => { refresh(); const pending = requests.current; return () => pending.forEach((controller) => controller.abort()); }, [refresh]);
  usePageRefresh(refresh);
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
