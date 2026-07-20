import { resolveMx } from "node:dns/promises";

const TEST_EMAIL_ENDPOINT = "https://testemailsender.com/api/tools/test-email/sends";
const TEST_EMAIL_SENDER_DOMAIN = "sendtest.joltmx.com";
const REQUEST_TIMEOUT_MS = 15_000;
const DELIVERY_TIMEOUT_MS = 45_000;
const DELIVERY_POLL_INTERVAL_MS = 1_000;
const TERMINAL_STATUSES = new Set(["Accepted", "Delivered", "Deferred", "Rejected", "Failed"]);
const ACCEPTED_STATUSES = new Set(["Accepted", "Delivered"]);

export class PublicTestMailSender {
  constructor({ fetchImpl = fetch, resolveMxImpl = resolveMx, now = () => Date.now(), sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)) } = {}) {
    this.fetchImpl = fetchImpl;
    this.resolveMxImpl = resolveMxImpl;
    this.now = now;
    this.sleep = sleep;
  }

  async send({ recipient }) {
    const address = normalizeEmail(recipient);
    if (!address) throw senderError("PUBLIC_TEST_MAIL_RECIPIENT_INVALID", "测试邮件收件地址无效。", 400);
    await this.assertMailExchange(address.split("@")[1]);
    let response;
    let payload;
    try {
      response = await this.fetchImpl(TEST_EMAIL_ENDPOINT, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ recipientEmail: address }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      payload = await response.json().catch(() => ({}));
    } catch {
      throw senderError("PUBLIC_TEST_MAIL_UNREACHABLE", "公开测试邮件服务暂时无法访问，请检查网络后重试。", 503);
    }
    if (response.status === 429) throw senderError("PUBLIC_TEST_MAIL_RATE_LIMITED", "该地址今天的公开测试邮件次数已达上限，请稍后再试。", 429);
    if (!response.ok) throw senderError("PUBLIC_TEST_MAIL_REJECTED", "公开测试邮件服务没有接受发送请求，请稍后重试。", 503);
    const requestId = normalizeRequestId(payload.id);
    const token = normalizeToken(payload.token);
    if (!requestId || !token || !["Queued", ...TERMINAL_STATUSES].includes(String(payload.status || ""))) {
      throw senderError("PUBLIC_TEST_MAIL_RESPONSE_INVALID", "公开测试邮件服务返回了无效结果，请稍后重试。", 503);
    }
    const result = TERMINAL_STATUSES.has(payload.status) ? payload : await this.waitForSmtpResult(requestId, token);
    if (result.status === "Deferred") throw senderError("PUBLIC_TEST_MAIL_DEFERRED", "公网发件服务暂未能连接平台邮箱，请检查 MX 和收件服务后重试。", 503);
    if (!ACCEPTED_STATUSES.has(result.status)) throw senderError("PUBLIC_TEST_MAIL_REJECTED", "平台邮箱的公网收件服务器拒绝了测试邮件。", 409);
    return {
      accepted: true,
      provider: "TestEmailSender",
      senderDomain: TEST_EMAIL_SENDER_DOMAIN,
    };
  }

  async assertMailExchange(domain) {
    try {
      const records = await this.resolveMxImpl(domain);
      if (!Array.isArray(records) || !records.some((record) => String(record?.exchange || "").trim() && String(record.exchange).trim() !== ".")) {
        throw senderError("PUBLIC_TEST_MAIL_MX_MISSING", "平台邮箱域名尚未配置 MX，当前无法接收公网邮件。", 409);
      }
    } catch (error) {
      if (error?.code === "PUBLIC_TEST_MAIL_MX_MISSING") throw error;
      if (["ENODATA", "ENOTFOUND"].includes(error?.code)) throw senderError("PUBLIC_TEST_MAIL_MX_MISSING", "平台邮箱域名尚未配置 MX，当前无法接收公网邮件。", 409);
      throw senderError("PUBLIC_TEST_MAIL_DNS_UNREACHABLE", "暂时无法检查平台邮箱的 MX，请检查网络后重试。", 503);
    }
  }

  async waitForSmtpResult(requestId, token) {
    const deadline = this.now() + DELIVERY_TIMEOUT_MS;
    while (this.now() < deadline) {
      await this.sleep(DELIVERY_POLL_INTERVAL_MS);
      let response;
      let payload;
      try {
        response = await this.fetchImpl(`${TEST_EMAIL_ENDPOINT}/${requestId}?token=${encodeURIComponent(token)}`, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        payload = await response.json().catch(() => ({}));
      } catch {
        throw senderError("PUBLIC_TEST_MAIL_UNREACHABLE", "公开测试邮件服务暂时无法访问，请检查网络后重试。", 503);
      }
      if (!response.ok) throw senderError("PUBLIC_TEST_MAIL_STATUS_REJECTED", "无法确认测试邮件的 SMTP 投递结果，请稍后重试。", 503);
      if (TERMINAL_STATUSES.has(payload.status)) return payload;
      if (payload.status !== "Queued") throw senderError("PUBLIC_TEST_MAIL_RESPONSE_INVALID", "公开测试邮件服务返回了无效结果，请稍后重试。", 503);
    }
    throw senderError("PUBLIC_TEST_MAIL_STATUS_TIMEOUT", "公开测试邮件服务未能及时返回 SMTP 投递结果，请稍后重试。", 504);
  }
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function normalizeRequestId(value) {
  const id = String(value || "").trim().toLowerCase();
  return /^[a-f0-9-]{12,80}$/.test(id) ? id : "";
}

function normalizeToken(value) {
  const token = String(value || "").trim();
  return token.length >= 16 && token.length <= 512 && !/\s/.test(token) ? token : "";
}

function senderError(code, message, statusCode) {
  return Object.assign(new Error(message), { code, statusCode });
}
