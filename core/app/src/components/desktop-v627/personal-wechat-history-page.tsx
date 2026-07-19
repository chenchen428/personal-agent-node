"use client";

import Link from "next/link";
import { ArrowLeft, CircleAlert, HardDrive, LoaderCircle, MessageCircleMore, Settings2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button } from "../desktop-v72/primitives";
import { PersonalWechatHistoryConversations } from "./personal-wechat-history-conversations";
import { PersonalWechatHistoryThread } from "./personal-wechat-history-thread";
import { usePersonalWechatHistory } from "./use-personal-wechat-history";

export function PersonalWechatHistoryPage() {
  const history = usePersonalWechatHistory();
  const compact = useCompactHistoryLayout();
  const selected = useMemo(() => history.conversations.find((item) => item.id === history.selectedId) || null, [history.conversations, history.selectedId]);
  useEffect(() => {
    if (!compact && !history.selectedId && history.conversations[0]) history.selectConversation(history.conversations[0].id);
  }, [compact, history.conversations, history.selectConversation, history.selectedId]);
  const offline = Boolean(history.connection && history.connection.state !== "connected");
  const status = connectionStatus(history.connection?.state);

  return <main className={`personal-wechat-history-page${compact ? " compact" : ""}`}>
    <header className="personal-wechat-history-header">
      <Link className="personal-wechat-history-return" href="/app/connections?connection=wechat-personal"><ArrowLeft />返回连接</Link>
      <div className="personal-wechat-history-title"><span><MessageCircleMore /></span><div><h1>个人微信</h1><p>聊天记录只保存在当前隔离空间</p></div></div>
      <div className="personal-wechat-history-actions"><Badge tone={status.tone}>{status.label}</Badge><Link className="button" href="/app/connections?connection=wechat-personal"><Settings2 />连接设置</Link></div>
    </header>
    {history.loading ? <HistoryFeedback kind="loading" /> : history.error ? <HistoryFeedback kind="error" message={history.error} onRetry={() => void history.refresh()} /> : history.conversations.length === 0 ? <HistoryFeedback kind="empty" /> : <div className="personal-wechat-history-workspace">
      {(!compact || !selected) ? <PersonalWechatHistoryConversations conversations={history.conversations} selectedId={history.selectedId} hasMore={history.hasMore} loadingMore={history.loadingMore} onSelect={history.selectConversation} onLoadMore={() => void history.loadMore()} /> : null}
      {selected ? <PersonalWechatHistoryThread conversation={selected} messages={history.messages} loading={history.historyLoading} offline={offline} compact={compact} hasEarlier={history.hasEarlier} loadingEarlier={history.loadingEarlier} error={history.paginationError} onBack={history.clearSelection} onLoadEarlier={() => void history.loadEarlier()} onRetry={() => history.selectConversation(selected.id)} /> : !compact ? <div className="personal-wechat-history-placeholder"><MessageCircleMore /><strong>选择一个会话</strong><p>这里会显示该私聊或群聊保存在本机的消息记录。</p></div> : null}
    </div>}
  </main>;
}
function HistoryFeedback({ kind, message, onRetry }: { kind: "loading" | "empty" | "error"; message?: string; onRetry?: () => void }) {
  if (kind === "loading") return <div className="personal-wechat-history-feedback" role="status"><LoaderCircle className="connection-spinner" /><strong>正在读取聊天记录</strong><p>会话和最近消息加载完成后会显示在这里。</p></div>;
  if (kind === "error") return <div className="personal-wechat-history-feedback"><CircleAlert /><strong>聊天记录暂时无法读取</strong><p>{message || "检查本机 Agent 运行状态后再试一次，现有历史不会被删除。"}</p><Button type="button" onClick={onRetry}>重新加载</Button></div>;
  return <div className="personal-wechat-history-feedback"><HardDrive /><strong>还没有个人微信聊天记录</strong><p>新收到的私聊和群聊会保存在当前隔离空间，并按会话显示在这里。</p><Link className="button" href="/app/connections?connection=wechat-personal">查看连接设置</Link></div>;
}

function useCompactHistoryLayout() {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setCompact(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return compact;
}

function connectionStatus(state?: string): { label: string; tone: "success" | "warning" | "danger" | "info" } {
  if (state === "connected") return { label: "已连接", tone: "success" };
  if (state === "needs_setup") return { label: "待检测", tone: "warning" };
  if (state === "account_mismatch") return { label: "账号不匹配", tone: "danger" };
  return { label: state ? "暂不可用" : "状态未知", tone: "warning" };
}
