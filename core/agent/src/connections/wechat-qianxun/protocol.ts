export type QianxunEndpointStyle = "auto" | "client" | "httpapi";

export type QianxunEnvelope = {
  type: QianxunOperationCode;
  data: Record<string, unknown>;
};

export type QianxunResponse = {
  code?: number;
  msg?: string;
  result?: unknown;
  wxid?: string;
  [key: string]: unknown;
};

export type QianxunOperationDefinition = {
  code: QianxunOperationCode;
  name: string;
  mode: "read" | "write";
  exposure: "public" | "protocol-only";
  risk: "R0" | "R1" | "R2" | "R3";
};

export const QIANXUN_OPERATIONS = {
  health: { code: "Q0000", name: "微信状态检测", mode: "read", exposure: "public", risk: "R0" },
  sendText: { code: "Q0001", name: "发送文本消息", mode: "write", exposure: "public", risk: "R2" },
  imageDownloadWindow: { code: "Q0002", name: "修改下载图片窗口", mode: "write", exposure: "protocol-only", risk: "R2" },
  profile: { code: "Q0003", name: "获取当前账号信息", mode: "read", exposure: "public", risk: "R1" },
  lookup: { code: "Q0004", name: "查询对象信息", mode: "read", exposure: "public", risk: "R1" },
  friends: { code: "Q0005", name: "获取好友列表", mode: "read", exposure: "public", risk: "R1" },
  groups: { code: "Q0006", name: "获取群聊列表", mode: "read", exposure: "public", risk: "R1" },
  officialAccounts: { code: "Q0007", name: "获取公众号列表", mode: "read", exposure: "public", risk: "R1" },
  groupMembers: { code: "Q0008", name: "获取群成员列表", mode: "read", exposure: "public", risk: "R1" },
  sendChatHistory: { code: "Q0009", name: "发送聊天记录", mode: "write", exposure: "protocol-only", risk: "R2" },
  sendImage: { code: "Q0010", name: "发送本地图片", mode: "write", exposure: "public", risk: "R2" },
  sendFile: { code: "Q0011", name: "发送本地文件", mode: "write", exposure: "public", risk: "R2" },
  sendLink: { code: "Q0012", name: "发送分享链接", mode: "write", exposure: "protocol-only", risk: "R2" },
  sendMiniProgram: { code: "Q0013", name: "发送小程序", mode: "write", exposure: "protocol-only", risk: "R2" },
  sendMusic: { code: "Q0014", name: "发送音乐分享", mode: "write", exposure: "protocol-only", risk: "R2" },
  sendXml: { code: "Q0015", name: "发送 XML", mode: "write", exposure: "protocol-only", risk: "R3" },
  confirmTransfer: { code: "Q0016", name: "确认收款", mode: "write", exposure: "protocol-only", risk: "R3" },
  acceptFriend: { code: "Q0017", name: "同意好友请求", mode: "write", exposure: "public", risk: "R2" },
  addFriendV3: { code: "Q0018", name: "通过 v3 添加好友", mode: "write", exposure: "public", risk: "R2" },
  addFriendWxid: { code: "Q0019", name: "通过 wxid 添加好友", mode: "write", exposure: "public", risk: "R2" },
  stranger: { code: "Q0020", name: "查询陌生人信息", mode: "read", exposure: "public", risk: "R1" },
  inviteGroupMember: { code: "Q0021", name: "邀请成员进群", mode: "write", exposure: "public", risk: "R2" },
  removeContact: { code: "Q0022", name: "删除好友", mode: "write", exposure: "public", risk: "R3" },
  setRemark: { code: "Q0023", name: "修改对象备注", mode: "write", exposure: "public", risk: "R2" },
} as const satisfies Record<string, QianxunOperationDefinition>;

export type QianxunOperationCode = (typeof QIANXUN_OPERATIONS)[keyof typeof QIANXUN_OPERATIONS]["code"];

const OPERATION_CODES = new Set<QianxunOperationCode>(
  Object.values(QIANXUN_OPERATIONS).map((operation) => operation.code),
);

export function isQianxunOperationCode(value: unknown): value is QianxunOperationCode {
  return OPERATION_CODES.has(String(value || "") as QianxunOperationCode);
}

export function qianxunEnvelope(type: QianxunOperationCode, data: Record<string, unknown> = {}): QianxunEnvelope {
  return { type, data };
}

export function extractQianxunWxid(response: QianxunResponse): string {
  const result = isPlainObject(response.result) ? response.result : {};
  return firstNonEmptyString(result.wxid, response.wxid);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstNonEmptyString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}
