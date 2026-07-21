"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fetchJson, isRunning } from "./data";
import type { Session, TaskDisplayEvent, TaskDisplayPage, TaskDisplayPlan } from "./types";

const PAGE_SIZE = 20;
const TOP_LOAD_THRESHOLD = 36;
const BOTTOM_PIN_THRESHOLD = 48;

export function useTaskDisplayHistory(taskId: string) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const generationRef = useRef(0);
  const requestedCursorsRef = useRef(new Set<string>());
  const pinnedToBottomRef = useRef(true);
  const pendingInitialPositionRef = useRef(false);
  const pendingAppendRef = useRef(false);
  const pendingPrependRef = useRef<{ height: number; top: number } | null>(null);
  const taskRef = useRef<Session | null>(null);
  const [task, setTask] = useState<Session | null>(null);
  const [items, setItems] = useState<TaskDisplayEvent[]>([]);
  const [latestPlan, setLatestPlan] = useState<TaskDisplayPlan>({ steps: [], updatedAt: "" });
  const [beforeCursor, setBeforeCursor] = useState("");
  const [hasEarlier, setHasEarlier] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [positioned, setPositioned] = useState(false);
  const [newUpdate, setNewUpdate] = useState(false);
  const [error, setError] = useState("");

  const applyTask = useCallback((value: Session | null | undefined) => {
    if (!value) return;
    taskRef.current = value;
    setTask(value);
  }, []);

  const scrollLatest = useCallback((smooth = true) => {
    const element = scrollRef.current;
    if (!element) return;
    pinnedToBottomRef.current = true;
    element.scrollTo({ top: element.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    setNewUpdate(false);
  }, []);

  useEffect(() => {
    const generation = ++generationRef.current;
    requestedCursorsRef.current.clear();
    pinnedToBottomRef.current = true;
    pendingInitialPositionRef.current = false;
    pendingAppendRef.current = false;
    pendingPrependRef.current = null;
    taskRef.current = null;
    setTask(null);
    setItems([]);
    setLatestPlan({ steps: [], updatedAt: "" });
    setBeforeCursor("");
    setHasEarlier(false);
    setLoading(true);
    setLoadingEarlier(false);
    setPositioned(false);
    setNewUpdate(false);
    setError("");
    void fetchTaskDisplayPage(taskId).then((page) => {
      if (generation !== generationRef.current) return;
      pendingInitialPositionRef.current = true;
      applyTask(page.task);
      setItems(page.items);
      setLatestPlan(page.latestPlan);
      setBeforeCursor(page.beforeCursor);
      setHasEarlier(page.hasEarlier);
      setError("");
    }).catch((cause) => {
      if (generation !== generationRef.current) return;
      setError(cause instanceof Error ? cause.message : "暂时无法读取任务进展");
    }).finally(() => {
      if (generation === generationRef.current) setLoading(false);
    });
  }, [applyTask, taskId]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || loading) return;
    if (pendingPrependRef.current) {
      const previous = pendingPrependRef.current;
      pendingPrependRef.current = null;
      element.scrollTop = previous.top + Math.max(0, element.scrollHeight - previous.height);
      return;
    }
    if (pendingInitialPositionRef.current) {
      pendingInitialPositionRef.current = false;
      element.scrollTop = element.scrollHeight;
      pinnedToBottomRef.current = true;
      setPositioned(true);
      return;
    }
    if (!pendingAppendRef.current) return;
    pendingAppendRef.current = false;
    if (pinnedToBottomRef.current) element.scrollTop = element.scrollHeight;
    else setNewUpdate(true);
  }, [items, latestPlan, loading]);

  useEffect(() => {
    const element = scrollRef.current;
    const content = element?.firstElementChild;
    if (!element || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (pinnedToBottomRef.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [loading, taskId]);

  const loadEarlier = useCallback(async () => {
    const cursor = beforeCursor;
    const element = scrollRef.current;
    if (!cursor || !hasEarlier || loadingEarlier || !element || requestedCursorsRef.current.has(cursor)) return;
    const generation = generationRef.current;
    requestedCursorsRef.current.add(cursor);
    setLoadingEarlier(true);
    try {
      const page = await fetchTaskDisplayPage(taskId, cursor);
      if (generation !== generationRef.current) return;
      const currentElement = scrollRef.current;
      if (!currentElement) return;
      pendingPrependRef.current = { height: currentElement.scrollHeight, top: currentElement.scrollTop };
      applyTask(page.task);
      setItems((current) => mergeTaskDisplayItems(page.items, current));
      setLatestPlan(page.latestPlan);
      setBeforeCursor(page.beforeCursor);
      setHasEarlier(page.hasEarlier);
    } catch {
      pendingPrependRef.current = null;
      requestedCursorsRef.current.delete(cursor);
    } finally {
      if (generation === generationRef.current) setLoadingEarlier(false);
    }
  }, [applyTask, beforeCursor, hasEarlier, loadingEarlier, taskId]);

  const onScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const distanceFromBottom = element.scrollHeight - element.clientHeight - element.scrollTop;
    pinnedToBottomRef.current = distanceFromBottom <= BOTTOM_PIN_THRESHOLD;
    if (pinnedToBottomRef.current) setNewUpdate(false);
    if (element.scrollTop <= TOP_LOAD_THRESHOLD) void loadEarlier();
  }, [loadEarlier]);

  const mergeTail = useCallback((page: TaskDisplayPage) => {
    applyTask(page.task);
    setLatestPlan(page.latestPlan);
    setItems((current) => {
      const next = mergeTaskDisplayItems(current, page.items);
      if (next.length !== current.length) pendingAppendRef.current = true;
      return next;
    });
  }, [applyTask]);

  useEffect(() => {
    if (!task || !isRunning(task.status)) return;
    const timer = window.setInterval(() => {
      void fetchTaskDisplayPage(taskId).then(mergeTail).catch(() => undefined);
    }, 2_500);
    return () => window.clearInterval(timer);
  }, [mergeTail, task, taskId]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retryTimer = 0;
    let disposed = false;
    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/api/chat/ws`);
      socket.onmessage = (message) => {
        let payload: { type?: string; taskId?: string; item?: TaskDisplayEvent; latestPlan?: TaskDisplayPlan; task?: Session };
        try { payload = JSON.parse(String(message.data || "{}")); } catch { return; }
        if (payload.taskId !== taskId) return;
        applyTask(payload.task);
        if (payload.type === "task.display.delta" && payload.item) {
          setItems((current) => {
            const next = mergeTaskDisplayItems(current, [payload.item!]);
            if (next.length !== current.length) pendingAppendRef.current = true;
            return next;
          });
        } else if (payload.type === "task.display.plan" && payload.latestPlan) {
          pendingAppendRef.current = true;
          setLatestPlan(payload.latestPlan);
        }
      };
      socket.onclose = () => {
        if (!disposed) retryTimer = window.setTimeout(connect, 1_500);
      };
      socket.onerror = () => socket?.close();
    };
    connect();
    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [applyTask, taskId]);

  return {
    task,
    items,
    latestPlan,
    loading,
    loadingEarlier,
    positioned,
    newUpdate,
    error,
    scrollRef,
    onScroll,
    scrollLatest,
  };
}

function fetchTaskDisplayPage(taskId: string, before = "") {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (before) params.set("before", before);
  return fetchJson<TaskDisplayPage>(`/api/mobile/tasks/${encodeURIComponent(taskId)}/display-events?${params}`);
}

function mergeTaskDisplayItems(...groups: TaskDisplayEvent[][]) {
  const byId = new Map<string, TaskDisplayEvent>();
  for (const item of groups.flat()) byId.set(item.displayEventId, item);
  return [...byId.values()].sort((left, right) => left.sequence - right.sequence);
}
