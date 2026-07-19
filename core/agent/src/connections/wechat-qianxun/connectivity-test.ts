import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { connectorError } from "./client.ts";
import type { PersonalWechatMessage } from "./access-policy.ts";

const TEST_TTL_MS = 10 * 60 * 1_000;

type ConnectivityTestPhase = "waiting_message" | "message_received" | "reply_planned" | "complete" | "expired" | "failed";

type StoredConnectivityTest = {
  schemaVersion: 1;
  phase: ConnectivityTestPhase;
  code: string;
  testText: string;
  replyText: string;
  startedAt: string;
  expiresAt: string;
  receivedAt?: string;
  replyPlannedAt?: string;
  completedAt?: string;
  recipientWxid?: string;
  operationId?: string;
  operationDigest?: string;
  error?: string;
};

export class PersonalWechatConnectivityTest {
  private readonly filePath: string;

  constructor(dataRoot: string) {
    this.filePath = path.join(dataRoot, "connections", "wechat", "qianxun", "connectivity-test.json");
  }

  start() {
    const code = `PA-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const startedAt = new Date();
    const state: StoredConnectivityTest = {
      schemaVersion: 1,
      phase: "waiting_message",
      code,
      testText: `Personal Agent 连通测试 ${code}`,
      replyText: `Personal Agent 收发测试通过（${code}）`,
      startedAt: startedAt.toISOString(),
      expiresAt: new Date(startedAt.getTime() + TEST_TTL_MS).toISOString(),
    };
    this.write(state);
    return publicState(state);
  }

  status() {
    const state = this.read();
    return state ? publicState(this.withExpiry(state)) : idleState();
  }

  capture(message: PersonalWechatMessage) {
    const state = this.read();
    if (!state || this.withExpiry(state).phase !== "waiting_message") return false;
    if (!message.isSelf || message.isGroup || message.msgType !== 1 || message.text !== state.testText) return false;
    if (message.conversationWxid.toLowerCase() !== "filehelper") return false;
    this.write({ ...state, phase: "message_received", receivedAt: new Date().toISOString(), recipientWxid: message.conversationWxid });
    return true;
  }

  replyTarget() {
    const state = this.requirePhase("message_received");
    if (!state.recipientWxid) throw connectorError("WECHAT_TEST_TARGET_MISSING", "文件传输助手会话标识缺失，请重新开始收发测试", 409);
    return { recipientWxid: state.recipientWxid, replyText: state.replyText };
  }

  bindReplyPlan(operationId: string, operationDigest: string) {
    const state = this.requirePhase("message_received");
    const next = { ...state, phase: "reply_planned" as const, operationId, operationDigest, replyPlannedAt: new Date().toISOString() };
    this.write(next);
    return publicState(next);
  }

  requireReplyPlan(operationId: string, operationDigest: string) {
    const state = this.requirePhase("reply_planned");
    if (state.operationId !== operationId || state.operationDigest !== operationDigest) {
      throw connectorError("OPERATION_BINDING_MISMATCH", "测试回复与当前确认计划不匹配", 409);
    }
    return state;
  }

  complete() {
    const state = this.requirePhase("reply_planned");
    const next = { ...state, phase: "complete" as const, completedAt: new Date().toISOString(), operationId: undefined, operationDigest: undefined, recipientWxid: undefined };
    this.write(next);
    return publicState(next);
  }

  fail(error: unknown) {
    const state = this.read();
    if (!state) return idleState();
    const next = { ...state, phase: "failed" as const, error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500), operationId: undefined, operationDigest: undefined, recipientWxid: undefined };
    this.write(next);
    return publicState(next);
  }

  private requirePhase(phase: ConnectivityTestPhase) {
    const state = this.read();
    if (!state) throw connectorError("WECHAT_TEST_NOT_STARTED", "请先开始个人微信收发测试", 409);
    const current = this.withExpiry(state);
    if (current.phase !== phase) throw connectorError("WECHAT_TEST_STATE_MISMATCH", `当前收发测试状态不能执行此操作：${current.phase}`, 409);
    return current;
  }

  private withExpiry(state: StoredConnectivityTest) {
    if (!["waiting_message", "message_received", "reply_planned"].includes(state.phase)) return state;
    return Date.parse(state.expiresAt) <= Date.now() ? { ...state, phase: "expired" as const } : state;
  }

  private read(): StoredConnectivityTest | null {
    try {
      const state = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      return state?.schemaVersion === 1 && typeof state.phase === "string" ? state : null;
    } catch { return null; }
  }

  private write(state: StoredConnectivityTest) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    try { fs.renameSync(temporary, this.filePath); } finally { try { fs.rmSync(temporary, { force: true }); } catch {} }
    try { fs.chmodSync(this.filePath, 0o600); } catch {}
  }
}

function idleState() {
  return { schemaVersion: 1 as const, phase: "idle" as const, code: null, testText: null, replyText: null, startedAt: null, expiresAt: null, receivedAt: null, replyPlannedAt: null, completedAt: null, error: null };
}

function publicState(state: StoredConnectivityTest) {
  return {
    schemaVersion: 1 as const,
    phase: state.phase,
    code: state.code,
    testText: state.testText,
    replyText: state.replyText,
    startedAt: state.startedAt,
    expiresAt: state.expiresAt,
    receivedAt: state.receivedAt || null,
    replyPlannedAt: state.replyPlannedAt || null,
    completedAt: state.completedAt || null,
    error: state.error || null,
    operation: state.phase === "reply_planned" && state.operationId && state.operationDigest
      ? { id: state.operationId, digest: state.operationDigest, risk: "R2" as const }
      : null,
  };
}
