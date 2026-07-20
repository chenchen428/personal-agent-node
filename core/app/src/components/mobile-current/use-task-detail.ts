"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson, isRunning } from "./data";
import type { Message, Session } from "./types";

type MessagePage = {
  items: Message[];
  hasMoreBefore: boolean;
  nextBeforeSeq: number;
  hasMoreAfter: boolean;
  nextAfterSeq: number;
};

type TaskDetailPayload = {
  contractVersion: "personal-agent/task-detail-v1";
  task: Session;
  messages: MessagePage;
};

type CachedTask = { payload: TaskDetailPayload; cachedAt: number };
const cache = new Map<string, CachedTask>();
const inFlight = new Map<string, Promise<TaskDetailPayload>>();
const CACHE_TTL = 30_000;

async function fetchTask(sessionId: string, signal: AbortSignal, fresh = false) {
  const cached = cache.get(sessionId);
  if (!fresh && cached && Date.now() - cached.cachedAt < CACHE_TTL) return cached.payload;
  const existing = inFlight.get(sessionId);
  if (existing) {
    try {
      return await existing;
    } catch (cause) {
      if (!signal.aborted && cause instanceof DOMException && cause.name === "AbortError") return fetchTask(sessionId, signal, fresh);
      throw cause;
    }
  }
  const request = fetchJson<TaskDetailPayload>(`/api/node/v1/client/tasks/${encodeURIComponent(sessionId)}`, { signal })
    .then((payload) => { cache.set(sessionId, { payload, cachedAt: Date.now() }); return payload; })
    .finally(() => inFlight.delete(sessionId));
  inFlight.set(sessionId, request);
  return request;
}

export function useTaskDetail(sessionId: string) {
  const cached = cache.get(sessionId)?.payload;
  const [session, setSession] = useState<Session | null>(cached?.task || null);
  const [messages, setMessages] = useState<Message[]>(cached?.messages.items || []);
  const [hasEarlier, setHasEarlier] = useState(cached?.messages.hasMoreBefore || false);
  const [beforeSeq, setBeforeSeq] = useState(cached?.messages.nextBeforeSeq || 0);
  const [latestSeq, setLatestSeq] = useState(cached?.messages.items.at(-1)?.sequence || 0);
  const [loading, setLoading] = useState(!cached);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);

  const applyPayload = useCallback((payload: TaskDetailPayload) => {
    setSession(payload.task);
    setMessages(payload.messages.items || []);
    setHasEarlier(payload.messages.hasMoreBefore);
    setBeforeSeq(payload.messages.nextBeforeSeq);
    setLatestSeq(payload.messages.items.at(-1)?.sequence || 0);
    setError("");
  }, []);

  const refresh = useCallback(async () => {
    const controller = new AbortController();
    const current = ++generation.current;
    setLoading(true);
    try {
      const payload = await fetchTask(sessionId, controller.signal, true);
      if (generation.current === current) applyPayload(payload);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "暂时无法读取任务");
    } finally {
      if (generation.current === current) setLoading(false);
    }
    return () => controller.abort();
  }, [applyPayload, sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    const current = ++generation.current;
    setLoading(!cache.has(sessionId));
    void fetchTask(sessionId, controller.signal)
      .then((payload) => { if (generation.current === current) applyPayload(payload); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "暂时无法读取任务"); })
      .finally(() => { if (generation.current === current) setLoading(false); });
    return () => controller.abort();
  }, [applyPayload, sessionId]);

  useEffect(() => {
    if (!sessionId || !session || !isRunning(session.status)) return;
    let active = true;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const page = await fetchJson<MessagePage>(`/api/node/v1/client/tasks/${encodeURIComponent(sessionId)}/messages?afterSeq=${latestSeq}&limit=50`, { signal: controller.signal });
        if (!active || !page.items.length) return;
        setMessages((current) => mergeMessages(current, page.items));
        setLatestSeq(page.nextAfterSeq || page.items.at(-1)?.sequence || latestSeq);
      } catch { /* retain the last successful snapshot while reconnecting */ }
    };
    const timer = window.setInterval(() => void poll(), 2500);
    return () => { active = false; controller.abort(); window.clearInterval(timer); };
  }, [latestSeq, session, sessionId]);

  const loadEarlier = useCallback(async () => {
    if (!hasEarlier || !beforeSeq || loadingEarlier) return;
    const controller = new AbortController();
    setLoadingEarlier(true);
    try {
      const page = await fetchJson<MessagePage>(`/api/node/v1/client/tasks/${encodeURIComponent(sessionId)}/messages?beforeSeq=${beforeSeq}&limit=30`, { signal: controller.signal });
      setMessages((current) => mergeMessages(page.items, current));
      setHasEarlier(page.hasMoreBefore);
      setBeforeSeq(page.nextBeforeSeq);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "暂时无法读取更早消息");
    } finally {
      setLoadingEarlier(false);
    }
  }, [beforeSeq, hasEarlier, loadingEarlier, sessionId]);

  return { session, messages, loading, loadingEarlier, hasEarlier, error, refresh, loadEarlier };
}

function mergeMessages(first: Message[], second: Message[]) {
  const merged = new Map<string, Message>();
  for (const message of [...first, ...second]) {
    const previous = merged.get(message.id);
    if (!previous || Number(message.sequence || 0) >= Number(previous.sequence || 0)) merged.set(message.id, message);
  }
  return [...merged.values()].sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0));
}
