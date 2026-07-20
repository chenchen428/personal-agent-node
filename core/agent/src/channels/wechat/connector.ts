import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import {
  WeChatTransport,
  DEFAULT_LONG_POLL_TIMEOUT_MS,
  describeWechatTransportError,
  type InboundWechatMessage,
} from "./runtime/wechat-transport.ts";
import {
  BOT_TYPE,
  CONTEXT_CACHE_FILE,
  CREDENTIALS_FILE,
  DEFAULT_BASE_URL,
  SYNC_BUF_FILE,
  ensureChannelDataDir,
} from "./runtime/channel-config.ts";
import {
  getStoredCredentialsInvalidReason,
  loadExistingCredentials,
  type StoredAccount,
} from "./runtime/setup.ts";
import { wechatFetch } from "./runtime/wechat-fetch.ts";
import type { InstallationConnectionOwnership } from "../../connections/connection-ownership.ts";

type Logger = {
  log: (message: string) => void;
  error: (message: string) => void;
};

type LoginSession = {
  id: string;
  qrcode: string;
  qrContent: string;
  baseUrl: string;
  createdAt: number;
  expiresAt: number;
};

type OrchestratorLike = {
  handleChannelMessage: (channelName: string, message: InboundWechatMessage) => Promise<unknown>;
};

const loginSessions = new Map<string, LoginSession>();
const CONNECTOR_LONG_POLL_TIMEOUT_MS = Math.min(DEFAULT_LONG_POLL_TIMEOUT_MS, 15000);
const LOGIN_SESSION_TIMEOUT_MS = 2 * 60 * 1000;
const STARTUP_BACKLOG_GRACE_MS = 2 * 60 * 1000;
const POLL_WATCHDOG_INTERVAL_MS = 30000;
const POLL_RESTART_DELAY_MS = 1000;

export class WeChatConnector {
  readonly transport: WeChatTransport;
  private stopped = true;
  private polling = false;
  private missingCredentialsLogged = false;
  private startedAtMs = Date.now();
  private orchestrator: OrchestratorLike | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private lastPollStartedAt = "";
  private lastPollCompletedAt = "";
  private lastMessageAt = "";
  private lastPollError = "";
  private configurationGeneration = 0;

  constructor(private readonly logger: Logger, private readonly ownership?: { store: InstallationConnectionOwnership; spaceId: string }) {
    this.transport = new WeChatTransport({
      log: (message) => logger.log(`[wechat] ${message}`),
      logError: (message) => logger.error(`[wechat] ${message}`),
    });
  }

  attach(orchestrator: OrchestratorLike) {
    this.orchestrator = orchestrator;
  }

  start() {
    if (this.stopped) {
      this.stopped = false;
      this.startedAtMs = Date.now();
    }
    if (this.hasCredentialOwnership()) this.ensurePollLoop();
    if (!this.watchdogTimer) {
      this.watchdogTimer = setInterval(() => this.ensurePollLoop(), POLL_WATCHDOG_INTERVAL_MS);
      this.watchdogTimer.unref?.();
    }
  }

  stop() {
    this.stopped = true;
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.watchdogTimer = null;
    this.restartTimer = null;
  }

  async status() {
    const account = loadExistingCredentials();
    const ownershipError = account ? this.credentialOwnershipError(account) : null;
    const invalidReason = account
      ? ownershipError || await getStoredCredentialsInvalidReason(account, { timeoutMs: 5000 })
      : "No saved WeChat credentials found.";
    return {
      connected: Boolean(account && !invalidReason),
      loginState: account && !invalidReason ? "connected" : ownershipError ? "space-conflict" : "login-required",
      reason: invalidReason || "",
      credentialsFile: CREDENTIALS_FILE,
      syncFile: SYNC_BUF_FILE,
      contextCacheFile: CONTEXT_CACHE_FILE,
      polling: this.polling,
      pollingEnabled: !this.stopped,
      lastPollStartedAt: this.lastPollStartedAt,
      lastPollCompletedAt: this.lastPollCompletedAt,
      lastMessageAt: this.lastMessageAt,
      lastPollError: this.lastPollError,
      capabilities: {
        inbound: ["text", "image", "file"],
        outbound: ["text", "image", "file"],
      },
      account: account ? {
        accountId: account.accountId,
        userId: account.userId || "",
        baseUrl: account.baseUrl,
        savedAt: account.savedAt,
      } : null,
    };
  }

  catalogStatus() {
    const account = loadExistingCredentials();
    const ownershipError = account ? this.credentialOwnershipError(account) : null;
    const connected = Boolean(account && !ownershipError);
    return {
      connected,
      loginState: connected ? "connected" : ownershipError ? "space-conflict" : "login-required",
      reason: ownershipError || "",
      polling: this.polling,
      pollingEnabled: !this.stopped,
      configured: Boolean(account),
    };
  }

  clearConfiguration() {
    const configured = Boolean(loadExistingCredentials());
    this.configurationGeneration += 1;
    loginSessions.clear();
    this.ownership?.store.release("wechat-claw", this.ownership.spaceId);
    for (const file of [CREDENTIALS_FILE, SYNC_BUF_FILE, CONTEXT_CACHE_FILE]) fs.rmSync(file, { force: true });
    this.missingCredentialsLogged = false;
    this.lastPollStartedAt = "";
    this.lastPollCompletedAt = "";
    this.lastMessageAt = "";
    this.lastPollError = "";
    return { cleared: true, configuredBefore: configured };
  }

  async startLogin() {
    pruneLoginSessions();
    const baseUrl = DEFAULT_BASE_URL;
    const qr = await fetchQRCode(baseUrl);
    const id = crypto.randomUUID();
    const session: LoginSession = {
      id,
      qrcode: qr.qrcode,
      qrContent: qr.qrcode_img_content,
      baseUrl,
      createdAt: Date.now(),
      expiresAt: Date.now() + LOGIN_SESSION_TIMEOUT_MS,
    };
    loginSessions.set(id, session);
    return {
      session: id,
      status: "wait",
      expiresAt: new Date(session.expiresAt).toISOString(),
      qrContent: session.qrContent,
      qrSvg: await QRCode.toString(session.qrContent, {
        type: "svg",
        margin: 1,
        width: 280,
        color: { dark: "#151514", light: "#ffffff" },
      }),
    };
  }

  async pollLoginStatus(sessionId: string) {
    pruneLoginSessions();
    const session = loginSessions.get(sessionId);
    if (!session) return { status: "missing", connected: false };
    const status = await pollQRStatus(session.baseUrl, session.qrcode);
    if (status.status !== "confirmed") {
      return {
        status: status.status === "scaned" ? "scanned" : status.status || "wait",
        connected: false,
        expiresAt: new Date(session.expiresAt).toISOString(),
      };
    }
    if (!status.ilink_bot_id || !status.bot_token) {
      throw new Error("Login failed: missing bot credentials from server.");
    }
    const account: StoredAccount = {
      token: status.bot_token,
      baseUrl: status.baseurl || session.baseUrl,
      accountId: status.ilink_bot_id,
      userId: status.ilink_user_id,
      ...(this.ownership?.spaceId ? { spaceId: this.ownership.spaceId } : {}),
      savedAt: new Date().toISOString(),
    };
    this.ownership?.store.replace("wechat-claw", [account.accountId, account.userId], this.ownership.spaceId);
    saveCredentials(account);
    loginSessions.delete(sessionId);
    return {
      status: "confirmed",
      connected: true,
      account: {
        accountId: account.accountId,
        userId: account.userId || "",
        baseUrl: account.baseUrl,
        savedAt: account.savedAt,
      },
    };
  }

  async sendText(recipientId: string | undefined, text: string) {
    this.requireCredentialOwnership();
    return await this.transport.sendNotification(text, recipientId);
  }

  getDefaultRecipientId() {
    return this.transport.getDefaultRecipientId();
  }

  async sendFile(recipientId: string | undefined, filePath: string, title?: string, caption?: string) {
    this.requireCredentialOwnership();
    if (caption?.trim()) await this.sendText(recipientId, caption.trim());
    return await this.transport.sendFile(filePath, { recipientId, title });
  }

  async sendImage(recipientId: string | undefined, imagePath: string, caption?: string) {
    this.requireCredentialOwnership();
    return await this.transport.sendImage(imagePath, { recipientId, caption });
  }

  private async pollLoop() {
    if (this.polling) return;
    this.polling = true;
    try {
      while (!this.stopped) {
        try {
          this.requireCredentialOwnership();
          const generation = this.configurationGeneration;
          this.lastPollStartedAt = new Date().toISOString();
          const result = await this.transport.pollMessages({
            timeoutMs: CONNECTOR_LONG_POLL_TIMEOUT_MS,
            minCreatedAtMs: this.startedAtMs - STARTUP_BACKLOG_GRACE_MS,
          });
          this.lastPollCompletedAt = new Date().toISOString();
          this.lastPollError = "";
          if (generation !== this.configurationGeneration) continue;
          for (const message of result.messages) {
            this.lastMessageAt = new Date().toISOString();
            await this.orchestrator?.handleChannelMessage("wechat", message);
          }
        } catch (error) {
          const detail = describeWechatTransportError(error);
          this.lastPollError = detail.slice(0, 300);
          if (/No saved WeChat credentials found/i.test(detail)) {
            if (!this.missingCredentialsLogged) {
              this.logger.log("[wechat] waiting for QR login before polling messages.");
              this.missingCredentialsLogged = true;
            }
            await sleep(30000);
          } else {
            this.logger.error(`[wechat] poll failed: ${detail}`);
            await sleep(5000);
          }
        }
      }
    } finally {
      this.polling = false;
    }
  }

  private ensurePollLoop() {
    if (this.stopped || this.polling) return;
    void this.pollLoop().catch((error) => {
      const detail = describeWechatTransportError(error);
      this.lastPollError = detail.slice(0, 300);
      this.logger.error(`[wechat] poll loop exited unexpectedly: ${detail}`);
    }).finally(() => {
      if (this.stopped || this.restartTimer) return;
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        this.ensurePollLoop();
      }, POLL_RESTART_DELAY_MS);
      this.restartTimer.unref?.();
    });
  }

  private hasCredentialOwnership() {
    const account = loadExistingCredentials();
    return !account || !this.credentialOwnershipError(account);
  }

  private requireCredentialOwnership() {
    const account = loadExistingCredentials();
    if (!account) throw Object.assign(new Error("No saved WeChat credentials found."), { code: "WECHAT_LOGIN_REQUIRED", statusCode: 409 });
    const message = this.credentialOwnershipError(account);
    if (message) throw Object.assign(new Error(message), { code: "WECHAT_SPACE_CONFLICT", statusCode: 409 });
  }

  private credentialOwnershipError(account: StoredAccount) {
    try {
      if (account.spaceId && this.ownership?.spaceId && account.spaceId !== this.ownership.spaceId) {
        throw Object.assign(new Error("该微信连接已被另一个隔离空间占用，不能在当前 Space 共同引用"), { code: "WECHAT_SPACE_CONFLICT", statusCode: 409 });
      }
      this.ownership?.store.assertOrClaim("wechat-claw", [account.accountId, account.userId], this.ownership.spaceId);
      if (!account.spaceId && this.ownership?.spaceId) saveCredentials({ ...account, spaceId: this.ownership.spaceId });
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
}

async function fetchQRCode(baseUrl: string): Promise<{ qrcode: string; qrcode_img_content: string }> {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = `${base}ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(BOT_TYPE)}`;
  const res = await wechatFetch(url);
  if (!res.ok) throw new Error(await formatWechatHttpError("QR fetch failed", res));
  const data = await res.json() as { qrcode?: string; qrcode_img_content?: string };
  if (!data.qrcode || !data.qrcode_img_content) {
    throw new Error("QR fetch failed: response did not include qrcode fields.");
  }
  return data as { qrcode: string; qrcode_img_content: string };
}

async function pollQRStatus(baseUrl: string, qrcode: string): Promise<{
  status: "wait" | "scaned" | "confirmed" | "expired";
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
}> {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = `${base}ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35000);
  try {
    const res = await wechatFetch(url, {
      headers: { "iLink-App-ClientVersion": "1" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(await formatWechatHttpError("QR status failed", res));
    return await res.json() as {
      status: "wait" | "scaned" | "confirmed" | "expired";
      bot_token?: string;
      ilink_bot_id?: string;
      baseurl?: string;
      ilink_user_id?: string;
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return { status: "wait" };
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function formatWechatHttpError(prefix: string, res: Response) {
  const text = (await res.text().catch(() => "")).trim();
  const snippet = text.replace(/\s+/g, " ").slice(0, 420);
  if (/不在安全策略默认允许的范围内|not allowed by the default security policy/i.test(text)) {
    return `${prefix}: ${res.status}. 当前网络拦截了微信 iLink 服务，请在云壳防护记录中给 ilinkai.weixin.qq.com 加白，或切换到允许访问该域名的网络。原始响应：${snippet}`;
  }
  return snippet ? `${prefix}: ${res.status}. ${snippet}` : `${prefix}: ${res.status}`;
}

function saveCredentials(account: StoredAccount) {
  ensureChannelDataDir();
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(account, null, 2), "utf8");
  try {
    fs.chmodSync(CREDENTIALS_FILE, 0o600);
  } catch {
    // Best effort.
  }
  for (const staleFile of [SYNC_BUF_FILE, CONTEXT_CACHE_FILE]) {
    fs.rmSync(staleFile, { force: true });
  }
}

function pruneLoginSessions() {
  const now = Date.now();
  for (const [id, session] of loginSessions) {
    if (session.expiresAt <= now) loginSessions.delete(id);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatFetchedMessagesForDebug(messages: InboundWechatMessage[]) {
  return messages.map((message) => ({
    senderId: message.senderId,
    sender: message.sender,
    text: message.text,
    attachments: message.attachments,
    createdAt: message.createdAt,
  }));
}
