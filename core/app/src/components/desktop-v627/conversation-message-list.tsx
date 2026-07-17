import Link from "next/link";
import { ConversationPlan } from "./conversation-plan";
import { Empty, formatTime } from "./shared";
import type { CurrentPlan, LinkedTask, Message } from "./types";
import { MarkdownContent } from "./markdown-content";

type Props = { messages: Message[]; loading: boolean; loadingEarlier: boolean; hasEarlier: boolean; processing: boolean; linkedTask?: LinkedTask | null; plan?: CurrentPlan | null; onLoadEarlier: () => void };

export function ConversationMessageList({ messages, loading, loadingEarlier, hasEarlier, processing, linkedTask, plan, onLoadEarlier }: Props) {
  const linkedIndex = linkedTask ? findLastAssistant(messages) : -1;
  const planIndex = messages.findIndex((message) => message.role === "assistant");
  return <>
    {hasEarlier ? <button className="message-earlier" type="button" disabled={loadingEarlier} onClick={onLoadEarlier}>{loadingEarlier ? "正在加载…" : "加载更早的消息"}</button> : null}
    {messages.map((message, index) => {
      const user = message.role === "user";
      return <article className={`message${user ? " user" : ""}${message.metadata?.optimistic ? " optimistic" : ""}`} key={message.id}>
        <span className={`avatar${user ? " user" : ""}`}>{user ? "你" : "PA"}</span>
        <div className="message-body"><div><MarkdownContent content={message.content} />{(message.metadata?.attachments || []).map((attachment) => <span className="message-attachment" key={`${message.id}-${attachment.name}`}>{attachment.name}</span>)}{linkedTask && index === linkedIndex ? <TaskReference task={linkedTask} /> : null}</div>{index === planIndex ? <ConversationPlan plan={plan} /> : null}<time className="message-time" dateTime={message.createdAt}>{formatTime(message.createdAt)}</time></div>
      </article>;
    })}
    {processing ? <article className="message message-processing" role="status" aria-live="polite"><span className="avatar">PA</span><div className="message-body"><span className="message-dots" aria-hidden="true"><i /><i /><i /></span><p>正在处理，回复会自动显示</p></div></article> : null}
    {!loading && !messages.length ? <Empty text="发一条消息，开始与 PA 对话" /> : null}
  </>;
}

function findLastAssistant(messages: Message[]) { for (let index = messages.length - 1; index >= 0; index -= 1) if (messages[index].role === "assistant") return index; return -1; }

function TaskReference({ task }: { task: LinkedTask }) { return <Link className="message-task" href={task.href}><span><b>{task.title}</b><small>{task.summary || "PA 正在继续处理"}</small></span><strong>查看任务</strong></Link>; }
