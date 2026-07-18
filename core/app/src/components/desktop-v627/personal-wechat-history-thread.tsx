"use client";

import { ArrowLeft, FileText, HardDrive, Image, LoaderCircle } from "lucide-react";
import type { PersonalWechatHistoryConversation, PersonalWechatHistoryMessage } from "./personal-wechat-history-types";
import { personalWechatConversationName } from "./personal-wechat-history-types";

export function PersonalWechatHistoryThread({ conversation, messages, loading, offline, compact, hasEarlier, loadingEarlier, error, onBack, onLoadEarlier, onRetry }: {
  conversation: PersonalWechatHistoryConversation;
  messages: PersonalWechatHistoryMessage[];
  loading: boolean;
  offline: boolean;
  compact: boolean;
  hasEarlier: boolean;
  loadingEarlier: boolean;
  error: string;
  onBack: () => void;
  onLoadEarlier: () => void;
  onRetry: () => void;
}) {
  let previousDate = "";
  const conversationName = personalWechatConversationName(conversation);
  return <section className="personal-wechat-history-thread" aria-label={`${conversationName}聊天记录`}>
    <header>{compact ? <button className="personal-wechat-history-thread-back" type="button" onClick={onBack}><ArrowLeft />返回聊天记录</button> : null}<div><strong>{conversationName}</strong><span>{conversation.kind === "group" ? "群聊" : "私聊"} · 共 {conversation.messageCount} 条记录</span></div></header>
    {offline ? <div className="personal-wechat-history-offline" role="status"><i className="status-dot warning" /><p><strong>当前无法接收新消息</strong>已有本机记录仍可查看。</p></div> : null}
    <div className="personal-wechat-history-thread-scroll" role="log" aria-label="消息记录">
      {loading ? <div className="personal-wechat-history-inline-loading"><LoaderCircle className="connection-spinner" />正在读取最近记录</div> : <>
        {hasEarlier ? <button className="personal-wechat-history-load-earlier" type="button" disabled={loadingEarlier} onClick={onLoadEarlier}>{loadingEarlier ? <LoaderCircle className="connection-spinner" /> : null}{loadingEarlier ? "正在加载…" : "加载更早消息"}</button> : <span className="personal-wechat-history-start">已到达本机会话起点</span>}
        {error ? <div className="personal-wechat-history-page-error" role="status"><span>{error}</span><button type="button" onClick={onRetry}>重试</button></div> : null}
        {messages.map((message) => {
          const date = formatMessageDate(message.occurredAt);
          const showDate = date !== previousDate;
          previousDate = date;
          const sender = message.direction === "outbound" ? "你" : message.senderName || (conversation.kind === "group" ? "群成员" : conversationName);
          return <div className="personal-wechat-history-message-block" key={message.id}>{showDate ? <div className="personal-wechat-history-date"><span>{date}</span></div> : null}<article className={`personal-wechat-history-message ${message.direction}`}>
            <span className="personal-wechat-history-message-avatar" aria-hidden="true">{sender.slice(0, 1)}</span>
            <div><header><strong>{sender}</strong><time dateTime={message.occurredAt}>{formatMessageTime(message.occurredAt)}</time></header><MessageBody message={message} /></div>
          </article></div>;
        })}
      </>}
    </div>
    <footer><HardDrive /><span>只读历史 · 保存在当前隔离空间</span></footer>
  </section>;
}
function MessageBody({ message }: { message: PersonalWechatHistoryMessage }) {
  if (message.msgType === 3 || message.text === "[图片]") return <div className="personal-wechat-history-media"><span><Image /></span><strong>图片</strong><small>已保存在本机会话记录</small></div>;
  if (message.msgType === 49 || message.text.includes("文件")) return <div className="personal-wechat-history-file"><FileText /><div><strong>{message.text.replace(/^\[|\]$/g, "")}</strong><small>附件记录</small></div></div>;
  return <p>{message.text}</p>;
}

function formatMessageDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间未知";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "今天";
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(date);
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date) : "";
}
