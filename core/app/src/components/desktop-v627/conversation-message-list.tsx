import { ConversationPlan } from "./conversation-plan";
import { formatTime } from "./shared";
import type { CurrentPlan, LinkedTask, Message } from "./types";
import { MarkdownContent } from "./markdown-content";
import { localTaskDetailHref } from "./conversation-links";

type Props = { messages: Message[]; loading: boolean; loadingEarlier: boolean; hasEarlier: boolean; processing: boolean; linkedTask?: LinkedTask | null; plan?: CurrentPlan | null; onLoadEarlier: () => void };

export function ConversationMessageList({ messages, loading, loadingEarlier, hasEarlier, processing, linkedTask, plan, onLoadEarlier }: Props) {
  const linkedIndex = linkedTask ? findLastAssistant(messages, linkedTask.parentSessionId) : -1;
  const planIndex = linkedTask ? linkedIndex : findLastAssistant(messages);
  return <>
    {hasEarlier ? <button className="message-earlier" type="button" disabled={loadingEarlier} onClick={onLoadEarlier}>{loadingEarlier ? "正在加载…" : "加载更早的消息"}</button> : null}
    {messages.map((message, index) => {
      const user = message.role === "user";
      return <article className={`message${user ? " user" : ""}${message.metadata?.optimistic ? " optimistic" : ""}`} key={message.id}>
        <span className={`avatar${user ? " user" : ""}`}>{user ? "你" : "PA"}</span>
        <div className="message-body"><div><MarkdownContent content={message.content} linkTransform={localTaskDetailHref} />{(message.metadata?.attachments || []).map((attachment) => <span className="message-attachment" key={`${message.id}-${attachment.name}`}>{attachment.name}</span>)}{linkedTask && index === linkedIndex ? <TaskReference task={linkedTask} /> : null}</div>{index === planIndex ? <ConversationPlan plan={plan} /> : null}<div className="message-meta">{user && message.metadata?.sourceLabel ? <span className="message-source">{message.metadata.sourceLabel}</span> : null}<time className="message-time" dateTime={message.createdAt}>{formatTime(message.createdAt)}</time></div></div>
      </article>;
    })}
    {processing ? <article className="message message-processing" role="status" aria-live="polite"><span className="avatar">PA</span><div className="message-body"><span className="message-dots" aria-hidden="true"><i /><i /><i /></span><p>正在处理，回复会自动显示</p></div></article> : null}
    {!loading && !messages.length ? <ConversationEmpty /> : null}
  </>;
}

function ConversationEmpty() {
  return <div className="conversation-empty" role="status">
    <span className="conversation-empty-mark" aria-hidden="true"><i /><i /><i /></span>
    <small>PERSONAL AGENT</small>
    <strong>有什么想做的，直接告诉我</strong>
    <p>从一个想法、一段资料或一件待办开始，我会理解目标并持续推进。</p>
    <span className="conversation-empty-hint">输入框已准备好</span>
  </div>;
}

function findLastAssistant(messages: Message[], sessionId = "") { for (let index = messages.length - 1; index >= 0; index -= 1) if (messages[index].role === "assistant" && (!sessionId || messages[index].sessionId === sessionId)) return index; return -1; }

function TaskReference({ task }: { task: LinkedTask }) {
  return <div className="message-task" aria-label={`正在处理任务：${task.title}`}><i aria-hidden="true" /><b title={task.title}>{task.title}</b><small>处理中</small></div>;
}
