export type QianxunEndpointStyle = "auto" | "wechat" | "qianxun";

export type QianxunEnvelope = {
  type: QianxunOperationType;
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
  type: string;
  name: string;
  mode: "read" | "write";
  exposure: "public" | "protocol-only";
  risk: "R0" | "R1" | "R2" | "R3";
};

export const QIANXUN_OPERATIONS = {
  health: { type: "checkWeChat", name: "微信状态检测", mode: "read", exposure: "public", risk: "R0" },
  sendText: { type: "sendText", name: "发送文本消息", mode: "write", exposure: "public", risk: "R2" },
  imageDownloadWindow: { type: "setDownloadImage", name: "修改下载图片窗口", mode: "write", exposure: "protocol-only", risk: "R2" },
  profile: { type: "getSelfInfo", name: "获取当前账号信息", mode: "read", exposure: "public", risk: "R1" },
  lookup: { type: "queryObj", name: "查询对象信息", mode: "read", exposure: "public", risk: "R1" },
  friends: { type: "getFriendList", name: "获取好友列表", mode: "read", exposure: "public", risk: "R1" },
  groups: { type: "getGroupList", name: "获取群聊列表", mode: "read", exposure: "public", risk: "R1" },
  officialAccounts: { type: "getPublicList", name: "获取公众号列表", mode: "read", exposure: "public", risk: "R1" },
  groupMembers: { type: "getMemberList", name: "获取群成员列表", mode: "read", exposure: "public", risk: "R1" },
  sendChatHistory: { type: "sendChatLog", name: "发送聊天记录", mode: "write", exposure: "protocol-only", risk: "R2" },
  sendImage: { type: "sendImage", name: "发送本地图片", mode: "write", exposure: "public", risk: "R2" },
  sendFile: { type: "sendFile", name: "发送本地文件", mode: "write", exposure: "public", risk: "R2" },
  sendLink: { type: "sendShareUrl", name: "发送分享链接", mode: "write", exposure: "protocol-only", risk: "R2" },
  sendMiniProgram: { type: "sendApplet", name: "发送小程序", mode: "write", exposure: "protocol-only", risk: "R2" },
  sendMusic: { type: "sendMusic", name: "发送音乐分享", mode: "write", exposure: "protocol-only", risk: "R2" },
  sendXml: { type: "sendXml", name: "发送 XML", mode: "write", exposure: "protocol-only", risk: "R3" },
  confirmTransfer: { type: "confirmTrans", name: "确认收款", mode: "write", exposure: "protocol-only", risk: "R3" },
  acceptFriend: { type: "agreeFriendReq", name: "同意好友请求", mode: "write", exposure: "public", risk: "R2" },
  addFriendV3: { type: "addFriendByV3", name: "通过 v3 添加好友", mode: "write", exposure: "public", risk: "R2" },
  addFriendFromGroup: { type: "addFriendByGroupWxid", name: "通过群成员添加好友", mode: "write", exposure: "public", risk: "R2" },
  stranger: { type: "queryNewFriend", name: "查询陌生人信息", mode: "read", exposure: "public", risk: "R1" },
  inviteGroupMember: { type: "inviteMembers", name: "邀请成员进群", mode: "write", exposure: "public", risk: "R2" },
  removeContact: { type: "delFriend", name: "删除好友", mode: "write", exposure: "public", risk: "R3" },
  setRemark: { type: "editObjRemark", name: "修改对象备注", mode: "write", exposure: "public", risk: "R2" },
} as const satisfies Record<string, QianxunOperationDefinition>;

export type QianxunOperationType = (typeof QIANXUN_OPERATIONS)[keyof typeof QIANXUN_OPERATIONS]["type"];

const OPERATION_TYPES = new Set<QianxunOperationType>(
  Object.values(QIANXUN_OPERATIONS).map((operation) => operation.type),
);

export function isQianxunOperationType(value: unknown): value is QianxunOperationType {
  return OPERATION_TYPES.has(String(value || "") as QianxunOperationType);
}

export function qianxunEnvelope(type: QianxunOperationType, data: Record<string, unknown> = {}): QianxunEnvelope {
  return { type, data };
}

export function extractQianxunWxid(response: QianxunResponse): string {
  const result = isPlainObject(response.result) ? response.result : {};
  return firstNonEmptyString(result.wxid, response.wxid);
}

export function isQianxunAuthorizationExpired(response: QianxunResponse) {
  const result = isPlainObject(response.result) ? response.result : {};
  const value = result.isExpire;
  return value === true || value === 1 || value === "1" || String(value || "").toLowerCase() === "true";
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
