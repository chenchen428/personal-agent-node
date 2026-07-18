import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createVerificationSitePublication } from "./verification-site-publication.js";

export const DOMAIN_BINDING_TIMEOUT_MS = 3 * 60_000;
const POLL_INTERVAL_MS = 2_500;
const KINDS = new Set(["mail", "sites"]);

export class DomainBindingVerification {
  constructor({
    dataRoot,
    services,
    externalAccess,
    publishPage,
    sendVerificationMail,
    scanMail,
    listMailEvents,
    fetchImpl = fetch,
    now = () => new Date(),
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    logger = console,
  } = {}) {
    this.statePath = path.join(path.resolve(dataRoot || process.cwd()), "runtime", "domain-binding-verification.json");
    this.services = services;
    this.externalAccess = externalAccess;
    this.publishPage = publishPage;
    this.sendVerificationMail = sendVerificationMail;
    this.scanMail = scanMail;
    this.listMailEvents = listMailEvents;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.sleep = sleep;
    this.logger = logger;
    this.running = new Map();
  }

  status(kind) {
    assertKind(kind);
    const document = this.readDocument();
    const state = document[kind] || idleState(kind);
    const resource = this.resource(kind);
    if (state.phase === "verified" && state.resource !== resource) return idleState(kind);
    if (state.phase === "verifying" && Date.parse(state.deadlineAt) <= this.now().getTime()) {
      return this.fail(kind, state, "验证已超过 3 分钟，请检查链路后重新绑定。", "VERIFICATION_TIMEOUT");
    }
    return publicState(state);
  }

  isVerified(kind) {
    const state = this.status(kind);
    return state.phase === "verified" && Boolean(state.resource) && state.resource === this.resource(kind);
  }

  acceptsMail(message) {
    const state = this.readDocument().mail;
    return state?.phase === "verifying" && this.beforeDeadline(state) && mailMatches(message, state);
  }

  start(kind, { deadlineAt } = {}) {
    assertKind(kind);
    const resource = this.resource(kind);
    if (!resource) throw domainError("DOMAIN_RESOURCE_MISSING", kind === "mail" ? "平台收件地址尚未分配" : "平台域名尚未分配", 409);
    const now = this.now();
    const requestedDeadline = Date.parse(String(deadlineAt || ""));
    const maximumDeadline = now.getTime() + DOMAIN_BINDING_TIMEOUT_MS;
    const deadlineMs = Number.isFinite(requestedDeadline) ? Math.min(requestedDeadline, maximumDeadline) : maximumDeadline;
    if (deadlineMs <= now.getTime()) throw domainError("VERIFICATION_TIMEOUT", "绑定验证已超过 3 分钟，请重新发起。", 408);
    const current = this.readDocument()[kind];
    if (current?.phase === "verified" && current.resource === resource) return publicState(current);
    if (current?.phase === "verifying" && current.resource === resource && Date.parse(current.deadlineAt) > now.getTime()) {
      this.run(kind, current);
      return publicState(current);
    }
    const marker = `pa-domain-${crypto.randomBytes(12).toString("hex")}`;
    const state = {
      schemaVersion: 1,
      kind,
      phase: "verifying",
      resource,
      marker,
      startedAt: now.toISOString(),
      deadlineAt: new Date(deadlineMs).toISOString(),
      updatedAt: now.toISOString(),
      error: null,
      evidence: null,
      steps: stepDefinitions(kind).map((step, index) => ({ ...step, status: index < 2 ? "passed" : index === 2 ? "active" : "pending" })),
    };
    this.writeState(kind, state);
    this.run(kind, state);
    return publicState(state);
  }

  resume() {
    const document = this.readDocument();
    for (const kind of KINDS) {
      const state = document[kind];
      if (state?.phase === "verifying" && Date.parse(state.deadlineAt) > this.now().getTime() && state.resource === this.resource(kind)) this.run(kind, state);
    }
  }

  reset() {
    this.writeDocument({ schemaVersion: 1, mail: idleState("mail"), sites: idleState("sites") });
  }

  run(kind, state) {
    if (this.running.has(kind)) return this.running.get(kind);
    const task = (kind === "sites" ? this.runSite(state) : this.runMail(state))
      .catch((error) => {
        const latest = this.readDocument()[kind] || state;
        if (latest.marker !== state.marker) return;
        this.fail(kind, latest, safeError(error), error?.code || "VERIFICATION_FAILED");
      })
      .finally(() => this.running.delete(kind));
    this.running.set(kind, task);
    return task;
  }

  async runSite(state) {
    let latest = this.step("sites", state, 2, "active", "正在按 Page 标准发布验证内容与双端缩略图");
    const publication = await createVerificationSitePublication({ marker: state.marker, domain: state.resource });
    const asset = await this.publishPage(publication);
    latest = this.step("sites", latest, 2, "passed", "验证 Page 与双端缩略图已发布");
    latest = this.step("sites", latest, 3, "active", "正在通过公网域名请求发布页");
    while (this.beforeDeadline(latest)) {
      const access = this.externalAccess();
      if (access?.ready && access.origin) {
        const publicUrl = new URL(asset.url, `${access.origin}/`).toString();
        try {
          const response = await this.fetchImpl(publicUrl, { headers: { accept: "text/html" }, signal: AbortSignal.timeout(10_000) });
          const content = await response.text();
          if (response.ok && content.includes(state.marker)) {
            latest = this.step("sites", latest, 3, "passed", "公网返回 200，页面标记一致");
            return this.complete("sites", latest, { kind: "site", url: publicUrl, label: "查看验证发布" });
          }
        } catch {}
      }
      await this.sleep(POLL_INTERVAL_MS);
      latest = this.readDocument().sites || latest;
    }
    throw domainError("VERIFICATION_TIMEOUT", "3 分钟内未能通过公网域名读取验证发布。", 408);
  }

  async runMail(state) {
    let latest = this.step("mail", state, 2, "active", "正在从公开测试发件地址发送验证邮件");
    const delivery = await this.sendVerificationMail({ recipient: state.resource, marker: state.marker, deadlineAt: state.deadlineAt });
    if (delivery?.accepted !== true) throw domainError("VERIFICATION_MAIL_REJECTED", "平台没有接受验证邮件发送请求，请稍后重试。", 503);
    const expectedSenderDomain = normalizeDomain(delivery.senderDomain);
    if (!expectedSenderDomain) throw domainError("VERIFICATION_MAIL_EVIDENCE_INVALID", "公开测试邮件服务没有返回有效的验证证据，请稍后重试。", 503);
    latest = { ...latest, expectedSenderDomain, updatedAt: this.now().toISOString() };
    this.writeState("mail", latest);
    latest = this.step("mail", latest, 2, "passed", "验证邮件已发送");
    latest = this.step("mail", latest, 3, "active", "正在等待本机收件归档");
    while (this.beforeDeadline(latest)) {
      await this.scanMail();
      const event = this.listMailEvents().find((item) => mailMatches(item, latest));
      if (event) {
        latest = this.step("mail", latest, 3, "passed", "本机已收到验证邮件");
        return this.complete("mail", latest, { kind: "mail", url: `/app/mail?message=${encodeURIComponent(event.id)}`, messageId: String(event.id), label: "查看测试收到的邮件" });
      }
      await this.sleep(POLL_INTERVAL_MS);
      latest = this.readDocument().mail || latest;
    }
    throw domainError("VERIFICATION_TIMEOUT", "3 分钟内本机没有收到验证邮件，邮箱内容链路未打通。", 408);
  }

  resource(kind) {
    const current = this.services();
    return kind === "mail" ? String(current?.agentMail?.value || "") : String(current?.publicDomain?.value || "");
  }

  beforeDeadline(state) {
    return state.phase === "verifying" && this.now().getTime() < Date.parse(state.deadlineAt);
  }

  step(kind, state, index, status, detail) {
    const steps = state.steps.map((step, position) => position === index ? { ...step, status, detail } : step);
    const next = { ...state, steps, updatedAt: this.now().toISOString() };
    this.writeState(kind, next);
    return next;
  }

  complete(kind, state, evidence) {
    const steps = state.steps.map((step) => ({ ...step, status: "passed" }));
    const next = { ...state, phase: "verified", steps, evidence, error: null, verifiedAt: this.now().toISOString(), updatedAt: this.now().toISOString() };
    this.writeState(kind, next);
    return publicState(next);
  }

  fail(kind, state, message, code) {
    if (state.phase === "failed" && state.error?.code === code) return publicState(state);
    const steps = state.steps.map((step) => step.status === "active" ? { ...step, status: "failed", detail: message } : step);
    const next = { ...state, phase: "failed", steps, error: { code, message }, updatedAt: this.now().toISOString() };
    this.writeState(kind, next);
    return publicState(next);
  }

  readDocument() {
    try {
      const value = JSON.parse(fs.readFileSync(this.statePath, "utf8"));
      return value?.schemaVersion === 1 ? value : { schemaVersion: 1 };
    } catch { return { schemaVersion: 1 }; }
  }

  writeState(kind, state) {
    this.writeDocument({ ...this.readDocument(), schemaVersion: 1, [kind]: state });
  }

  writeDocument(document) {
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.statePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, this.statePath);
  }
}

function stepDefinitions(kind) {
  return (kind === "mail"
    ? [["authorize", "确认平台授权"], ["allocate", "分配收件地址"], ["send", "发送验证邮件"], ["receive", "等待本机收件"], ["commit", "提交绑定状态"]]
    : [["authorize", "确认平台授权"], ["allocate", "分配域名与穿透"], ["publish", "发布验证 Page"], ["request", "请求公网链接"], ["commit", "提交绑定状态"]])
    .map(([id, label]) => ({ id, label, detail: "" }));
}

function idleState(kind) {
  return { schemaVersion: 1, kind, phase: "idle", resource: "", startedAt: null, deadlineAt: null, updatedAt: null, error: null, evidence: null, steps: stepDefinitions(kind).map((step) => ({ ...step, status: "pending" })) };
}

function publicState(state) {
  const { marker: _marker, expectedSenderDomain: _expectedSenderDomain, ...safe } = state;
  return safe;
}

function mailMatches(event, state) {
  const sender = normalizeEmail(event?.sender?.address);
  const senderDomain = sender.split("@")[1] || "";
  const recipients = Array.isArray(event?.payload?.recipients) ? event.payload.recipients.map((value) => String(value).toLowerCase()) : [];
  const receivedAt = Date.parse(String(event?.receivedAt || ""));
  const startedAt = Date.parse(String(state.startedAt || ""));
  return Boolean(state.expectedSenderDomain)
    && senderDomain === state.expectedSenderDomain
    && Number.isFinite(receivedAt) && Number.isFinite(startedAt) && receivedAt >= startedAt - 5_000
    && recipients.includes(String(state.resource).toLowerCase());
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function normalizeDomain(value) {
  const domain = String(value || "").trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9.-]{1,251}[a-z0-9])$/.test(domain) && domain.includes(".") ? domain : "";
}

function assertKind(kind) {
  if (!KINDS.has(kind)) throw domainError("DOMAIN_KIND_INVALID", "仅支持邮箱和 Site 域名验证", 400);
}

function domainError(code, message, statusCode) {
  return Object.assign(new Error(message), { code, statusCode });
}

function safeError(error) {
  return String(error?.message || error || "绑定验证失败，请检查连接后重试。").slice(0, 500);
}
