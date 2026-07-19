"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, fetchJson } from "./shared";
import type { PersonalWechatConnectionStatus, PersonalWechatHistoryConversation, PersonalWechatHistoryMessage } from "./personal-wechat-history-types";

const CONVERSATION_PAGE_SIZE = 50;
const MESSAGE_PAGE_SIZE = 100;

export function usePersonalWechatHistory() {
  const [connection, setConnection] = useState<PersonalWechatConnectionStatus | null>(null);
  const [conversations, setConversations] = useState<PersonalWechatHistoryConversation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState<PersonalWechatHistoryMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [error, setError] = useState("");
  const [paginationError, setPaginationError] = useState("");
  const historyRequest = useRef(0);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    const [statusResult, conversationsResult] = await Promise.allSettled([
      fetchJson<{ connection: PersonalWechatConnectionStatus }>("/api/connections/wechat-personal/status"),
      fetchJson<{ conversations: PersonalWechatHistoryConversation[] }>(`/api/connections/wechat-personal/conversations?limit=${CONVERSATION_PAGE_SIZE}`),
    ]);
    if (statusResult.status === "fulfilled") setConnection(statusResult.value.connection);
    else setConnection(null);
    if (conversationsResult.status === "fulfilled") {
      const next = conversationsResult.value.conversations || [];
      setConversations(next); setHasMore(next.length === CONVERSATION_PAGE_SIZE);
      setSelectedId((current) => next.some((item) => item.id === current) ? current : "");
    } else setError(errorMessage(conversationsResult.reason));
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const selectConversation = useCallback((id: string) => {
    setSelectedId(id); setMessages([]); setPaginationError(""); setHasEarlier(false);
    const request = ++historyRequest.current;
    setHistoryLoading(true);
    void fetchJson<{ messages: PersonalWechatHistoryMessage[] }>(`/api/connections/wechat-personal/history?conversation=${encodeURIComponent(id)}&limit=${MESSAGE_PAGE_SIZE}`)
      .then((result) => {
        if (request !== historyRequest.current) return;
        const next = result.messages || [];
        setMessages(next); setHasEarlier(next.length === MESSAGE_PAGE_SIZE);
      })
      .catch((cause) => { if (request === historyRequest.current) setPaginationError(errorMessage(cause)); })
      .finally(() => { if (request === historyRequest.current) setHistoryLoading(false); });
  }, []);

  const clearSelection = useCallback(() => {
    historyRequest.current += 1; setSelectedId(""); setMessages([]); setHistoryLoading(false); setPaginationError("");
  }, []);

  const loadMore = useCallback(async () => {
    const before = conversations.at(-1)?.latestSeq;
    if (!before || loadingMore) return;
    setLoadingMore(true); setPaginationError("");
    try {
      const result = await fetchJson<{ conversations: PersonalWechatHistoryConversation[] }>(`/api/connections/wechat-personal/conversations?limit=${CONVERSATION_PAGE_SIZE}&before=${before}`);
      const next = result.conversations || [];
      setConversations((current) => uniqueById([...current, ...next]));
      setHasMore(next.length === CONVERSATION_PAGE_SIZE);
    } catch (cause) { setPaginationError(errorMessage(cause)); }
    finally { setLoadingMore(false); }
  }, [conversations, loadingMore]);

  const loadEarlier = useCallback(async () => {
    const before = messages[0]?.seq;
    if (!selectedId || !before || loadingEarlier) return;
    setLoadingEarlier(true); setPaginationError("");
    try {
      const result = await fetchJson<{ messages: PersonalWechatHistoryMessage[] }>(`/api/connections/wechat-personal/history?conversation=${encodeURIComponent(selectedId)}&limit=${MESSAGE_PAGE_SIZE}&before=${before}`);
      const next = result.messages || [];
      setMessages((current) => uniqueMessages([...next, ...current]));
      setHasEarlier(next.length === MESSAGE_PAGE_SIZE);
    } catch (cause) { setPaginationError(errorMessage(cause)); }
    finally { setLoadingEarlier(false); }
  }, [loadingEarlier, messages, selectedId]);

  return { connection, conversations, selectedId, messages, loading, historyLoading, loadingMore, loadingEarlier, hasMore, hasEarlier, error, paginationError, refresh, selectConversation, clearSelection, loadMore, loadEarlier };
}
function uniqueById(items: PersonalWechatHistoryConversation[]) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function uniqueMessages(items: PersonalWechatHistoryMessage[]) {
  return [...new Map(items.map((item) => [item.seq, item])).values()].sort((left, right) => left.seq - right.seq);
}
