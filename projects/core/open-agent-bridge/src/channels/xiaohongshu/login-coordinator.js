import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChannelInputError } from "./channel.js";
import { VerificationCapabilityUnavailableError } from "./verification-client.js";

const DEFAULT_POLL_INTERVAL_MS = 3_000;

export class XiaohongshuLoginCoordinator {
  constructor({
    channel,
    wechat,
    logger = console,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    wait = delay,
  } = {}) {
    this.channel = channel;
    this.wechat = wechat;
    this.logger = logger;
    this.pollIntervalMs = pollIntervalMs;
    this.wait = wait;
    this.activeSessions = new Map();
    this.activeByRecipient = new Map();
    this.stopped = false;
  }

  async start({ recipientId } = {}) {
    const recipient = String(recipientId || this.wechat.getDefaultRecipientId?.() || "").trim();
    if (!recipient) throw new ChannelInputError("没有可用的微信接收人，请先从微信与 Agent 对话。" );
    if (this.activeSessions.size) throw new ChannelInputError("已有小红书登录协作正在进行，请等待它结束后再重试。" );

    const login = await this.channel.startLogin();
    if (login.status === "confirmed") {
      return { ...withoutQr(login), delivered: false, monitoring: false };
    }

    const active = {
      session: login.session,
      recipient,
      expiresAt: Date.parse(login.expiresAt),
      submittingCode: false,
      stopped: false,
      notifiedStates: new Set(),
    };
    this.activeSessions.set(active.session, active);
    this.activeByRecipient.set(recipient, active);

    try {
      await this.sendQr(active, login.qrImage);
    } catch (error) {
      this.finish(active);
      throw error;
    }

    void this.monitor(active).catch(async (error) => {
      this.finish(active);
      this.logger.error?.(`[xiaohongshu] login monitor failed: ${safeError(error)}`);
      await this.wechat.sendText(
        active.recipient,
        "小红书登录监听异常终止。请打开渠道状态页确认当前状态后再重试。\nhttps://agent.personal-agent.local/agent-channels",
      ).catch(() => {});
    });
    return { ...withoutQr(login), delivered: true, monitoring: true };
  }

  async consumeWechatMessage(message) {
    const recipient = String(message?.senderId || "").trim();
    const active = this.activeByRecipient.get(recipient);
    if (!active || active.stopped) return false;
    const code = extractVerificationCode(message?.text);
    if (!code) return false;

    if (active.submittingCode) {
      await this.wechat.sendText(recipient, "验证码正在提交，请稍候，Agent 会继续监听登录结果。" );
      return true;
    }

    active.submittingCode = true;
    try {
      await this.channel.submitVerificationCode(active.session, code);
      await this.wechat.sendText(recipient, "验证码已提交到当前小红书登录窗口，Agent 正在继续监听结果。" );
    } catch (error) {
      if (error instanceof VerificationCapabilityUnavailableError) {
        await this.wechat.sendText(
          recipient,
          "验证码已收到，但当前小红书运行时尚不支持代填，未能完成本次登录。需要先升级渠道运行时后重新扫码。",
        );
        this.finish(active);
      } else {
        await this.wechat.sendText(recipient, "验证码提交失败。当前登录会话仍在监听，如收到新的验证码可再次回复。" );
        this.logger.error?.(`[xiaohongshu] verification submission failed: ${safeErrorName(error)}`);
      }
    } finally {
      active.submittingCode = false;
    }
    return true;
  }

  async monitor(active) {
    while (!this.stopped && !active.stopped) {
      await this.wait(this.pollIntervalMs);
      if (this.stopped || active.stopped) return;
      const result = await this.channel.pollLogin(active.session);
      if (result.status === "pending") continue;
      if (result.status === "scanned" || result.status === "verification_required") {
        await this.notifyProgress(active, result.status);
        continue;
      }
      if (result.status === "confirmed") {
        await this.wechat.sendText(
          active.recipient,
          "小红书登录成功，服务器会话已更新。\n渠道状态：https://agent.personal-agent.local/agent-channels",
        );
      } else {
        await this.wechat.sendText(active.recipient, terminalMessage(result.status));
      }
      this.finish(active);
      return;
    }
  }

  stop() {
    this.stopped = true;
    for (const active of this.activeSessions.values()) active.stopped = true;
    this.activeSessions.clear();
    this.activeByRecipient.clear();
  }

  async sendQr(active, dataImage) {
    const image = decodeDataImage(dataImage);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "open-abg-channel-login-"));
    const imagePath = path.join(tempDir, `qrcode.${image.extension}`);
    try {
      fs.writeFileSync(imagePath, image.buffer, { mode: 0o600 });
      await this.wechat.sendImage(
        active.recipient,
        imagePath,
        "小红书登录二维码。请使用小红书 App 扫码，并在 App 内点击“确认登录”。Agent 会自动监听结果，无需回复“已完成”；如果手机收到短信验证码，请直接在微信回复验证码。",
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  async notifyProgress(active, status) {
    if (active.notifiedStates.has(status)) return;
    active.notifiedStates.add(status);
    if (status === "scanned") {
      await this.wechat.sendText(active.recipient, "已检测到扫码。请回到小红书 App 点击“确认登录”，Agent 会继续监听服务器浏览器。");
      return;
    }
    await this.wechat.sendText(
      active.recipient,
      "服务器登录页面正在等待短信验证码。收到后请直接在微信回复纯数字验证码，Agent 会一次性代填并继续监听。",
    );
  }

  finish(active) {
    active.stopped = true;
    this.activeSessions.delete(active.session);
    if (this.activeByRecipient.get(active.recipient) === active) this.activeByRecipient.delete(active.recipient);
  }
}

export function extractVerificationCode(value) {
  const match = /^\s*(?:验证码\s*[:：]?\s*)?(\d{4,8})\s*$/.exec(String(value || ""));
  return match?.[1] || "";
}

function withoutQr(login) {
  const { qrImage: _qrImage, ...safe } = login;
  return safe;
}

function decodeDataImage(value) {
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(String(value || ""));
  if (!match) throw new ChannelInputError("小红书登录未返回有效二维码。" );
  const buffer = Buffer.from(match[2].replace(/[\r\n]/g, ""), "base64");
  if (!buffer.length || buffer.length > 4 * 1024 * 1024) throw new ChannelInputError("小红书二维码大小无效。" );
  return { buffer, extension: match[1] === "jpeg" || match[1] === "jpg" ? "jpg" : match[1] };
}

function terminalMessage(status) {
  if (status === "expired" || status === "missing") {
    return "小红书登录二维码已过期，本次监听已结束。需要重试时请重新发起登录协作。";
  }
  return "小红书登录检测失败，本次监听已结束。请打开渠道状态页查看当前状态后再重试。\nhttps://agent.personal-agent.local/agent-channels";
}

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 240);
}

function safeErrorName(error) {
  const name = error instanceof Error ? error.name : typeof error;
  return String(name || "Error").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "Error";
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
