import Link from "next/link";
import { Empty, formatTime } from "./shared";
import type { LinkedTask, Message } from "./types";

type Props = {
  messages: Message[];
  loading: boolean;
  loadingEarlier: boolean;
  hasEarlier: boolean;
  processing: boolean;
  linkedTask?: LinkedTask | null;
  onLoadEarlier: () => void;
};

export function ConversationMessageList({
  messages,
  loading,
  loadingEarlier,
  hasEarlier,
  processing,
  linkedTask,
  onLoadEarlier,
}: Props) {
  let linkedIndex = -1;
  if (linkedTask) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === "assistant") {
        linkedIndex = index;
        break;
      }
    }
  }

  return <>
    {hasEarlier ? <button className="desktop-chat-earlier" type="button" disabled={loadingEarlier} onClick={onLoadEarlier}>
      {loadingEarlier ? "正在加载…" : "加载更早的消息"}
    </button> : null}
    {messages.length ? <div className="desktop-chat-day"><span>最近对话</span></div> : null}
    {messages.map((message, index) => {
      const user = message.role === "user";
      return <article className={`desktop-chat-message ${user ? "user" : "agent"}${message.metadata?.optimistic ? " optimistic" : ""}`} key={message.id}>
        <div className="desktop-chat-content">
          {!user ? <header><strong>{message.role === "error" ? "发送失败" : "PA"}</strong></header> : null}
          <div className={user ? "desktop-chat-bubble" : "desktop-chat-copy"}>
            <p>{message.content}</p>
            {(message.metadata?.attachments || []).map((attachment) =>
              <span className="desktop-chat-attachment" key={`${message.id}-${attachment.name}`}>
                {attachment.name}
              </span>)}
            {linkedTask && index === linkedIndex ? <TaskReference task={linkedTask} /> : null}
          </div>
          <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
        </div>
      </article>;
    })}
    {processing ? <article className="desktop-chat-message agent desktop-chat-processing" role="status" aria-live="polite">
      <div className="desktop-chat-content">
        <header><strong>PA</strong></header>
        <div className="desktop-chat-copy"><span className="desktop-chat-dots" aria-hidden="true"><i /><i /><i /></span><p>正在处理，回复会自动显示</p></div>
      </div>
    </article> : null}
    {!loading && !messages.length ? <Empty text="发一条消息，开始与 PA 对话" /> : null}
  </>;
}

function TaskReference({ task }: { task: LinkedTask }) {
  return <Link className="desktop-chat-task" href={task.href}>
    <span><b>{task.title}</b><small>{task.summary || "PA 正在继续处理"}</small></span>
    <strong>查看任务</strong>
  </Link>;
}
