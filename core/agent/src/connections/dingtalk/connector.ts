import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DWClient, TOPIC_ROBOT, type DWClientDownStream, type RobotMessage } from "dingtalk-stream";
import type { InstallationConnectionOwnership } from "../connection-ownership.ts";

type Logger = { log: (message: string) => void; error: (message: string) => void };
type DingTalkConfig = {
  schemaVersion: 1;
  clientId: string;
  clientSecret: string;
  spaceId?: string;
  configuredAt: string;
  updatedAt: string;
};
type StreamClient = Pick<DWClient, "connected" | "connect" | "disconnect" | "getAccessToken" | "registerCallbackListener" | "socketCallBackResponse">;
type InboundHandler = (message: {
  senderId: string;
  senderName: string;
  text: string;
  attachments: never[];
  createdAt: string;
  platformSenderId: string;
  conversationType: string;
}) => Promise<unknown>;

const CONFIG_NAME = "dingtalk.json";
const WEBHOOK_HOST_SUFFIX = ".dingtalk.com";
const DELIVERY_CONTEXT_LIMIT = 500;
const MESSAGE_DEDUPE_LIMIT = 2_000;
const CONNECT_RETRY_MS = 5_000;

export class DingTalkConnector {
  private readonly configFile: string;
  private readonly ownership?: { store: InstallationConnectionOwnership; spaceId: string };
  private readonly clientFactory: (config: DingTalkConfig) => StreamClient;
  private readonly fetchImpl: typeof fetch;
  private client: StreamClient | null = null;
  private inboundHandler: InboundHandler | null = null;
  private stopped = true;
  private connecting = false;
  private generation = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private lastConnectedAt = "";
  private lastInboundAt = "";
  private lastError = "";
  private readonly deliveries = new Map<string, { webhook: string; expiresAt: number }>();
  private readonly seenMessageIds = new Set<string>();

  constructor({
    dataRoot,
    logger,
    ownership,
    fetchImpl = fetch,
    clientFactory = (config) => new DWClient({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      keepAlive: true,
      debug: false,
      ua: "personal-agent-node",
    }),
  }: {
    dataRoot: string;
    logger: Logger;
    ownership?: { store: InstallationConnectionOwnership; spaceId: string };
    fetchImpl?: typeof fetch;
    clientFactory?: (config: DingTalkConfig) => StreamClient;
  }) {
    this.configFile = path.join(path.resolve(dataRoot), "secrets", "connections", CONFIG_NAME);
    this.logger = logger;
    this.ownership = ownership;
    this.fetchImpl = fetchImpl;
    this.clientFactory = clientFactory;
  }

  private readonly logger: Logger;

  attach(handler: InboundHandler) {
    this.inboundHandler = handler;
  }

  start() {
    this.stopped = false;
    if (this.loadConfig()) void this.connect();
  }

  stop() {
    this.stopped = true;
    this.generation += 1;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.client) this.client.disconnect();
    this.client = null;
    this.connecting = false;
    this.deliveries.clear();
  }

  catalogStatus() {
    const config = this.loadConfig();
    const ownershipError = config ? this.ownershipError(config) : "";
    const connected = Boolean(config && !ownershipError && this.client?.connected);
    if (connected && !this.lastConnectedAt) this.lastConnectedAt = new Date().toISOString();
    return {
      configured: Boolean(config),
      connected,
      state: ownershipError || this.lastError ? "error" : connected ? "connected" : config ? "connecting" : "needs_setup",
      statusLabel: ownershipError ? "已被其他 Space 占用" : this.lastError ? "连接失败" : connected ? "已连接" : config ? "正在连接" : "待连接",
      ...(ownershipError || this.lastError ? { error: ownershipError || this.lastError } : {}),
      details: { configured: Boolean(config), clientId: config ? maskClientId(config.clientId) : "" },
    };
  }

  status() {
    const config = this.loadConfig();
    const catalog = this.catalogStatus();
    return {
      ...catalog,
      details: {
        ...catalog.details,
        lastConnectedAt: this.lastConnectedAt,
        lastInboundAt: this.lastInboundAt,
      },
      connecting: this.connecting,
      lastConnectedAt: this.lastConnectedAt,
      lastInboundAt: this.lastInboundAt,
      capabilities: { inbound: ["text"], outbound: ["text"] },
      account: config ? { clientId: maskClientId(config.clientId), configuredAt: config.configuredAt, updatedAt: config.updatedAt } : null,
    };
  }

  async configure(input: { clientId?: unknown; clientSecret?: unknown }) {
    const clientId = String(input.clientId || "").trim();
    const clientSecret = String(input.clientSecret || "").trim();
    validateCredentials(clientId, clientSecret);
    const previous = this.loadConfig();
    const now = new Date().toISOString();
    const next: DingTalkConfig = {
      schemaVersion: 1,
      clientId,
      clientSecret,
      ...(this.ownership?.spaceId ? { spaceId: this.ownership.spaceId } : {}),
      configuredAt: previous?.configuredAt || now,
      updatedAt: now,
    };
    const validator = this.clientFactory(next);
    try {
      await validator.getAccessToken();
    } catch {
      throw connectorError("DINGTALK_CREDENTIALS_REJECTED", "钉钉未接受 Client ID 或 Client Secret，请检查应用凭据", 400);
    }
    this.ownership?.store.replace("dingtalk-bot", [clientId], this.ownership.spaceId);
    try {
      writeConfig(this.configFile, next);
    } catch (error) {
      if (previous) this.ownership?.store.replace("dingtalk-bot", [previous.clientId], this.ownership.spaceId);
      else this.ownership?.store.release("dingtalk-bot", this.ownership.spaceId);
      throw error;
    }
    this.stop();
    this.lastError = "";
    this.start();
    return this.status();
  }

  clearConfiguration() {
    const configuredBefore = Boolean(this.loadConfig());
    this.stop();
    this.ownership?.store.release("dingtalk-bot", this.ownership.spaceId);
    fs.rmSync(this.configFile, { force: true });
    this.lastConnectedAt = "";
    this.lastInboundAt = "";
    this.lastError = "";
    return { cleared: true, configuredBefore };
  }

  async sendText(recipientId: string, text: string) {
    const delivery = this.deliveries.get(String(recipientId || ""));
    if (!delivery || delivery.expiresAt <= Date.now()) {
      throw connectorError("DINGTALK_REPLY_CONTEXT_EXPIRED", "钉钉会话回复窗口已过期，请从钉钉重新发送一条消息", 409);
    }
    const webhook = safeWebhook(delivery.webhook);
    const client = this.client;
    if (!client) throw connectorError("DINGTALK_NOT_CONNECTED", "钉钉 Stream 连接尚未就绪", 409);
    const accessToken = await client.getAccessToken();
    const response = await this.fetchImpl(webhook, {
      method: "POST",
      headers: { "content-type": "application/json", "x-acs-dingtalk-access-token": String(accessToken) },
      body: JSON.stringify({ msgtype: "text", text: { content: String(text || "") } }),
    });
    const payload = await response.json().catch(() => ({})) as { errcode?: number; errmsg?: string };
    if (!response.ok || (payload.errcode !== undefined && payload.errcode !== 0)) {
      throw connectorError("DINGTALK_SEND_FAILED", `钉钉消息发送失败${payload.errmsg ? `：${String(payload.errmsg).slice(0, 120)}` : ""}`, 502);
    }
    return { sent: true };
  }

  private async connect() {
    if (this.stopped || this.connecting) return;
    const config = this.loadConfig();
    if (!config) return;
    const ownershipError = this.ownershipError(config);
    if (ownershipError) { this.lastError = ownershipError; return; }
    const generation = ++this.generation;
    this.connecting = true;
    const client = this.clientFactory(config);
    this.client = client;
    client.registerCallbackListener(TOPIC_ROBOT, (message) => this.handleRobotMessage(client, message));
    try {
      await client.connect();
      if (generation !== this.generation || this.stopped) return;
      this.lastError = "";
      if (client.connected) this.lastConnectedAt = new Date().toISOString();
    } catch {
      if (generation === this.generation) {
        this.lastError = "钉钉 Stream 连接失败，后台将自动重试";
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          void this.connect();
        }, CONNECT_RETRY_MS);
        this.retryTimer.unref?.();
      }
    } finally {
      if (generation === this.generation) this.connecting = false;
    }
  }

  private handleRobotMessage(client: StreamClient, downstream: DWClientDownStream) {
    const messageId = String(downstream.headers?.messageId || "");
    try { if (messageId) client.socketCallBackResponse(messageId, { status: "SUCCESS" }); } catch {}
    if (messageId && this.seenMessageIds.has(messageId)) return;
    if (messageId) rememberBounded(this.seenMessageIds, messageId, MESSAGE_DEDUPE_LIMIT);
    let message: RobotMessage;
    try { message = JSON.parse(downstream.data) as RobotMessage; }
    catch { return; }
    const text = message.msgtype === "text" ? String(message.text?.content || "").trim() : "";
    const conversationId = String(message.conversationId || "").trim();
    if (!text || !conversationId || !message.sessionWebhook || !this.inboundHandler) return;
    const expiresAt = Number(message.sessionWebhookExpiredTime || 0);
    this.deliveries.set(conversationId, { webhook: safeWebhook(message.sessionWebhook), expiresAt: expiresAt > Date.now() ? expiresAt : Date.now() + 60 * 60_000 });
    pruneDeliveries(this.deliveries);
    this.lastInboundAt = new Date().toISOString();
    void this.inboundHandler({
      senderId: conversationId,
      senderName: String(message.senderNick || message.senderStaffId || "钉钉用户"),
      text,
      attachments: [],
      createdAt: new Date(Number(message.createAt || Date.now())).toISOString(),
      platformSenderId: String(message.senderStaffId || message.senderId || ""),
      conversationType: String(message.conversationType || ""),
    }).catch((error) => this.logger.error(`[dingtalk] inbound handling failed: ${error instanceof Error ? error.message : String(error)}`));
  }

  private loadConfig(): DingTalkConfig | null {
    try {
      const value = JSON.parse(fs.readFileSync(this.configFile, "utf8"));
      if (value?.schemaVersion !== 1 || !value.clientId || !value.clientSecret) return null;
      return value as DingTalkConfig;
    } catch { return null; }
  }

  private ownershipError(config: DingTalkConfig) {
    if (config.spaceId && this.ownership?.spaceId && config.spaceId !== this.ownership.spaceId) return "该钉钉连接属于另一个 Space";
    try { this.ownership?.store.assertOrClaim("dingtalk-bot", [config.clientId], this.ownership.spaceId); return ""; }
    catch (error) { return error instanceof Error ? error.message : String(error); }
  }
}

function validateCredentials(clientId: string, clientSecret: string) {
  if (!/^[A-Za-z0-9._-]{8,128}$/.test(clientId)) throw connectorError("DINGTALK_CLIENT_ID_INVALID", "请输入有效的钉钉 Client ID", 400);
  if (clientSecret.length < 16 || clientSecret.length > 256) throw connectorError("DINGTALK_CLIENT_SECRET_INVALID", "请输入有效的钉钉 Client Secret", 400);
}

function writeConfig(filePath: string, value: DingTalkConfig) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try { fs.renameSync(temporary, filePath); }
  finally { try { fs.rmSync(temporary, { force: true }); } catch {} }
  try { fs.chmodSync(filePath, 0o600); } catch {}
}

function safeWebhook(value: string) {
  const url = new URL(String(value || ""));
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || (hostname !== "dingtalk.com" && !hostname.endsWith(WEBHOOK_HOST_SUFFIX))) {
    throw connectorError("DINGTALK_WEBHOOK_REJECTED", "钉钉返回了不受信任的会话回复地址", 502);
  }
  return url.toString();
}

function pruneDeliveries(values: Map<string, { webhook: string; expiresAt: number }>) {
  for (const [key, value] of values) if (value.expiresAt <= Date.now()) values.delete(key);
  while (values.size > DELIVERY_CONTEXT_LIMIT) values.delete(values.keys().next().value as string);
}

function rememberBounded(values: Set<string>, value: string, limit: number) {
  values.add(value);
  while (values.size > limit) values.delete(values.values().next().value as string);
}

function maskClientId(value: string) {
  if (value.length <= 10) return `${value.slice(0, 3)}***`;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function connectorError(code: string, message: string, statusCode: number) {
  return Object.assign(new Error(message), { code, statusCode });
}
