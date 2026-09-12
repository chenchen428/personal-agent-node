"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ConversationComposer } from "./conversation-composer";
import type { PendingAttachment } from "./conversation-attachments";
import { ConversationMessageList } from "./conversation-message-list";
import { errorMessage, fetchJson } from "./shared";
import type { Message, Session } from "./types";
import { useConversationScroll } from "./use-conversation-scroll";

function newClientMessageId() {
  return globalThis.crypto?.randomUUID?.()
    || `desktop-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type PendingTurn = { clientMessageId: string; responseIds: Set<string> };

function messageKey(message: Message) {
  return message.metadata?.clientMessageId
    ? `client:${message.metadata.clientMessageId}`
    : `message:${message.id}`;
}

function mergeMessages(first: Message[], second: Message[]) {
  const messages = new Map<string, Message>();
  for (const message of [...first, ...second]) messages.set(messageKey(message), message);
  return [...messages.values()].sort((left, right) =>
    new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime());
}

export function ConversationPage() {
  const searchParams = useSearchParams();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [sending, setSending] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  const scroll = useConversationScroll(session);
  const earlierLoadingRef = useRef(false);
  const latestRequestRef = useRef<AbortController | null>(null);
  const consumedCursors = useRef(new Set<string>());
  const requestsRef = useRef(new Set<AbortController>());
  const pendingTurnRef = useRef<PendingTurn | null>(null);

  const loadLatest = useCallback(async () => {
    if (latestRequestRef.current && !latestRequestRef.current.signal.aborted) return;
    const controller = new AbortController(); requestsRef.current.add(controller);
    latestRequestRef.current = controller;
    try {
      const result = await fetchJson<{ session: Session }>("/api/chat/desktop/conversation?limit=40", { signal: controller.signal });
      if (controller.signal.aborted) return;
      const pending = pendingTurnRef.current;
      const hasNewResponse = pending && (result.session.messages || []).some((message) =>
        ["assistant", "error"].includes(message.role) && !pending.responseIds.has(message.id));
      setSession((previous) => previous && previous.id === result.session.id ? {
        ...result.session,
        messages: mergeMessages(previous.messages || [], result.session.messages || []),
        pagination: previous.pagination || result.session.pagination,
      } : result.session);
      if (hasNewResponse) {
        pendingTurnRef.current = null;
        setWaiting(false);
      }
      setError("");
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    } finally {
      requestsRef.current.delete(controller);
      if (latestRequestRef.current === controller) latestRequestRef.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  const loadEarlier = useCallback(async () => {
    const cursor = session?.pagination?.earlierCursor;
    if (!cursor || earlierLoadingRef.current || consumedCursors.current.has(cursor)) return;
    earlierLoadingRef.current = true;
    scroll.preserveAnchor();
    setLoadingEarlier(true);
    const sessionId = session?.id;
    const controller = new AbortController(); requestsRef.current.add(controller);
    try {
      const result = await fetchJson<{ session: Session }>(
        `/api/chat/desktop/conversation?limit=40&before=${encodeURIComponent(cursor)}`, { signal: controller.signal });
      if (controller.signal.aborted || result.session.id !== sessionId) return;
      consumedCursors.current.add(cursor);
      setSession((previous) => previous && previous.id === sessionId ? {
        ...previous,
        messages: mergeMessages(result.session.messages || [], previous.messages || []),
        pagination: result.session.pagination,
      } : previous);
      setError("");
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    } finally {
      requestsRef.current.delete(controller); earlierLoadingRef.current = false;
      if (!controller.signal.aborted) setLoadingEarlier(false);
    }
  }, [scroll, session?.id, session?.pagination?.earlierCursor]);

  useEffect(() => { void loadLatest(); }, [loadLatest]);
  useEffect(() => { const requests = requestsRef.current; return () => { requests.forEach((request) => request.abort()); }; }, []);
  useEffect(() => {
    const mainRunning = ["start", "running"].includes(session?.status || "");
    const taskRunning = ["start", "running"].includes(session?.linkedTask?.status || "");
    if (!waiting && !mainRunning && !taskRunning) return;
    const timer = window.setInterval(() => void loadLatest(), 1200);
    return () => window.clearInterval(timer);
  }, [loadLatest, session?.linkedTask?.status, session?.status, waiting]);

  const send = async (content: string, attachments: PendingAttachment[]) => {
    const initialStatus = session?.status || "idle";
    const clientMessageId = newClientMessageId();
    pendingTurnRef.current = {
      clientMessageId,
      responseIds: new Set((session?.messages || [])
        .filter((message) => ["assistant", "error"].includes(message.role))
        .map((message) => message.id)),
    };
    const optimisticMessage: Message = {
      id: `optimistic-${clientMessageId}`,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
      metadata: {
        clientMessageId,
        optimistic: true,
        channel: "desktop",
        sourceLabel: "来自桌面",
        attachments: attachments.map((attachment) => {
          return {
            objectId: attachment.objectId,
            name: attachment.name,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            kind: attachment.kind,
            previewUrl: attachment.previewUrl,
            viewUrl: attachment.viewUrl,
            downloadUrl: attachment.downloadUrl,
            deliveryState: "sending" as const,
          };
        }),
      },
    };
    setSession((previous) => ({
      ...(previous || { id: "desktop-main", role: "main", title: "与 Cove 的对话", status: "running" }),
      status: "running",
      messages: mergeMessages(previous?.messages || [], [optimisticMessage]),
    }));
    setWaiting(true);
    setSending(true);
    setError("");
    try {
      await fetchJson("/api/chat/desktop/conversation/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content,
          clientMessageId,
          attachments: attachments.map(({ objectId }) => ({ objectId })),
        }),
      });
      void loadLatest();
    } catch (cause) {
      pendingTurnRef.current = null;
      setWaiting(false);
      setSession((previous) => previous ? {
        ...previous,
        status: initialStatus,
        messages: (previous.messages || []).filter((message) =>
          message.metadata?.clientMessageId !== clientMessageId),
      } : previous);
      setError(errorMessage(cause));
      throw cause;
    } finally {
      setSending(false);
    }
  };

  const mainProcessing = waiting || ["start", "running"].includes(session?.status || "");
  const processing = mainProcessing || ["start", "running"].includes(session?.linkedTask?.status || "");

  return <main className="page flush conversation" aria-label="与 Cove 的对话" data-session-role="main">
    <div className="message-scroll" ref={scroll.threadRef} aria-live="polite" tabIndex={0}><div className="message-thread" ref={scroll.contentRef}>
      <ConversationMessageList
        messages={session?.messages || []}
        loading={loading}
        loadingEarlier={loadingEarlier}
        hasEarlier={Boolean(session?.pagination?.hasEarlier)}
        processing={processing}
        linkedTask={session?.linkedTask}
        plan={session?.currentPlan}
        onLoadEarlier={() => void loadEarlier()}
      />
    </div></div>
    {!scroll.pinned ? <button type="button" className="conversation-jump-latest" onClick={scroll.latest}>回到最新 ↓</button> : null}
    <ConversationComposer initialMessage={searchParams.get("draft") || ""} sending={sending} waiting={mainProcessing} error={error} onSend={send} />
  </main>;
}
