import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createOperationStore } from "../../../../runtime/src/operations.ts";
import { QianxunProtocolClient, connectorError, validateQianxunBaseUrl } from "./client.ts";
import { parseQianxunCallback, QianxunCallbackStore } from "./callback-store.ts";
import { PersonalWechatHistoryStore, type PersonalWechatHistoryMessage } from "./history-store.ts";
import { PersonalWechatConnectivityTest } from "./connectivity-test.ts";
import { extractQianxunWxid, isQianxunAuthorizationExpired, qianxunEnvelope, type QianxunEndpointStyle, type QianxunOperationType } from "./protocol.ts";
import {
  evaluatePersonalWechatAccess,
  normalizePersonalWechatDirectory,
  normalizePersonalWechatMessage,
  PersonalWechatPolicyStore,
  type PersonalWechatDirectory,
  type PersonalWechatMessage,
} from "./access-policy.ts";

type StoredConfig = {
  schemaVersion: 1;
  baseUrl: string;
  endpointStyle: QianxunEndpointStyle;
  learnedEndpointStyle?: "wechat" | "qianxun";
  bindWxid: string;
  safeKey?: string;
  configuredAt: string;
};

type PlannedPayload = {
  schemaVersion: 1;
  command: string;
  input: Record<string, unknown>;
};

const WRITE_ACTIONS = new Set(["send-text", "send-image", "send-file", "set-remark", "accept-friend", "add-friend-v3", "add-friend-group", "invite-group", "remove-contact"]);

export class WeChatQianxunConnector {
  private readonly rootDir: string;
  private readonly configFile: string;
  private readonly pendingDir: string;
  private readonly operationStore: ReturnType<typeof createOperationStore>;
  private readonly client: QianxunProtocolClient;
  private readonly events: QianxunCallbackStore;
  private readonly history: PersonalWechatHistoryStore;
  private readonly policies: PersonalWechatPolicyStore;
  private readonly connectivityTest: PersonalWechatConnectivityTest;
  private onInboundMessage: ((message: {
    senderId: string;
    sender: string;
    sessionId: string;
    text: string;
    conversationHistory: PersonalWechatHistoryMessage[];
    attachments: never[];
    createdAt: string;
  }) => Promise<unknown>) | null;

  constructor({ dataRoot, fetchImpl = fetch, operationStore, onInboundMessage = null }: {
    dataRoot: string;
    fetchImpl?: typeof fetch;
    operationStore?: ReturnType<typeof createOperationStore>;
    onInboundMessage?: ((message: { senderId: string; sender: string; sessionId: string; text: string; conversationHistory: PersonalWechatHistoryMessage[]; attachments: never[]; createdAt: string }) => Promise<unknown>) | null;
  }) {
    if (!path.isAbsolute(dataRoot || "")) throw new Error("Qianxun data root must be absolute");
    this.rootDir = path.join(dataRoot, "connections", "wechat", "qianxun");
    this.configFile = path.join(this.rootDir, "config.json");
    this.pendingDir = path.join(this.rootDir, "pending");
    this.operationStore = operationStore || createOperationStore({ dataRoot });
    this.events = new QianxunCallbackStore(dataRoot);
    this.history = new PersonalWechatHistoryStore(dataRoot);
    this.importRetainedCallbackHistory();
    this.policies = new PersonalWechatPolicyStore(dataRoot);
    this.connectivityTest = new PersonalWechatConnectivityTest(dataRoot);
    this.onInboundMessage = onInboundMessage;
    this.client = new QianxunProtocolClient({
      fetchImpl,
      onStyleLearned: (style) => this.persistLearnedStyle(style),
    });
  }

  attach(onInboundMessage: NonNullable<WeChatQianxunConnector["onInboundMessage"]>) {
    this.onInboundMessage = onInboundMessage;
  }

  publicConfig() {
    const config = this.readConfig();
    if (!config) return null;
    return {
      schemaVersion: config.schemaVersion,
      baseUrl: config.baseUrl,
      endpointStyle: config.endpointStyle,
      learnedEndpointStyle: config.learnedEndpointStyle || null,
      bindWxid: config.bindWxid,
      safeKeyConfigured: Boolean(config.safeKey),
      configuredAt: config.configuredAt,
    };
  }

  async status({ probe = true } = {}) {
    const config = this.readConfig();
    if (!config) return { configured: false, reachable: false, state: "needs_setup", callbackPath: "/api/internal/channels/wechat-personal/callback" };
    if (!probe) return { configured: true, reachable: null, state: "configured", config: this.publicConfig(), callbackPath: "/api/internal/channels/wechat-personal/callback" };
    try {
      const result = await this.client.invoke(this.effectiveClientConfig(config), qianxunEnvelope("checkWeChat"));
      assertQianxunAuthorizationActive(result.response);
      const wxid = extractQianxunWxid(result.response);
      const accountMatches = Boolean(wxid && wxid === config.bindWxid);
      return {
        configured: true,
        reachable: accountMatches,
        state: accountMatches ? "connected" : "account_mismatch",
        accountWxid: wxid || null,
        config: this.publicConfig(),
        endpointStyle: result.endpointStyle,
        callbackPath: "/api/internal/channels/wechat-personal/callback",
        ...(accountMatches ? {} : { error: wxid ? "Qianxun is connected to a different WeChat account" : "Qianxun did not report a logged-in wxid" }),
      };
    } catch (error) {
      const errorCode = typeof error === "object" && error && "code" in error ? String(error.code || "") : "";
      return {
        configured: true,
        reachable: false,
        state: "unavailable",
        config: this.publicConfig(),
        callbackPath: "/api/internal/channels/wechat-personal/callback",
        ...(errorCode ? { errorCode } : {}),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async detect(input: Record<string, unknown> = {}) {
    const current = this.readConfig();
    const requestedBaseUrl = validateQianxunBaseUrl(input.baseUrl || current?.baseUrl || "http://127.0.0.1:8055").origin;
    const requestedEndpointStyle = normalizeEndpointStyle(input.endpointStyle || current?.endpointStyle || "auto");
    if (!current || current.baseUrl !== requestedBaseUrl || current.endpointStyle !== requestedEndpointStyle) {
      const plan = this.planConfigure({
        baseUrl: requestedBaseUrl,
        endpointStyle: requestedEndpointStyle,
        bindWxid: input.bindWxid || current?.bindWxid || "",
        safeKey: input.safeKey || current?.safeKey || "",
      });
      this.operationStore.approve(plan.operation.id, {
        digest: plan.operation.digest,
        actor: { kind: "human", authenticated: true, loopback: true, channel: "local-console" },
      });
      await this.execute(plan.operation.id, plan.operation.digest);
    }
    const status = await this.status({ probe: true });
    if (status.state !== "connected") {
      throw connectorError(String(status.errorCode || "QIANXUN_DETECTION_FAILED"), String(status.error || "千寻 Pro 检测未通过"), 409);
    }
    return status;
  }

  async directory(): Promise<PersonalWechatDirectory> {
    const status = await this.status({ probe: true });
    if (status.state !== "connected") throw connectorError("QIANXUN_NOT_CONNECTED", "Qianxun must pass detection before reading WeChat contacts and groups", 409);
    const [profile, friends, groups] = await Promise.all([
      this.read("profile"),
      this.read("friends"),
      this.read("groups"),
    ]);
    const directory = normalizePersonalWechatDirectory(profile.result, friends.result, groups.result, String(status.accountWxid || ""));
    this.history.updateDirectory(directory);
    return directory;
  }

  accessPolicy() {
    return this.policies.read();
  }

  async updateAccessPolicy(input: unknown) {
    return this.policies.write(input, await this.directory());
  }

  connectivityTestStatus() {
    return this.connectivityTest.status();
  }

  async startConnectivityTest() {
    const status = await this.status({ probe: true });
    if (status.state !== "connected") throw connectorError("QIANXUN_NOT_CONNECTED", "千寻 Pro 检测通过后才能开始收发测试", 409);
    if (!this.policies.read().enabled) throw connectorError("WECHAT_POLICY_REQUIRED", "保存访问策略后才能开始收发测试", 409);
    return this.connectivityTest.start();
  }

  planConnectivityTestReply() {
    const target = this.connectivityTest.replyTarget();
    const planned = this.planAction("send-text", { wxid: target.recipientWxid, text: target.replyText });
    const state = this.connectivityTest.bindReplyPlan(planned.operation.id, planned.operation.digest);
    return { state, operation: { id: planned.operation.id, digest: planned.operation.digest, risk: planned.operation.risk, inputSummary: "向微信文件传输助手发送一条固定的本机连通测试回复" } };
  }

  async executeConnectivityTestReply(operationId: string, digest: string) {
    this.connectivityTest.requireReplyPlan(operationId, digest);
    this.operationStore.approve(operationId, { digest, actor: { kind: "human", authenticated: true, loopback: true, channel: "local-console" } });
    try {
      await this.execute(operationId, digest);
      return this.connectivityTest.complete();
    } catch (error) {
      this.connectivityTest.fail(error);
      throw error;
    }
  }

  planConfigure(input: Record<string, unknown>) {
    const baseUrl = validateQianxunBaseUrl(input.baseUrl).origin;
    const endpointStyle = normalizeEndpointStyle(input.endpointStyle);
    const bindWxid = boundedRequiredOrEmpty(input.bindWxid, "bindWxid", 160);
    const safeKey = boundedRequiredOrEmpty(input.safeKey, "safeKey", 4_096);
    const payload: PlannedPayload = { schemaVersion: 1, command: "wechat.qianxun.configure", input: { baseUrl, endpointStyle, bindWxid, safeKey } };
    return this.createPlan(payload, {
      risk: "R2",
      inputSummary: `Configure local Qianxun endpoint ${baseUrl}; expected account ${bindWxid || "auto-detect"}; SafeKey ${safeKey ? "provided" : "not provided"}`,
      target: baseUrl,
    });
  }

  planAction(action: string, input: Record<string, unknown>) {
    if (!WRITE_ACTIONS.has(action)) throw connectorError("INVALID_ARGUMENT", `Unsupported Qianxun write action: ${action}`, 400);
    const config = this.requireConfig();
    const normalized = normalizeWriteInput(action, input);
    const risk = action === "remove-contact" ? "R3" : "R2";
    const payload: PlannedPayload = { schemaVersion: 1, command: `wechat.qianxun.${action}`, input: normalized };
    return this.createPlan(payload, {
      risk,
      inputSummary: summarizeWrite(action, normalized),
      target: `${config.bindWxid}:${String(normalized.wxid || normalized.groupWxid || "account")}`,
    });
  }

  async execute(operationId: string, digest: string) {
    const pending = this.readPending(operationId);
    const pendingFile = this.pendingFile(operationId);
    try {
      return await this.operationStore.execute(operationId, {
        digest,
        actor: { kind: "pa-cli" },
        handler: async (operation: { command: string; stateFingerprint: string }) => {
          if (operation.command !== pending.command) throw connectorError("OPERATION_BINDING_MISMATCH", "Pending Qianxun command does not match the approved plan", 409);
          if (operation.stateFingerprint !== payloadDigest(pending)) throw connectorError("OPERATION_BINDING_MISMATCH", "Pending Qianxun payload does not match the approved plan", 409);
          if (pending.command === "wechat.qianxun.configure") return await this.executeConfigure(pending.input);
          return await this.executeWrite(pending.command.replace("wechat.qianxun.", ""), pending.input);
        },
      });
    } finally {
      try { fs.rmSync(pendingFile, { force: true }); } catch {}
    }
  }

  async read(operation: string, input: Record<string, unknown> = {}) {
    const map: Record<string, () => { type: QianxunOperationType; data: Record<string, unknown> }> = {
      profile: () => ({ type: "getSelfInfo", data: { type: "1" } }),
      lookup: () => ({ type: "queryObj", data: { wxid: boundedRequired(input.wxid, "wxid", 160), type: "1" } }),
      friends: () => ({ type: "getFriendList", data: { type: input.refresh === true ? "2" : "1" } }),
      groups: () => ({ type: "getGroupList", data: { type: input.refresh === true ? "2" : "1" } }),
      "official-accounts": () => ({ type: "getPublicList", data: { type: input.refresh === true ? "2" : "1" } }),
      members: () => ({ type: "getMemberList", data: { wxid: boundedRequired(input.groupWxid || input.wxid, "groupWxid", 160), type: input.refresh === true ? "2" : "1", getNick: "1" } }),
      stranger: () => ({ type: "queryNewFriend", data: { obj: boundedRequired(input.pq || input.wxid, "pq", 500) } }),
    };
    const build = map[operation];
    if (!build) throw connectorError("INVALID_ARGUMENT", `Unsupported Qianxun read operation: ${operation}`, 400);
    const selected = build();
    const config = this.requireConfig();
    const result = await this.client.invoke(this.effectiveClientConfig(config), qianxunEnvelope(selected.type, selected.data));
    return { operation, endpointStyle: result.endpointStyle, result: result.result };
  }

  listEvents(limit = 50) {
    return this.events.list(limit);
  }

  listConversations(limit = 50, beforeSeq?: number) {
    return this.history.listConversations(limit, beforeSeq);
  }

  conversationHistory(conversationId: unknown, options: { limit?: number; beforeSeq?: number } = {}) {
    return this.history.listMessages(conversationId, options);
  }

  close() {
    this.history.close();
  }

  async acceptCallback(body: unknown) {
    const callback = parseQianxunCallback(body);
    if (!callback) return { accepted: false, reason: "invalid_callback" };
    const config = this.readConfig();
    if (!config) return { accepted: false, reason: "not_configured" };
    if (!callback.accountWxid || callback.accountWxid !== config.bindWxid) return { accepted: false, reason: "account_mismatch" };
    const appended = this.events.appendUnique(callback);
    if (appended.duplicate) return { accepted: true, dispatched: false, reason: "duplicate", eventId: appended.record.id, type: callback.type };
    const message = normalizePersonalWechatMessage(appended.record, config.bindWxid);
    const historyMessage = message ? this.history.append(message, appended.record) : null;
    if (message) this.connectivityTest.capture(message);
    const decision = evaluatePersonalWechatAccess(this.policies.read(), message);
    if (!decision.allowed || !message) {
      return { accepted: true, dispatched: false, reason: decision.reason, eventId: appended.record.id, type: callback.type };
    }
    if (!this.onInboundMessage) {
      return { accepted: true, dispatched: false, reason: "dispatcher_unavailable", eventId: appended.record.id, type: callback.type };
    }
    await this.onInboundMessage(toInboundMessage(message, appended.record, historyMessage ? this.history.contextBefore(historyMessage, 100) : []));
    return { accepted: true, dispatched: true, reason: decision.reason, eventId: appended.record.id, type: callback.type };
  }

  async sendText(recipientId: string | undefined, text: string) {
    const wxid = boundedRequired(recipientId, "recipientId", 160);
    const msg = boundedRequired(text, "text", 16_000);
    const config = this.requireConfig();
    const result = await this.client.invoke(this.effectiveClientConfig(config), qianxunEnvelope("sendText", { wxid, msg }));
    return { sent: true, endpointStyle: result.endpointStyle, accountWxid: config.bindWxid };
  }

  private async executeConfigure(input: Record<string, unknown>) {
    const candidate: StoredConfig = {
      schemaVersion: 1,
      baseUrl: validateQianxunBaseUrl(input.baseUrl).origin,
      endpointStyle: normalizeEndpointStyle(input.endpointStyle),
      bindWxid: boundedRequiredOrEmpty(input.bindWxid, "bindWxid", 160),
      safeKey: boundedRequiredOrEmpty(input.safeKey, "safeKey", 4_096) || undefined,
      configuredAt: new Date().toISOString(),
    };
    const probe = await this.client.invoke(candidate, qianxunEnvelope("checkWeChat"));
    assertQianxunAuthorizationActive(probe.response);
    const detectedWxid = extractQianxunWxid(probe.response);
    if (!detectedWxid) throw connectorError("QIANXUN_ACCOUNT_REQUIRED", "Qianxun Pro checkWeChat did not report a logged-in wxid", 409);
    if (candidate.bindWxid && candidate.bindWxid !== detectedWxid) throw connectorError("QIANXUN_ACCOUNT_MISMATCH", "Qianxun is logged in to a different wxid than the approved plan", 409);
    candidate.bindWxid = detectedWxid;
    candidate.learnedEndpointStyle = probe.endpointStyle;
    this.writeConfig(candidate);
    return { configured: true, accountWxid: detectedWxid, endpointStyle: probe.endpointStyle, safeKeyConfigured: Boolean(candidate.safeKey) };
  }

  private async executeWrite(action: string, input: Record<string, unknown>) {
    const config = this.requireConfig();
    const mappings: Record<string, () => { type: QianxunOperationType; data: Record<string, unknown> }> = {
      "send-text": () => ({ type: "sendText", data: { wxid: input.wxid, msg: input.text } }),
      "send-image": () => ({ type: "sendImage", data: localFileData(input.wxid, input.filePath) }),
      "send-file": () => ({ type: "sendFile", data: localFileData(input.wxid, input.filePath) }),
      "set-remark": () => ({ type: "editObjRemark", data: { wxid: input.wxid, remark: input.remark } }),
      "accept-friend": () => ({ type: "agreeFriendReq", data: { scene: input.scene, v3: input.v3, v4: input.v4, role: input.role } }),
      "add-friend-v3": () => ({ type: "addFriendByV3", data: { v3: input.v3, content: input.content, scene: input.scene } }),
      "add-friend-group": () => ({ type: "addFriendByGroupWxid", data: { wxid: input.memberWxid, gid: input.groupWxid, content: input.content, scene: "14" } }),
      "invite-group": () => ({ type: "inviteMembers", data: { wxid: input.groupWxid, objWxid: input.memberWxid } }),
      "remove-contact": () => ({ type: "delFriend", data: { wxid: input.wxid } }),
    };
    const build = mappings[action];
    if (!build) throw connectorError("INVALID_ARGUMENT", `Unsupported approved Qianxun action: ${action}`, 400);
    const selected = build();
    const result = await this.client.invoke(this.effectiveClientConfig(config), qianxunEnvelope(selected.type, selected.data));
    return { action, endpointStyle: result.endpointStyle, accountWxid: config.bindWxid, result: result.result ?? null };
  }

  private createPlan(payload: PlannedPayload, plan: { risk: "R2" | "R3"; inputSummary: string; target: string }) {
    const operation = this.operationStore.plan({
      command: payload.command,
      risk: plan.risk,
      inputSummary: plan.inputSummary,
      target: plan.target,
      stateFingerprint: payloadDigest(payload),
    });
    fs.mkdirSync(this.pendingDir, { recursive: true, mode: 0o700 });
    atomicJson(this.pendingFile(operation.id), payload);
    return {
      operation,
      approvalCommand: `personal-agent operation approve ${operation.id} --digest ${operation.digest} --json`,
      executeCommand: `pa-cli connection wechat qianxun execute --operation ${operation.id} --digest ${operation.digest} --json`,
    };
  }

  private effectiveClientConfig(config: StoredConfig) {
    return config;
  }

  private importRetainedCallbackHistory() {
    for (const event of this.events.listAll()) {
      const accountWxid = typeof event.accountWxid === "string" ? event.accountWxid : "";
      const message = accountWxid ? normalizePersonalWechatMessage(event, accountWxid) : null;
      if (message) this.history.append(message, event);
    }
  }

  private persistLearnedStyle(style: "wechat" | "qianxun") {
    const config = this.readConfig();
    if (!config || config.learnedEndpointStyle === style) return;
    this.writeConfig({ ...config, learnedEndpointStyle: style });
  }

  private requireConfig() {
    const config = this.readConfig();
    if (!config) throw connectorError("QIANXUN_NOT_CONFIGURED", "Qianxun connector is not configured", 409);
    return config;
  }

  private readConfig(): StoredConfig | null {
    try {
      const value = JSON.parse(fs.readFileSync(this.configFile, "utf8"));
      if (value?.schemaVersion !== 1) return null;
      return {
        ...value,
        endpointStyle: normalizeEndpointStyle(value.endpointStyle),
        ...(value.learnedEndpointStyle ? { learnedEndpointStyle: normalizeLearnedEndpointStyle(value.learnedEndpointStyle) } : {}),
      };
    } catch { return null; }
  }

  private writeConfig(config: StoredConfig) {
    fs.mkdirSync(this.rootDir, { recursive: true, mode: 0o700 });
    atomicJson(this.configFile, config);
  }

  private pendingFile(operationId: string) {
    if (!/^op_[a-zA-Z0-9-]+$/.test(String(operationId || ""))) throw connectorError("INVALID_ARGUMENT", "Invalid operation id", 400);
    return path.join(this.pendingDir, `${operationId}.json`);
  }

  private readPending(operationId: string): PlannedPayload {
    try {
      const value = JSON.parse(fs.readFileSync(this.pendingFile(operationId), "utf8"));
      if (value?.schemaVersion !== 1 || typeof value.command !== "string" || !value.input || typeof value.input !== "object") throw new Error("invalid");
      return value;
    } catch { throw connectorError("NOT_FOUND", "Qianxun pending operation was not found", 404); }
  }
}

function toInboundMessage(message: PersonalWechatMessage, event: Record<string, unknown>, conversationHistory: PersonalWechatHistoryMessage[]) {
  const receivedAt = typeof event.receivedAt === "string" ? event.receivedAt : new Date().toISOString();
  const senderLabel = message.isGroup
    ? `微信群 ${maskForConversation(message.groupWxid)} · ${maskForConversation(message.senderWxid)}`
    : `微信联系人 ${maskForConversation(message.senderWxid)}`;
  return {
    senderId: message.conversationWxid,
    sender: senderLabel,
    sessionId: typeof event.eventKey === "string" ? event.eventKey : String(event.id || ""),
    text: message.text,
    conversationHistory,
    attachments: [] as never[],
    createdAt: receivedAt,
  };
}

function maskForConversation(value: string) {
  if (value.length <= 6) return `${value.slice(0, 1)}***${value.slice(-1)}`;
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

function normalizeWriteInput(action: string, input: Record<string, unknown>) {
  if (["send-text", "send-image", "send-file", "set-remark", "remove-contact"].includes(action)) {
    input.wxid = boundedRequired(input.wxid, "wxid", 160);
  }
  if (action === "send-text") return { wxid: input.wxid, text: boundedRequired(input.text, "text", 16_000) };
  if (["send-image", "send-file"].includes(action)) return { wxid: input.wxid, filePath: requireRegularFile(input.filePath) };
  if (action === "set-remark") return { wxid: input.wxid, remark: boundedRequired(input.remark, "remark", 500) };
  if (action === "accept-friend") return { scene: boundedRequired(input.scene, "scene", 32), v3: boundedRequired(input.v3, "v3", 1_000), v4: boundedRequired(input.v4, "v4", 1_000), role: String(boundedInteger(input.role ?? 0, "role")) };
  if (action === "add-friend-v3") return { v3: boundedRequired(input.v3, "v3", 1_000), content: boundedRequired(input.content, "content", 1_000), scene: boundedRequired(input.scene, "scene", 32) };
  if (action === "add-friend-group") return { groupWxid: boundedRequired(input.groupWxid, "groupWxid", 160), memberWxid: boundedRequired(input.memberWxid || input.wxid, "memberWxid", 160), content: boundedRequired(input.content, "content", 1_000) };
  if (action === "invite-group") return { groupWxid: boundedRequired(input.groupWxid, "groupWxid", 160), memberWxid: boundedRequired(input.memberWxid, "memberWxid", 160) };
  if (action === "remove-contact") return { wxid: input.wxid };
  throw connectorError("INVALID_ARGUMENT", `Unsupported Qianxun action: ${action}`, 400);
}

function summarizeWrite(action: string, input: Record<string, unknown>) {
  if (action === "send-text") return `Send text to ${input.wxid}: ${preview(input.text)} (${String(input.text).length} characters; sha256 ${shortDigest(input.text)})`;
  if (action === "send-image" || action === "send-file") return `${action} ${input.filePath} to ${input.wxid}`;
  if (action === "set-remark") return `Set remark on ${input.wxid} to ${String(input.remark).slice(0, 80)}`;
  if (action === "invite-group") return `Invite ${input.memberWxid} to ${input.groupWxid}`;
  if (action === "remove-contact") return `Permanently remove contact ${input.wxid}`;
  if (action === "accept-friend") return `Accept friend request v3=${String(input.v3).slice(0, 80)} scene=${input.scene}`;
  if (action === "add-friend-v3") return `Add friend v3=${String(input.v3).slice(0, 80)} with message ${preview(input.content)}`;
  if (action === "add-friend-group") return `Add ${input.memberWxid} from ${input.groupWxid} with message ${preview(input.content)}`;
  return `${action} for ${String(input.wxid || input.v3 || "account").slice(0, 160)}`;
}

function preview(value: unknown) {
  const text = String(value || "").replace(/\s+/g, " ");
  return JSON.stringify(text.length > 240 ? `${text.slice(0, 240)}…` : text);
}

function shortDigest(value: unknown) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

function normalizeEndpointStyle(value: unknown): QianxunEndpointStyle {
  const style = String(value || "auto").trim().toLowerCase();
  if (style === "client") return "wechat";
  if (style === "httpapi") return "qianxun";
  if (!new Set(["auto", "wechat", "qianxun"]).has(style)) throw connectorError("INVALID_ARGUMENT", "endpointStyle must be auto, wechat, or qianxun", 400);
  return style as QianxunEndpointStyle;
}

function normalizeLearnedEndpointStyle(value: unknown): "wechat" | "qianxun" {
  const style = normalizeEndpointStyle(value);
  if (style === "auto") throw connectorError("INVALID_ARGUMENT", "learnedEndpointStyle cannot be auto", 400);
  return style;
}

function assertQianxunAuthorizationActive(response: Parameters<typeof isQianxunAuthorizationExpired>[0]) {
  if (isQianxunAuthorizationExpired(response)) {
    throw connectorError("QIANXUN_AUTHORIZATION_EXPIRED", "千寻 Pro 授权已到期，请在千寻 Pro 中续费或重新申请试用", 409);
  }
}

function boundedRequired(value: unknown, name: string, max: number) {
  const text = String(value || "").trim();
  if (!text) throw connectorError("INVALID_ARGUMENT", `${name} is required`, 400);
  if (text.length > max) throw connectorError("INVALID_ARGUMENT", `${name} is too long`, 400);
  return text;
}

function boundedRequiredOrEmpty(value: unknown, name: string, max: number) {
  const text = String(value || "").trim();
  if (text.length > max) throw connectorError("INVALID_ARGUMENT", `${name} is too long`, 400);
  return text;
}

function boundedInteger(value: unknown, name: string) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 10_000) throw connectorError("INVALID_ARGUMENT", `${name} must be an integer`, 400);
  return number;
}

function requireRegularFile(value: unknown) {
  const filePath = path.resolve(boundedRequired(value, "filePath", 2_000));
  let stat;
  try { stat = fs.statSync(filePath); }
  catch { throw connectorError("INVALID_ARGUMENT", "filePath must point to an existing regular file", 400); }
  if (!stat.isFile()) throw connectorError("INVALID_ARGUMENT", "filePath must point to a regular file", 400);
  return filePath;
}

function localFileData(wxid: unknown, value: unknown) {
  const filePath = requireRegularFile(value);
  return { wxid, path: filePath, fileName: path.basename(filePath) };
}

function payloadDigest(payload: PlannedPayload) {
  return crypto.createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function atomicJson(filePath: string, value: unknown) {
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try { fs.renameSync(temporary, filePath); } finally { try { fs.rmSync(temporary, { force: true }); } catch {} }
  try { fs.chmodSync(filePath, 0o600); } catch {}
}
