import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { connectorError } from "./client.ts";
import { personalWechatSubjectId, type PersonalWechatDirectory, type PersonalWechatMessage } from "./access-policy.ts";

export type PersonalWechatHistoryMessage = {
  seq: number;
  id: string;
  conversationId: string;
  senderId: string;
  conversationKind: "direct" | "group";
  direction: "inbound" | "outbound";
  msgType: number | null;
  text: string;
  occurredAt: string;
  receivedAt: string;
  senderName: string;
};

export class PersonalWechatHistoryStore {
  readonly databasePath: string;
  private readonly db: DatabaseSync;

  constructor(dataRoot: string) {
    this.databasePath = path.join(dataRoot, "connections", "wechat", "qianxun", "history.sqlite");
    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS personal_wechat_messages (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        event_key TEXT NOT NULL UNIQUE,
        conversation_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        conversation_kind TEXT NOT NULL CHECK (conversation_kind IN ('direct', 'group')),
        direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
        msg_type INTEGER,
        text TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        received_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_personal_wechat_messages_conversation
        ON personal_wechat_messages(conversation_id, seq DESC);
      CREATE TABLE IF NOT EXISTS personal_wechat_subjects (
        subject_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('account', 'contact', 'group')),
        updated_at TEXT NOT NULL
      );
    `);
    try { fs.chmodSync(this.databasePath, 0o600); } catch {}
  }

  updateDirectory(directory: PersonalWechatDirectory) {
    const updatedAt = normalizedIso(directory.readAt) || new Date().toISOString();
    const entries = [
      { ...directory.account, kind: "account" },
      ...directory.contacts.map((entry) => ({ ...entry, kind: "contact" })),
      ...directory.groups.map((entry) => ({ ...entry, kind: "group" })),
    ];
    const upsert = this.db.prepare(`
      INSERT INTO personal_wechat_subjects (subject_id, name, kind, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(subject_id) DO UPDATE SET name = excluded.name, kind = excluded.kind, updated_at = excluded.updated_at
    `);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const entry of entries) {
        if (/^pwc_[a-f0-9]{32}$/.test(entry.id)) upsert.run(entry.id, safeDisplayName(entry.name), entry.kind, updatedAt);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  append(message: PersonalWechatMessage, event: Record<string, unknown>): PersonalWechatHistoryMessage | null {
    const conversationId = personalWechatSubjectId(message.accountWxid, message.conversationWxid);
    if (!conversationId) return null;
    const id = boundedId(event.id, "event id");
    const eventKey = boundedId(event.eventKey, "event key");
    const receivedAt = normalizedIso(event.receivedAt) || new Date().toISOString();
    const occurredAt = qianxunTimestamp(event.message, receivedAt);
    const direction = message.isSelf ? "outbound" : "inbound";
    const senderId = personalWechatSubjectId(message.accountWxid, message.isSelf ? message.accountWxid : message.senderWxid);
    this.db.prepare(`
      INSERT OR IGNORE INTO personal_wechat_messages
        (id, event_key, conversation_id, sender_id, conversation_kind, direction, msg_type, text, occurred_at, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      eventKey,
      conversationId,
      senderId,
      message.isGroup ? "group" : "direct",
      direction,
      message.msgType,
      historyText(message),
      occurredAt,
      receivedAt,
    );
    const row = this.db.prepare("SELECT * FROM personal_wechat_messages WHERE event_key = ?").get(eventKey);
    return row ? historyRow(row) : null;
  }

  listConversations(limit = 50, beforeSeq?: number) {
    const bounded = boundedLimit(limit, 50, 200);
    const before = boundedBeforeSeq(beforeSeq);
    const rows = this.db.prepare(`
      SELECT conversation_id, conversation_kind, COUNT(*) AS message_count, MAX(seq) AS latest_seq
      FROM personal_wechat_messages
      GROUP BY conversation_id, conversation_kind
      HAVING (? = 0 OR MAX(seq) < ?)
      ORDER BY latest_seq DESC
      LIMIT ?
    `).all(before, before, bounded);
    return rows.map((row) => {
      const latest = this.db.prepare(`
        SELECT message.*, sender.name AS sender_name
        FROM personal_wechat_messages AS message
        LEFT JOIN personal_wechat_subjects AS sender ON sender.subject_id = message.sender_id
        WHERE message.seq = ?
      `).get(row.latest_seq);
      const subject = this.db.prepare("SELECT name FROM personal_wechat_subjects WHERE subject_id = ?").get(row.conversation_id);
      return {
        id: String(row.conversation_id),
        kind: String(row.conversation_kind),
        name: subject ? String(subject.name) : "",
        messageCount: Number(row.message_count),
        latestSeq: Number(row.latest_seq),
        lastMessage: latest ? historyRow(latest) : null,
      };
    });
  }

  listMessages(conversationId: unknown, { limit = 100, beforeSeq }: { limit?: number; beforeSeq?: number } = {}) {
    const id = requiredConversationId(conversationId);
    const bounded = boundedLimit(limit, 100, 500);
    const before = boundedBeforeSeq(beforeSeq);
    const rows = before
      ? this.db.prepare(`SELECT message.*, sender.name AS sender_name FROM personal_wechat_messages AS message LEFT JOIN personal_wechat_subjects AS sender ON sender.subject_id = message.sender_id WHERE message.conversation_id = ? AND message.seq < ? ORDER BY message.seq DESC LIMIT ?`).all(id, before, bounded)
      : this.db.prepare(`SELECT message.*, sender.name AS sender_name FROM personal_wechat_messages AS message LEFT JOIN personal_wechat_subjects AS sender ON sender.subject_id = message.sender_id WHERE message.conversation_id = ? ORDER BY message.seq DESC LIMIT ?`).all(id, bounded);
    return rows.reverse().map(historyRow);
  }

  contextBefore(message: PersonalWechatHistoryMessage, limit = 100) {
    return this.listMessages(message.conversationId, { limit: Math.min(Math.max(Number(limit) || 100, 1), 100), beforeSeq: message.seq });
  }

  close() {
    this.db.close();
  }
}

function historyRow(row: Record<string, unknown>): PersonalWechatHistoryMessage {
  return {
    seq: Number(row.seq),
    id: String(row.id),
    conversationId: String(row.conversation_id),
    senderId: String(row.sender_id),
    conversationKind: String(row.conversation_kind) === "group" ? "group" : "direct",
    direction: String(row.direction) === "outbound" ? "outbound" : "inbound",
    msgType: row.msg_type === null || row.msg_type === undefined ? null : Number(row.msg_type),
    text: String(row.text || ""),
    occurredAt: String(row.occurred_at),
    receivedAt: String(row.received_at),
    senderName: safeDisplayName(row.sender_name),
  };
}

function safeDisplayName(value: unknown) {
  return String(value || "").trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200);
}

function historyText(message: PersonalWechatMessage) {
  const text = String(message.text || "").slice(0, 16 * 1024);
  if (message.msgType === 1) return text;
  if (message.msgType === 3) return "[图片]";
  if (message.msgType === 34) return "[语音]";
  if (message.msgType === 42) return "[名片]";
  if (message.msgType === 43) return "[视频]";
  if (message.msgType === 47) return "[动态表情]";
  if (message.msgType === 48) return "[位置]";
  if (message.msgType === 49) return /^\[(?:file|pic)=/i.test(text) ? "[文件或图片]" : "[分享链接或附件]";
  if (message.msgType === 2001) return "[红包]";
  if (message.msgType === 2002) return "[小程序]";
  if (message.msgType === 2003) return "[群邀请]";
  return text || `[消息类型 ${message.msgType ?? "未知"}]`;
}

function qianxunTimestamp(value: unknown, fallback: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const raw = Number((value as Record<string, unknown>).timeStamp);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  const milliseconds = raw < 10_000_000_000 ? raw * 1_000 : raw;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function normalizedIso(value: unknown) {
  if (typeof value !== "string") return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function boundedId(value: unknown, name: string) {
  const text = String(value || "").trim();
  if (!text || text.length > 200) throw connectorError("INVALID_CALLBACK", `Personal WeChat ${name} is invalid`, 400);
  return text;
}

function requiredConversationId(value: unknown) {
  const id = String(value || "").trim();
  if (!/^pwc_[a-f0-9]{32}$/.test(id)) throw connectorError("INVALID_ARGUMENT", "conversation must be an opaque Personal WeChat conversation id", 400);
  return id;
}

function boundedLimit(value: unknown, fallback: number, maximum: number) {
  const number = Number(value || fallback);
  if (!Number.isInteger(number) || number < 1) throw connectorError("INVALID_ARGUMENT", "limit must be a positive integer", 400);
  return Math.min(number, maximum);
}

function boundedBeforeSeq(value: unknown) {
  if (value === undefined || value === null || value === "") return 0;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw connectorError("INVALID_ARGUMENT", "before must be a positive message sequence", 400);
  return number;
}
