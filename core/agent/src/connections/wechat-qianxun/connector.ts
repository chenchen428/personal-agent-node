import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createOperationStore } from "../../../../runtime/src/operations.ts";
import { QianxunProtocolClient, connectorError, validateQianxunBaseUrl } from "./client.ts";
import { parseQianxunCallback, QianxunCallbackStore } from "./callback-store.ts";
import { extractQianxunWxid, qianxunEnvelope, type QianxunEndpointStyle } from "./protocol.ts";
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
  learnedEndpointStyle?: "client" | "httpapi";
  bindWxid: string;
  safeKey?: string;
  configuredAt: string;
};

type PlannedPayload = {
  schemaVersion: 1;
  command: string;
  input: Record<string, unknown>;
};

const WRITE_ACTIONS = new Set(["send-text", "send-image", "send-file", "set-remark", "accept-friend", "add-friend-v3", "add-friend-wxid", "invite-group", "remove-contact"]);

export class WeChatQianxunConnector {
  private readonly rootDir: string;
  private readonly configFile: string;
  private readonly pendingDir: string;
  private readonly operationStore: ReturnType<typeof createOperationStore>;
  private readonly client: QianxunProtocolClient;
  private readonly events: QianxunCallbackStore;
  private readonly policies: PersonalWechatPolicyStore;
  private onInboundMessage: ((message: {
    senderId: string;
    sender: string;
    sessionId: string;
    text: string;
    attachments: never[];
    createdAt: string;
  }) => Promise<unknown>) | null;

  constructor({ dataRoot, fetchImpl = fetch, operationStore, onInboundMessage = null }: {
    dataRoot: string;
    fetchImpl?: typeof fetch;
    operationStore?: ReturnType<typeof createOperationStore>;
    onInboundMessage?: ((message: { senderId: string; sender: string; sessionId: string; text: string; attachments: never[]; createdAt: string }) => Promise<unknown>) | null;
  }) {
    if (!path.isAbsolute(dataRoot || "")) throw new Error("Qianxun data root must be absolute");
    this.rootDir = path.join(dataRoot, "connections", "wechat", "qianxun");
    this.configFile = path.join(this.rootDir, "config.json");
    this.pendingDir = path.join(this.rootDir, "pending");
    this.operationStore = operationStore || createOperationStore({ dataRoot });
    this.events = new QianxunCallbackStore(dataRoot);
    this.policies = new PersonalWechatPolicyStore(dataRoot);
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
      const result = await this.client.invoke(this.effectiveClientConfig(config), qianxunEnvelope("Q0000"));
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
      return {
        configured: true,
        reachable: false,
        state: "unavailable",
        config: this.publicConfig(),
        callbackPath: "/api/internal/channels/wechat-personal/callback",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async detect(input: Record<string, unknown> = {}) {
    if (!this.readConfig()) {
      const plan = this.planConfigure({
        baseUrl: input.baseUrl || "http://127.0.0.1:8055",
        endpointStyle: input.endpointStyle || "auto",
        bindWxid: input.bindWxid || "",
        safeKey: input.safeKey || "",
      });
      this.operationStore.approve(plan.operation.id, {
        digest: plan.operation.digest,
        actor: { kind: "human", authenticated: true, loopback: true, channel: "local-console" },
      });
      await this.execute(plan.operation.id, plan.operation.digest);
    }
    return await this.status({ probe: true });
  }

  async directory(): Promise<PersonalWechatDirectory> {
    const status = await this.status({ probe: true });
    if (status.state !== "connected") throw connectorError("QIANXUN_NOT_CONNECTED", "Qianxun must pass detection before reading WeChat contacts and groups", 409);
    const [profile, friends, groups] = await Promise.all([
      this.read("profile"),
      this.read("friends"),
      this.read("groups"),
    ]);
    return normalizePersonalWechatDirectory(profile.result, friends.result, groups.result, String(status.accountWxid || ""));
  }

  accessPolicy() {
    return this.policies.read();
  }

  async updateAccessPolicy(input: unknown) {
    return this.policies.write(input, await this.directory());
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
    const map: Record<string, () => { code: "Q0003" | "Q0004" | "Q0005" | "Q0006" | "Q0007" | "Q0008" | "Q0020"; data: Record<string, unknown> }> = {
      profile: () => ({ code: "Q0003", data: {} }),
      lookup: () => ({ code: "Q0004", data: { wxid: boundedRequired(input.wxid, "wxid", 160) } }),
      friends: () => ({ code: "Q0005", data: { type: input.refresh === true ? 2 : 1 } }),
      groups: () => ({ code: "Q0006", data: { type: input.refresh === true ? 2 : 1 } }),
      "official-accounts": () => ({ code: "Q0007", data: { type: input.refresh === true ? 2 : 1 } }),
      members: () => ({ code: "Q0008", data: { wxid: boundedRequired(input.groupWxid || input.wxid, "groupWxid", 160) } }),
      stranger: () => ({ code: "Q0020", data: { pq: boundedRequired(input.pq || input.wxid, "pq", 500) } }),
    };
    const build = map[operation];
    if (!build) throw connectorError("INVALID_ARGUMENT", `Unsupported Qianxun read operation: ${operation}`, 400);
    const selected = build();
    const config = this.requireConfig();
    const result = await this.client.invoke(this.effectiveClientConfig(config), qianxunEnvelope(selected.code, selected.data));
    return { operation, endpointStyle: result.endpointStyle, result: result.result };
  }

  listEvents(limit = 50) {
    return this.events.list(limit);
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
    const decision = evaluatePersonalWechatAccess(this.policies.read(), message);
    if (!decision.allowed || !message) {
      return { accepted: true, dispatched: false, reason: decision.reason, eventId: appended.record.id, type: callback.type };
    }
    if (!this.onInboundMessage) {
      return { accepted: true, dispatched: false, reason: "dispatcher_unavailable", eventId: appended.record.id, type: callback.type };
    }
    await this.onInboundMessage(toInboundMessage(message, appended.record));
    return { accepted: true, dispatched: true, reason: decision.reason, eventId: appended.record.id, type: callback.type };
  }

  async sendText(recipientId: string | undefined, text: string) {
    const wxid = boundedRequired(recipientId, "recipientId", 160);
    const msg = boundedRequired(text, "text", 16_000);
    const config = this.requireConfig();
    const result = await this.client.invoke(this.effectiveClientConfig(config), qianxunEnvelope("Q0001", { wxid, msg }));
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
    const probe = await this.client.invoke(candidate, qianxunEnvelope("Q0000"));
    const detectedWxid = extractQianxunWxid(probe.response);
    if (!detectedWxid) throw connectorError("QIANXUN_ACCOUNT_REQUIRED", "Qianxun Q0000 did not report a logged-in wxid", 409);
    if (candidate.bindWxid && candidate.bindWxid !== detectedWxid) throw connectorError("QIANXUN_ACCOUNT_MISMATCH", "Qianxun is logged in to a different wxid than the approved plan", 409);
    candidate.bindWxid = detectedWxid;
    candidate.learnedEndpointStyle = probe.endpointStyle;
    this.writeConfig(candidate);
    return { configured: true, accountWxid: detectedWxid, endpointStyle: probe.endpointStyle, safeKeyConfigured: Boolean(candidate.safeKey) };
  }

  private async executeWrite(action: string, input: Record<string, unknown>) {
    const config = this.requireConfig();
    const mappings: Record<string, () => { code: "Q0001" | "Q0010" | "Q0011" | "Q0017" | "Q0018" | "Q0019" | "Q0021" | "Q0022" | "Q0023"; data: Record<string, unknown> }> = {
      "send-text": () => ({ code: "Q0001", data: { wxid: input.wxid, msg: input.text } }),
      "send-image": () => ({ code: "Q0010", data: { wxid: input.wxid, path: requireRegularFile(input.filePath) } }),
      "send-file": () => ({ code: "Q0011", data: { wxid: input.wxid, path: requireRegularFile(input.filePath) } }),
      "set-remark": () => ({ code: "Q0023", data: { wxid: input.wxid, remark: input.remark } }),
      "accept-friend": () => ({ code: "Q0017", data: { scene: input.scene, v3: input.v3, v4: input.v4 } }),
      "add-friend-v3": () => ({ code: "Q0018", data: { v3: input.v3, content: input.content, scene: input.scene, type: input.type } }),
      "add-friend-wxid": () => ({ code: "Q0019", data: { wxid: input.wxid, content: input.content, scene: input.scene } }),
      "invite-group": () => ({ code: "Q0021", data: { wxid: input.groupWxid, objWxid: input.memberWxid, type: input.type } }),
      "remove-contact": () => ({ code: "Q0022", data: { wxid: input.wxid } }),
    };
    const build = mappings[action];
    if (!build) throw connectorError("INVALID_ARGUMENT", `Unsupported approved Qianxun action: ${action}`, 400);
    const selected = build();
    const result = await this.client.invoke(this.effectiveClientConfig(config), qianxunEnvelope(selected.code, selected.data));
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

  private persistLearnedStyle(style: "client" | "httpapi") {
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
      return value?.schemaVersion === 1 ? value : null;
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

function toInboundMessage(message: PersonalWechatMessage, event: Record<string, unknown>) {
  const receivedAt = typeof event.receivedAt === "string" ? event.receivedAt : new Date().toISOString();
  const senderLabel = message.isGroup
    ? `微信群 ${maskForConversation(message.groupWxid)} · ${maskForConversation(message.senderWxid)}`
    : `微信联系人 ${maskForConversation(message.senderWxid)}`;
  return {
    senderId: message.conversationWxid,
    sender: senderLabel,
    sessionId: typeof event.eventKey === "string" ? event.eventKey : String(event.id || ""),
    text: message.text,
    attachments: [] as never[],
    createdAt: receivedAt,
  };
}

function maskForConversation(value: string) {
  if (value.length <= 6) return `${value.slice(0, 1)}***${value.slice(-1)}`;
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

function normalizeWriteInput(action: string, input: Record<string, unknown>) {
  if (["send-text", "send-image", "send-file", "set-remark", "add-friend-wxid", "remove-contact"].includes(action)) {
    input.wxid = boundedRequired(input.wxid, "wxid", 160);
  }
  if (action === "send-text") return { wxid: input.wxid, text: boundedRequired(input.text, "text", 16_000) };
  if (["send-image", "send-file"].includes(action)) return { wxid: input.wxid, filePath: requireRegularFile(input.filePath) };
  if (action === "set-remark") return { wxid: input.wxid, remark: boundedRequired(input.remark, "remark", 500) };
  if (action === "accept-friend") return { scene: boundedRequired(input.scene, "scene", 32), v3: boundedRequired(input.v3, "v3", 1_000), v4: boundedRequired(input.v4, "v4", 1_000) };
  if (action === "add-friend-v3") return { v3: boundedRequired(input.v3, "v3", 1_000), content: boundedRequired(input.content, "content", 1_000), scene: boundedRequired(input.scene, "scene", 32), type: boundedInteger(input.type, "type") };
  if (action === "add-friend-wxid") return { wxid: input.wxid, content: boundedRequired(input.content, "content", 1_000), scene: boundedRequired(input.scene, "scene", 32) };
  if (action === "invite-group") return { groupWxid: boundedRequired(input.groupWxid, "groupWxid", 160), memberWxid: boundedRequired(input.memberWxid, "memberWxid", 160), type: boundedInteger(input.type ?? 1, "type") };
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
  if (action === "add-friend-wxid") return `Add friend ${input.wxid} with message ${preview(input.content)}`;
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
  if (!new Set(["auto", "client", "httpapi"]).has(style)) throw connectorError("INVALID_ARGUMENT", "endpointStyle must be auto, client, or httpapi", 400);
  return style as QianxunEndpointStyle;
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
