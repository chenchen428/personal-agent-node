import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { connectorError } from "./client.ts";
import { isPlainObject } from "./protocol.ts";

export type PersonalWechatContactScope = "direct_and_group" | "direct_only" | "group_only";
export type PersonalWechatGroupTrigger = "allowed_members_mention" | "any_member_mention" | "allowed_members_message";

export type PersonalWechatAccessPolicy = {
  schemaVersion: 1;
  enabled: boolean;
  contacts: Array<{ wxid: string; scope: PersonalWechatContactScope }>;
  groups: Array<{ wxid: string; trigger: PersonalWechatGroupTrigger }>;
  updatedAt: string | null;
};

export type PersonalWechatDirectoryEntry = { id: string; name: string; maskedId: string };
export type PersonalWechatDirectory = {
  account: PersonalWechatDirectoryEntry;
  contacts: PersonalWechatDirectoryEntry[];
  groups: PersonalWechatDirectoryEntry[];
  readAt: string;
};

export type PersonalWechatMessage = {
  accountWxid: string;
  senderWxid: string;
  conversationWxid: string;
  groupWxid: string;
  text: string;
  mentionedAccount: boolean;
  isGroup: boolean;
  isSelf: boolean;
  msgType: number | null;
};

const CONTACT_SCOPES = new Set<PersonalWechatContactScope>(["direct_and_group", "direct_only", "group_only"]);
const GROUP_TRIGGERS = new Set<PersonalWechatGroupTrigger>(["allowed_members_mention", "any_member_mention", "allowed_members_message"]);

export class PersonalWechatPolicyStore {
  private readonly filePath: string;

  constructor(dataRoot: string) {
    this.filePath = path.join(dataRoot, "connections", "wechat", "qianxun", "access-policy.json");
  }

  read(): PersonalWechatAccessPolicy {
    try {
      return normalizePolicy(JSON.parse(fs.readFileSync(this.filePath, "utf8")), false);
    } catch {
      return emptyPersonalWechatPolicy();
    }
  }

  write(input: unknown, directory: PersonalWechatDirectory) {
    const policy = normalizePolicy(input, true);
    const contactIds = new Set(directory.contacts.map((item) => item.id));
    const groupIds = new Set(directory.groups.map((item) => item.id));
    for (const contact of policy.contacts) {
      if (!contactIds.has(contact.wxid)) throw connectorError("UNKNOWN_CONTACT", "Access policy contains a contact that was not read from Qianxun", 400);
    }
    for (const group of policy.groups) {
      if (!groupIds.has(group.wxid)) throw connectorError("UNKNOWN_GROUP", "Access policy contains a group that was not read from Qianxun", 400);
    }
    const stored = { ...policy, enabled: true, updatedAt: new Date().toISOString() };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    atomicJson(this.filePath, stored);
    return stored;
  }
}

export function emptyPersonalWechatPolicy(): PersonalWechatAccessPolicy {
  return { schemaVersion: 1, enabled: false, contacts: [], groups: [], updatedAt: null };
}

export function normalizePersonalWechatDirectory(profile: unknown, friends: unknown, groups: unknown, accountWxid: string): PersonalWechatDirectory {
  const profileObject = firstRecord(profile);
  return {
    account: directoryEntry(profileObject, accountWxid, accountWxid, "当前账号"),
    contacts: uniqueEntries(extractRecords(friends).map((record) => directoryEntry(record, accountWxid, readWxid(record), "微信联系人"))).filter((item) => item.id),
    groups: uniqueEntries(extractRecords(groups).map((record) => directoryEntry(record, accountWxid, readWxid(record), "微信群"))).filter((item) => item.id),
    readAt: new Date().toISOString(),
  };
}

export function normalizePersonalWechatMessage(event: Record<string, unknown>, accountWxid: string): PersonalWechatMessage | null {
  if (event.type !== "D0003" || !isPlainObject(event.message)) return null;
  const message = event.message;
  const fromWxid = cleanId(message.fromWxid);
  const finalFromWxid = cleanId(message.finalFromWxid);
  const isGroup = fromWxid.endsWith("@chatroom") || Number(message.fromType) === 2;
  const senderWxid = isGroup ? finalFromWxid : (finalFromWxid || fromWxid);
  const groupWxid = isGroup ? fromWxid : "";
  const atWxidList = Array.isArray(message.atWxidList) ? message.atWxidList.map(cleanId) : [];
  const msgType = Number.isFinite(Number(message.msgType)) ? Number(message.msgType) : null;
  return {
    accountWxid,
    senderWxid,
    conversationWxid: groupWxid || senderWxid,
    groupWxid,
    text: typeof message.msg === "string" ? message.msg.trim() : "",
    mentionedAccount: atWxidList.includes(accountWxid),
    isGroup,
    isSelf: senderWxid === accountWxid,
    msgType,
  };
}

export function evaluatePersonalWechatAccess(policy: PersonalWechatAccessPolicy, message: PersonalWechatMessage | null) {
  if (!policy.enabled) return { allowed: false, reason: "policy_disabled" } as const;
  if (!message) return { allowed: false, reason: "unsupported_event" } as const;
  if (message.isSelf) return { allowed: false, reason: "self_message" } as const;
  if (!message.text || (message.msgType !== null && message.msgType !== 1)) return { allowed: false, reason: "unsupported_message" } as const;
  const contactId = subjectId(message.accountWxid, message.senderWxid);
  const groupId = subjectId(message.accountWxid, message.groupWxid);
  const contact = policy.contacts.find((item) => item.wxid === contactId);
  if (!message.isGroup) {
    const allowed = Boolean(contact && (contact.scope === "direct_and_group" || contact.scope === "direct_only"));
    return { allowed, reason: allowed ? "allowed_direct" : "contact_not_allowed" } as const;
  }
  const group = policy.groups.find((item) => item.wxid === groupId);
  if (!group) return { allowed: false, reason: "group_not_allowed" } as const;
  const memberAllowed = Boolean(contact && (contact.scope === "direct_and_group" || contact.scope === "group_only"));
  if (group.trigger === "any_member_mention") {
    return { allowed: message.mentionedAccount, reason: message.mentionedAccount ? "allowed_group_mention" : "mention_required" } as const;
  }
  if (!memberAllowed) return { allowed: false, reason: "group_member_not_allowed" } as const;
  if (group.trigger === "allowed_members_message") return { allowed: true, reason: "allowed_group_member" } as const;
  return { allowed: message.mentionedAccount, reason: message.mentionedAccount ? "allowed_group_member_mention" : "mention_required" } as const;
}

function normalizePolicy(input: unknown, strict: boolean): PersonalWechatAccessPolicy {
  if (!isPlainObject(input) || (strict && input.schemaVersion !== 1)) {
    if (strict) throw connectorError("INVALID_ARGUMENT", "Access policy schemaVersion must be 1", 400);
    return emptyPersonalWechatPolicy();
  }
  const contacts = normalizePolicyList(input.contacts, 5_000, (item) => {
    const scope = String(item.scope || "direct_and_group") as PersonalWechatContactScope;
    if (!CONTACT_SCOPES.has(scope)) throw connectorError("INVALID_ARGUMENT", "Invalid contact scope", 400);
    return { wxid: requiredId(item.wxid), scope };
  });
  const groups = normalizePolicyList(input.groups, 2_000, (item) => {
    const trigger = String(item.trigger || "allowed_members_mention") as PersonalWechatGroupTrigger;
    if (!GROUP_TRIGGERS.has(trigger)) throw connectorError("INVALID_ARGUMENT", "Invalid group trigger", 400);
    return { wxid: requiredId(item.wxid), trigger };
  });
  return {
    schemaVersion: 1,
    enabled: input.enabled === true,
    contacts: uniquePolicyItems(contacts),
    groups: uniquePolicyItems(groups),
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : null,
  };
}

function normalizePolicyList<T>(value: unknown, maximum: number, map: (item: Record<string, unknown>) => T): T[] {
  if (!Array.isArray(value)) return [];
  if (value.length > maximum) throw connectorError("INVALID_ARGUMENT", "Access policy is too large", 400);
  return value.map((item) => {
    if (!isPlainObject(item)) throw connectorError("INVALID_ARGUMENT", "Access policy entries must be objects", 400);
    return map(item);
  });
}

function extractRecords(value: unknown): Record<string, unknown>[] {
  const root = isPlainObject(value) && "result" in value ? value.result : value;
  if (Array.isArray(root)) return root.filter(isPlainObject);
  if (!isPlainObject(root)) return [];
  for (const key of ["list", "data", "friends", "groups", "items", "contacts"]) {
    if (Array.isArray(root[key])) return (root[key] as unknown[]).filter(isPlainObject);
  }
  for (const nested of Object.values(root)) {
    if (Array.isArray(nested) && nested.every((item) => isPlainObject(item))) return nested as Record<string, unknown>[];
  }
  return [];
}

function firstRecord(value: unknown) {
  const root = isPlainObject(value) && isPlainObject(value.result) ? value.result : value;
  return isPlainObject(root) ? root : {};
}

function directoryEntry(record: Record<string, unknown>, accountWxid: string, wxid: string, fallback: string): PersonalWechatDirectoryEntry {
  const name = firstString(record.remark, record.remarkName, record.nickname, record.nickName, record.name, fallback);
  return { id: subjectId(accountWxid, wxid), name, maskedId: maskWxid(wxid) };
}

function subjectId(accountWxid: string, wxid: string) {
  const normalized = cleanId(wxid);
  if (!normalized) return "";
  return `pwc_${crypto.createHash("sha256").update(`${cleanId(accountWxid)}\0${normalized}`).digest("hex").slice(0, 32)}`;
}

function readWxid(record: Record<string, unknown>) {
  return firstString(record.wxid, record.userName, record.username, record.id);
}

function maskWxid(value: string) {
  const id = cleanId(value);
  if (!id) return "未提供标识";
  if (id.length <= 6) return `${id.slice(0, 1)}***${id.slice(-1)}`;
  return `${id.slice(0, 3)}***${id.slice(-3)}`;
}

function uniqueEntries(entries: PersonalWechatDirectoryEntry[]) {
  return [...new Map(entries.map((entry) => [entry.id, entry])).values()];
}

function uniquePolicyItems<T extends { wxid: string }>(items: T[]) {
  if (new Set(items.map((item) => item.wxid)).size !== items.length) throw connectorError("INVALID_ARGUMENT", "Access policy contains duplicate identifiers", 400);
  return items;
}

function requiredId(value: unknown) {
  const id = cleanId(value);
  if (!id) throw connectorError("INVALID_ARGUMENT", "Access policy identifier is required", 400);
  return id;
}

function cleanId(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > 160) throw connectorError("INVALID_ARGUMENT", "WeChat identifier is too long", 400);
  return text;
}

function firstString(...values: unknown[]) {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim().slice(0, 200);
  return "";
}

function atomicJson(filePath: string, value: unknown) {
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try { fs.renameSync(temporary, filePath); } finally { try { fs.rmSync(temporary, { force: true }); } catch {} }
  try { fs.chmodSync(filePath, 0o600); } catch {}
}
