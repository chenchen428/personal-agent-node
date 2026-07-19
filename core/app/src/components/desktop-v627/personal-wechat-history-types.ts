export type PersonalWechatHistoryMessage = {
  seq: number;
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  conversationKind: "direct" | "group";
  direction: "inbound" | "outbound";
  msgType: number | null;
  text: string;
  occurredAt: string;
  receivedAt: string;
};

export type PersonalWechatHistoryConversation = {
  id: string;
  kind: "direct" | "group";
  name: string;
  messageCount: number;
  latestSeq: number;
  lastMessage: PersonalWechatHistoryMessage | null;
};

export type PersonalWechatConnectionStatus = {
  state?: string;
  reachable?: boolean | null;
  error?: string;
  errorCode?: string;
};

export function personalWechatConversationName(conversation: PersonalWechatHistoryConversation) {
  if (conversation.name.trim()) return conversation.name.trim();
  return `${conversation.kind === "group" ? "微信群" : "微信联系人"} · ${shortPersonalWechatId(conversation.id)}`;
}
export function shortPersonalWechatId(value: string) {
  return /^pwc_[a-f0-9]{32}$/.test(value) ? `${value.slice(0, 8)}…${value.slice(-4)}` : "pwc_…";
}
