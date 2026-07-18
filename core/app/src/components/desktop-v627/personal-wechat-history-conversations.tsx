"use client";

import { LoaderCircle } from "lucide-react";
import type { PersonalWechatHistoryConversation } from "./personal-wechat-history-types";
import { personalWechatConversationName } from "./personal-wechat-history-types";

export function PersonalWechatHistoryConversations({ conversations, selectedId, hasMore, loadingMore, onSelect, onLoadMore }: {
  conversations: PersonalWechatHistoryConversation[];
  selectedId: string;
  hasMore: boolean;
  loadingMore: boolean;
  onSelect: (id: string) => void;
  onLoadMore: () => void;
}) {
  return <section className="personal-wechat-history-conversations" aria-label="个人微信会话列表">
    <header><div><strong>聊天记录</strong><span>{conversations.length} 个会话 · 全部保存在本机</span></div></header>
    <div className="personal-wechat-history-conversation-list">
      {conversations.map((conversation) => {
        const name = personalWechatConversationName(conversation);
        return <button className={selectedId === conversation.id ? "selected" : ""} type="button" aria-pressed={selectedId === conversation.id} onClick={() => onSelect(conversation.id)} key={conversation.id}>
          <span className="personal-wechat-history-avatar" aria-hidden="true">{name.slice(0, 1)}</span>
          <span className="personal-wechat-history-conversation-copy"><span><strong>{name}</strong><time dateTime={conversation.lastMessage?.occurredAt}>{formatListTime(conversation.lastMessage?.occurredAt)}</time></span><small>{conversation.lastMessage?.text || "已保存聊天记录"}</small><em>{conversation.kind === "group" ? "群聊" : "私聊"} · {conversation.messageCount} 条</em></span>
        </button>;
      })}
    </div>
    <footer>{hasMore ? <button type="button" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? <LoaderCircle className="connection-spinner" /> : null}{loadingMore ? "正在加载…" : "加载更多会话"}</button> : <span>已显示全部会话</span>}</footer>
  </section>;
}
function formatListTime(value?: string) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "昨天";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}
