"use client";

import { fileType, formatBytes, formatDateTime, paragraphs, useRemote } from "./data";
import { DetailShell, InlineError, LoadSentinel, SearchEmpty } from "./shell";

type MailPayload = {
  selectedEvent: {
    id: string;
    title: string;
    matched?: boolean;
    sender: { address: string; displayName: string };
    receivedAt: string;
    payload: { recipients: string[]; textPreview: string; attachments: { name: string }[] };
  } | null;
  content: { body: string; attachments: { name: string; index: number; sizeBytes?: number }[] } | null;
};

export function MobileMailDetail({ messageId }: { messageId: string }) {
  const { value, loading, error } = useRemote<MailPayload>(`/api/app/mail/messages?message=${encodeURIComponent(messageId)}`);
  const message = value?.selectedEvent;
  return <DetailShell returnHref="/app/mobile" returnLabel="最近动态" trailing={message?.matched ? "已处理" : "未处理"}>
    {error ? <InlineError message={error} /> : null}
    {message ? <article className="mail-detail">
      <div className="detail-heading"><span className="eyebrow">收到的邮件 · {message.matched ? "已处理" : "未处理"}</span><h1>{message.title || "（无主题）"}</h1><p>{message.sender.displayName || message.sender.address} &lt;{message.sender.address}&gt;<br />{formatDateTime(message.receivedAt)}</p></div>
      <dl className="mail-detail-facts"><div><dt>收件地址</dt><dd>{message.payload.recipients?.join("、") || "PA 邮箱"}</dd></div><div><dt>附件</dt><dd>{message.payload.attachments?.length || 0} 个文件</dd></div></dl>
      <div className="mail-detail-body">{paragraphs(value?.content?.body || message.payload.textPreview || "暂无正文")}</div>
      {(value?.content?.attachments || []).map((attachment) => <a className="mail-detail-attachment" href={`/app/mail/messages/${encodeURIComponent(message.id)}/attachments/${attachment.index}`} key={`${attachment.index}-${attachment.name}`}><span>{fileType(attachment.name)}</span><div><strong>{attachment.name}</strong><small>{attachment.sizeBytes ? formatBytes(attachment.sizeBytes) : "保存在本机"}</small></div><i>下载</i></a>)}
    </article> : loading ? <LoadSentinel loading canLoad={false} exhausted={false} onLoad={() => undefined} /> : <SearchEmpty title="邮件不存在" hint="这封邮件可能已经被移除" />}
  </DetailShell>;
}
