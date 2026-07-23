"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ConversationComposer } from "./conversation-composer";
import type { PendingAttachment } from "./conversation-attachments";
import { ConversationMessageList } from "./conversation-message-list";
import { errorMessage, fetchJson } from "./shared";
import type { Message, Session } from "./types";

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
  const threadRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const pendingTurnRef = useRef<PendingTurn | null>(null);

  const scrollLatest = useCallback(() => {
    window.requestAnimationFrame(() => {
      const thread = threadRef.current;
      if (thread) thread.scrollTop = thread.scrollHeight;
    });
  }, []);

  const loadLatest = useCallback(async ({ follow = false } = {}) => {
    try {
      const result = await fetchJson<{ session: Session }>("/api/chat/desktop/conversation?limit=40");
      const pending = pendingTurnRef.current;
      const hasNewResponse = pending && (result.session.messages || []).some((message) =>
        ["assistant", "error"].includes(message.role) && !pending.responseIds.has(message.id));
      setSession((previous) => previous ? {
        ...result.session,
        messages: mergeMessages(previous.messages || [], result.session.messages || []),
        pagination: previous.pagination || result.session.pagination,
      } : result.session);
      if (hasNewResponse) {
        pendingTurnRef.current = null;
        setWaiting(false);
      }
      setError("");
      if (!initializedRef.current || follow) scrollLatest();
      initializedRef.current = true;
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [scrollLatest]);

  const loadEarlier = useCallback(async () => {
    const cursor = session?.pagination?.earlierCursor;
    const thread = threadRef.current;
    if (!cursor || !thread || loadingEarlier) return;
    setLoadingEarlier(true);
    const previousHeight = thread.scrollHeight;
    const previousTop = thread.scrollTop;
    try {
      const result = await fetchJson<{ session: Session }>(
        `/api/chat/desktop/conversation?limit=40&before=${encodeURIComponent(cursor)}`);
      setSession((previous) => previous ? {
        ...previous,
        messages: mergeMessages(result.session.messages || [], previous.messages || []),
        pagination: result.session.pagination,
      } : result.session);
      window.requestAnimationFrame(() => {
        const current = threadRef.current;
        if (current) current.scrollTop = current.scrollHeight - previousHeight + previousTop;
      });
      setError("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoadingEarlier(false);
    }
  }, [loadingEarlier, session?.pagination?.earlierCursor]);

  useEffect(() => { void loadLatest(); }, [loadLatest]);
  useEffect(() => {
    const mainRunning = ["start", "running"].includes(session?.status || "");
    const taskRunning = ["start", "running"].includes(session?.linkedTask?.status || "");
    if (!waiting && !mainRunning && !taskRunning) return;
    const timer = window.setInterval(() => void loadLatest({ follow: true }), 1200);
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
          const image = attachment.mimeType.startsWith("image/");
          return {
            name: attachment.name,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            kind: image ? "image" as const : "file" as const,
            previewUrl: image ? `data:${attachment.mimeType};base64,${attachment.content}` : undefined,
            deliveryState: "sending" as const,
          };
        }),
      },
    };
    setSession((previous) => ({
      ...(previous || { id: "desktop-main", role: "main", title: "与 PA 的对话", status: "running" }),
      status: "running",
      messages: mergeMessages(previous?.messages || [], [optimisticMessage]),
    }));
    setWaiting(true);
    setSending(true);
    setError("");
    scrollLatest();
    try {
      await fetchJson("/api/chat/desktop/conversation/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content,
          clientMessageId,
          attachments,
        }),
      });
      void loadLatest({ follow: true });
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

  return <main className="page flush conversation" aria-label="与 PA 的对话" data-session-role="main">
    <div className="message-scroll" ref={threadRef} aria-live="polite"><div className="message-thread">
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
    <ConversationComposer initialMessage={searchParams.get("draft") || ""} sending={sending} waiting={mainProcessing} error={error} onSend={send} />
  </main>;
}
