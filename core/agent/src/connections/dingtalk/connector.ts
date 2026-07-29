import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import mime from "mime-types";
import { DWClient, TOPIC_ROBOT, type DWClientDownStream } from "dingtalk-stream";
import { relativeAttachmentPath, sanitizeInboundAttachmentFileName } from "../../private-files/attachments.js";
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
type InboundAttachment = {
  kind: "image" | "file";
  path: string;
  fileName: string;
  sizeBytes: number;
  managedObjectId?: string;
  managedObjectKey?: string;
};
type InboundHandler = (message: {
  senderId: string;
  senderName: string;
  text: string;
  attachments: InboundAttachment[];
  createdAt: string;
  platformSenderId: string;
  conversationType: string;
}) => Promise<unknown>;
type AttachmentRegistrar = (input: {
  filePath: string;
  relativePath: string;
  contentType: string;
  source: "dingtalk";
}) => Promise<{ uploaded?: boolean; objectId?: string; objectKey?: string }>;
type DingTalkRobotMessage = {
  conversationId?: unknown;
  msgId?: unknown;
  senderNick?: unknown;
  senderStaffId?: unknown;
  senderId?: unknown;
  sessionWebhook?: unknown;
  sessionWebhookExpiredTime?: unknown;
  createAt?: unknown;
  conversationType?: unknown;
  robotCode?: unknown;
  msgtype?: unknown;
  text?: { content?: unknown };
  content?: {
    downloadCode?: unknown;
    pictureDownloadCode?: unknown;
    fileName?: unknown;
    recognition?: unknown;
    videoType?: unknown;
    richText?: Array<{ text?: unknown; type?: unknown; downloadCode?: unknown; pictureDownloadCode?: unknown }>;
  };
};
type MediaDescriptor = { kind: "image" | "file"; downloadCode: string; fileName: string; fallbackExtension?: string };

const CONFIG_NAME = "dingtalk.json";
const WEBHOOK_HOST_SUFFIX = ".dingtalk.com";
const DELIVERY_CONTEXT_LIMIT = 500;
const MESSAGE_DEDUPE_LIMIT = 2_000;
const CONNECT_RETRY_MS = 5_000;
const MAX_INBOUND_MEDIA_BYTES = 50 * 1024 * 1024;
const MAX_OUTBOUND_MEDIA_BYTES = 10 * 1024 * 1024;
const MAX_INBOUND_ATTACHMENTS = 10;
const MEDIA_DOWNLOAD_ENDPOINT = "https://api.dingtalk.com/v1.0/robot/messageFiles/download";
const MEDIA_UPLOAD_ENDPOINT = "https://oapi.dingtalk.com/media/upload";
const TRUSTED_MEDIA_HOST_SUFFIXES = [".dingtalk.com", ".aliyuncs.com", ".alicdn.com", ".dingtalkusercontent.com"];

export class DingTalkConnector {
  private readonly configFile: string;
  private readonly ownership?: { store: InstallationConnectionOwnership; spaceId: string };
  private readonly clientFactory: (config: DingTalkConfig) => StreamClient;
  private readonly fetchImpl: typeof fetch;
  private readonly inboundAttachmentsDir: string;
  private readonly registerAttachment?: AttachmentRegistrar;
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
    inboundAttachmentsDir = path.join(dataRoot, "files", "inbound"),
    registerAttachment,
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
    inboundAttachmentsDir?: string;
    registerAttachment?: AttachmentRegistrar;
    clientFactory?: (config: DingTalkConfig) => StreamClient;
  }) {
    this.configFile = path.join(path.resolve(dataRoot), "secrets", "connections", CONFIG_NAME);
    this.logger = logger;
    this.ownership = ownership;
    this.fetchImpl = fetchImpl;
    this.inboundAttachmentsDir = path.resolve(inboundAttachmentsDir);
    this.registerAttachment = registerAttachment;
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
      capabilities: { inbound: ["text", "image", "file", "audio", "video", "richText"], outbound: ["text", "image", "file"] },
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
    return await this.sendPayload(recipientId, { msgtype: "text", text: { content: String(text || "") } });
  }

  async sendImage(recipientId: string, imagePath: string) {
    const mediaId = await this.uploadMedia(imagePath, "image");
    return await this.sendPayload(recipientId, { msgtype: "image", image: { media_id: mediaId } });
  }

  async sendFile(recipientId: string, filePath: string) {
    const mediaId = await this.uploadMedia(filePath, "file");
    return await this.sendPayload(recipientId, { msgtype: "file", file: { media_id: mediaId } });
  }

  private async sendPayload(recipientId: string, payload: Record<string, unknown>) {
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
      body: JSON.stringify(payload),
    });
    const responsePayload = await response.json().catch(() => ({})) as { errcode?: number; errmsg?: string };
    if (!response.ok || (responsePayload.errcode !== undefined && responsePayload.errcode !== 0)) {
      throw connectorError("DINGTALK_SEND_FAILED", `钉钉消息发送失败${responsePayload.errmsg ? `：${String(responsePayload.errmsg).slice(0, 120)}` : ""}`, 502);
    }
    return { sent: true };
  }

  private async uploadMedia(filePath: string, type: "image" | "file") {
    const resolved = path.resolve(String(filePath || ""));
    const stat = await fs.promises.stat(resolved).catch(() => null);
    if (!stat?.isFile() || stat.size <= 0 || stat.size > MAX_OUTBOUND_MEDIA_BYTES) {
      throw connectorError("DINGTALK_MEDIA_SIZE_UNSUPPORTED", "钉钉附件必须是 10 MB 以内的非空文件", 400);
    }
    const client = this.client;
    if (!client) throw connectorError("DINGTALK_NOT_CONNECTED", "钉钉 Stream 连接尚未就绪", 409);
    const accessToken = String(await client.getAccessToken());
    const form = new FormData();
    const bytes = new Uint8Array(await fs.promises.readFile(resolved));
    form.append("media", new Blob([bytes], { type: String(mime.lookup(resolved) || "application/octet-stream") }), path.basename(resolved));
    const url = new URL(MEDIA_UPLOAD_ENDPOINT);
    url.searchParams.set("access_token", accessToken);
    url.searchParams.set("type", type);
    const response = await this.fetchImpl(url, { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
    const body = await response.json().catch(() => ({})) as { errcode?: number; errmsg?: string; media_id?: string };
    if (!response.ok || body.errcode !== 0 || !body.media_id) {
      throw connectorError("DINGTALK_MEDIA_UPLOAD_FAILED", `钉钉附件上传失败${body.errmsg ? `：${String(body.errmsg).slice(0, 120)}` : ""}`, 502);
    }
    return String(body.media_id);
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
    client.registerCallbackListener(TOPIC_ROBOT, (message) => {
      void this.handleRobotMessage(client, message).catch((error) => this.logger.error(`[dingtalk] callback handling failed: ${safeErrorMessage(error)}`));
    });
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

  private async handleRobotMessage(client: StreamClient, downstream: DWClientDownStream) {
    const messageId = String(downstream.headers?.messageId || "");
    try { if (messageId) client.socketCallBackResponse(messageId, { status: "SUCCESS" }); } catch {}
    if (messageId && this.seenMessageIds.has(messageId)) return;
    if (messageId) rememberBounded(this.seenMessageIds, messageId, MESSAGE_DEDUPE_LIMIT);
    let message: DingTalkRobotMessage;
    try { message = JSON.parse(downstream.data) as DingTalkRobotMessage; }
    catch { return; }
    const conversationId = String(message.conversationId || "").trim();
    if (!conversationId || !message.sessionWebhook || !this.inboundHandler) return;
    const expiresAt = Number(message.sessionWebhookExpiredTime || 0);
    this.deliveries.set(conversationId, { webhook: safeWebhook(String(message.sessionWebhook)), expiresAt: expiresAt > Date.now() ? expiresAt : Date.now() + 60 * 60_000 });
    pruneDeliveries(this.deliveries);
    let normalized: { text: string; attachments: InboundAttachment[] };
    try {
      normalized = await this.normalizeInboundMessage(client, message, messageId || String(message.msgId || crypto.randomUUID()));
    } catch (error) {
      this.logger.error(`[dingtalk] media handling failed: ${safeErrorMessage(error)}`);
      normalized = { text: "[钉钉附件下载失败，请让发送者重新发送或改用受支持的文件格式。]", attachments: [] };
    }
    if (!normalized.text && !normalized.attachments.length) return;
    this.lastInboundAt = new Date().toISOString();
    await this.inboundHandler({
      senderId: conversationId,
      senderName: String(message.senderNick || message.senderStaffId || "钉钉用户"),
      text: normalized.text,
      attachments: normalized.attachments,
      createdAt: new Date(Number(message.createAt || Date.now())).toISOString(),
      platformSenderId: String(message.senderStaffId || message.senderId || ""),
      conversationType: String(message.conversationType || ""),
    }).catch((error) => this.logger.error(`[dingtalk] inbound handling failed: ${safeErrorMessage(error)}`));
  }

  private async normalizeInboundMessage(client: StreamClient, message: DingTalkRobotMessage, messageId: string) {
    const type = String(message.msgtype || "");
    const content = message.content || {};
    let text = type === "text" ? String(message.text?.content || "").trim() : "";
    const descriptors: MediaDescriptor[] = [];
    if (type === "picture") descriptors.push(mediaDescriptor("image", content.downloadCode || content.pictureDownloadCode, "钉钉图片", "jpg"));
    else if (type === "file") descriptors.push(mediaDescriptor("file", content.downloadCode, String(content.fileName || "钉钉文件")));
    else if (type === "audio") {
      text = String(content.recognition || "").trim();
      descriptors.push(mediaDescriptor("file", content.downloadCode, "钉钉语音", "amr"));
    } else if (type === "video") {
      const extension = safeExtension(String(content.videoType || "mp4"), "mp4");
      descriptors.push(mediaDescriptor("file", content.downloadCode, "钉钉视频", extension));
    } else if (type === "richText") {
      const richText = Array.isArray(content.richText) ? content.richText.slice(0, MAX_INBOUND_ATTACHMENTS + 20) : [];
      text = richText.map((item) => String(item?.text || "").trim()).filter(Boolean).join("\n");
      for (const [index, item] of richText.entries()) {
        if (String(item?.type || "") !== "picture") continue;
        descriptors.push(mediaDescriptor("image", item.downloadCode || item.pictureDownloadCode, `钉钉富文本图片-${index + 1}`, "jpg"));
      }
    }
    const usable = descriptors.filter((item) => item.downloadCode).slice(0, MAX_INBOUND_ATTACHMENTS);
    if (!usable.length) {
      if (descriptors.length) text = [text, `[有 ${descriptors.length} 个钉钉附件未能下载。]`].filter(Boolean).join("\n");
      return { text, attachments: [] };
    }
    const token = String(await client.getAccessToken());
    const attachments: InboundAttachment[] = [];
    let failed = descriptors.length - usable.length;
    for (const [index, descriptor] of usable.entries()) {
      try {
        attachments.push(await this.downloadInboundMedia({
          descriptor,
          token,
          robotCode: String(message.robotCode || ""),
          messageId,
          createdAt: Number(message.createAt || Date.now()),
          index,
        }));
      } catch (error) {
        failed += 1;
        this.logger.error(`[dingtalk] attachment download failed: ${safeErrorMessage(error)}`);
      }
    }
    if (failed) text = [text, `[有 ${failed} 个钉钉附件未能下载。]`].filter(Boolean).join("\n");
    return { text, attachments };
  }

  private async downloadInboundMedia({ descriptor, token, robotCode, messageId, createdAt, index }: {
    descriptor: MediaDescriptor;
    token: string;
    robotCode: string;
    messageId: string;
    createdAt: number;
    index: number;
  }) {
    if (!robotCode || descriptor.downloadCode.length > 8_192) throw connectorError("DINGTALK_MEDIA_REFERENCE_INVALID", "钉钉附件下载凭据无效", 400);
    const response = await this.fetchImpl(MEDIA_DOWNLOAD_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-acs-dingtalk-access-token": token },
      body: JSON.stringify({ downloadCode: descriptor.downloadCode, robotCode }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json().catch(() => ({})) as { downloadUrl?: string; code?: string; message?: string };
    if (!response.ok || !body.downloadUrl) throw connectorError("DINGTALK_MEDIA_DOWNLOAD_URL_FAILED", "钉钉未返回附件下载地址", 502);
    const downloaded = await downloadTrustedMedia(this.fetchImpl, body.downloadUrl, MAX_INBOUND_MEDIA_BYTES);
    const fileName = withDetectedExtension(descriptor.fileName, downloaded.contentType, descriptor.kind, descriptor.fallbackExtension);
    const safeName = sanitizeInboundAttachmentFileName(fileName, descriptor.kind === "image" ? "钉钉图片.jpg" : "钉钉文件");
    const date = new Date(Number.isFinite(createdAt) ? createdAt : Date.now()).toISOString().slice(0, 10);
    const messageDirectory = crypto.createHash("sha256").update(String(messageId)).digest("hex").slice(0, 16);
    const filePath = path.join(this.inboundAttachmentsDir, "dingtalk", date, messageDirectory, `${index + 1}-${safeName}`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(filePath, downloaded.bytes, { mode: 0o600, flag: "wx" });
    const attachment: InboundAttachment = { kind: descriptor.kind, path: filePath, fileName: safeName, sizeBytes: downloaded.bytes.length };
    if (this.registerAttachment) {
      try {
        const relativePath = relativeAttachmentPath(this.inboundAttachmentsDir, filePath);
        const registered = await this.registerAttachment({ filePath, relativePath, contentType: downloaded.contentType, source: "dingtalk" });
        if (!registered.uploaded || !registered.objectId) throw connectorError("DINGTALK_MEDIA_REGISTRATION_FAILED", "钉钉附件未能登记到当前 Space", 500);
        attachment.managedObjectId = registered.objectId;
        attachment.managedObjectKey = registered.objectKey;
      } catch (error) {
        fs.rmSync(filePath, { force: true });
        throw error;
      }
    }
    return attachment;
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

function mediaDescriptor(kind: "image" | "file", downloadCode: unknown, fileName: string, fallbackExtension?: string): MediaDescriptor {
  return { kind, downloadCode: String(downloadCode || "").trim(), fileName, fallbackExtension };
}

async function downloadTrustedMedia(fetchImpl: typeof fetch, value: string, maximumBytes: number) {
  let url = trustedMediaUrl(value);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await fetchImpl(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(30_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirect === 3) throw connectorError("DINGTALK_MEDIA_REDIRECT_REJECTED", "钉钉附件下载重定向无效", 502);
      url = trustedMediaUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok || !response.body) throw connectorError("DINGTALK_MEDIA_DOWNLOAD_FAILED", "钉钉附件下载失败", 502);
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
      throw connectorError("DINGTALK_MEDIA_TOO_LARGE", "钉钉附件超过 50 MB 接收上限", 413);
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      total += chunk.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw connectorError("DINGTALK_MEDIA_TOO_LARGE", "钉钉附件超过 50 MB 接收上限", 413);
      }
      chunks.push(chunk);
    }
    if (!total) throw connectorError("DINGTALK_MEDIA_EMPTY", "钉钉附件内容为空", 502);
    return {
      bytes: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))),
      contentType: String(response.headers.get("content-type") || "application/octet-stream").split(";", 1)[0].trim().toLowerCase(),
    };
  }
  throw connectorError("DINGTALK_MEDIA_REDIRECT_REJECTED", "钉钉附件下载重定向过多", 502);
}

function trustedMediaUrl(value: string) {
  const url = new URL(String(value || ""));
  const hostname = url.hostname.toLowerCase();
  const trusted = hostname === "dingtalk.com"
    || hostname === "aliyuncs.com"
    || hostname === "alicdn.com"
    || hostname === "dingtalkusercontent.com"
    || TRUSTED_MEDIA_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
  if (url.protocol !== "https:" || url.username || url.password || !trusted) {
    throw connectorError("DINGTALK_MEDIA_URL_REJECTED", "钉钉返回了不受信任的附件下载地址", 502);
  }
  return url;
}

function withDetectedExtension(fileName: string, contentType: string, kind: "image" | "file", fallbackExtension = "") {
  const safe = sanitizeInboundAttachmentFileName(fileName, kind === "image" ? "钉钉图片" : "钉钉文件");
  if (path.extname(safe)) return safe;
  const detected = mime.extension(contentType);
  const extension = typeof detected === "string" && /^[a-z0-9]{1,12}$/i.test(detected)
    ? detected
    : safeExtension(fallbackExtension, kind === "image" ? "jpg" : "bin");
  return `${safe}.${extension}`;
}

function safeExtension(value: string, fallback: string) {
  const extension = value.trim().toLowerCase().replace(/^\.+/, "");
  return /^[a-z0-9]{1,12}$/.test(extension) ? extension : fallback;
}

function safeErrorMessage(error: unknown) {
  const code = String((error as { code?: unknown } | null)?.code || "").trim();
  if (/^[A-Z0-9_:-]{1,80}$/.test(code)) return code;
  return error instanceof TypeError ? "DINGTALK_NETWORK_ERROR" : "DINGTALK_MEDIA_OPERATION_FAILED";
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
