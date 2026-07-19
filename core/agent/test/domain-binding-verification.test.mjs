import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ingestRawEmail } from "../src/connections/mail/mail-ingest.js";
import { DomainBindingVerification, DOMAIN_BINDING_TIMEOUT_MS } from "../src/connections/domain-binding-verification.js";
import { MailConnectionScanner } from "../src/connections/mail/scanner.js";

test("Site binding publishes the editorial Node introduction and commits only after the public marker is read back", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pa-domain-site-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  let uploaded = null;
  let requested = "";
  const verifier = fixture({
    dataRoot,
    publishPage: async (input) => { uploaded = input; return { url: "/public/uploads/domain-verification/index.html" }; },
    fetchImpl: async (url) => { requested = String(url); return new Response(uploaded.content, { status: 200 }); },
  });
  const started = verifier.start("sites");
  assert.equal(started.phase, "verifying");
  assert.equal(verifier.isVerified("sites"), false);
  await verifier.running.get("sites");
  const result = verifier.status("sites");
  assert.equal(result.phase, "verified");
  assert.equal(result.steps.every((step) => step.status === "passed"), true);
  assert.equal(result.evidence.label, "查看验证发布");
  assert.equal(requested, "https://owner.personal-agent.cn/public/uploads/domain-verification/index.html");
  assert.match(uploaded.content, /你的 Node，已经有了自己的公开入口/);
  assert.match(uploaded.content, /为什么会看到这张验证发布/);
  assert.match(uploaded.content, /适合出现在这些时刻/);
  assert.equal(uploaded.title, "Personal Agent Node · 公网入口已就绪");
  assert.match(uploaded.summary, /公网发布链路/);
  assert.equal(uploaded.desktopThumbnail.fileName, "page-thumbnail-desktop.png");
  assert.equal(uploaded.mobileThumbnail.fileName, "page-thumbnail-mobile.png");
  assert.notEqual(uploaded.desktopThumbnail.content, uploaded.mobileThumbnail.content);
  assert.doesNotMatch(uploaded.content, />pa-domain-[a-f0-9]{24}</);
  assert.equal(verifier.isVerified("sites"), true);
});

test("mail binding sends a unique test message and links directly to the received desktop message", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pa-domain-mail-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  let delivery = null;
  let scans = 0;
  const events = [];
  const verifier = fixture({
    dataRoot,
    sendVerificationMail: async (input) => { delivery = input; return { accepted: true, senderDomain: "sendtest.joltmx.com" }; },
    scanMail: async () => {
      scans += 1;
      if (scans === 2) events.push({ id: "mail-event-42", title: "Your test email from JoltMx", sender: { address: "test@sendtest.joltmx.com" }, receivedAt: new Date().toISOString(), payload: { recipients: [delivery.recipient] } });
    },
    listMailEvents: () => events,
  });
  verifier.start("mail");
  await verifier.running.get("mail");
  const result = verifier.status("mail");
  assert.equal(delivery.recipient, "agent@owner.personal-agent.cn");
  assert.match(delivery.marker, /^pa-domain-[a-f0-9]{24}$/);
  assert.equal(result.phase, "verified");
  assert.equal(result.evidence.label, "查看测试收到的邮件");
  assert.equal(result.evidence.url, "/app/mail?message=mail-event-42");
});

test("mail binding recognizes a real archived message through the production scanner", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pa-domain-mail-ingress-"));
  const mailRoot = path.join(dataRoot, "mail-ingress");
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const events = [];
  let scanner;
  const verifier = fixture({
    dataRoot,
    sendVerificationMail: async ({ recipient }) => {
      const raw = [
        "From: Test EmailSender <test@sendtest.joltmx.com>",
        `To: ${recipient}`,
        "Subject: JoltMx test email (ref 019f7498da77)",
        "Message-ID: <public-test-019f7498da77@sendtest.joltmx.com>",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "This fixed message checks whether your mailbox can receive email.",
      ].join("\r\n");
      await ingestRawEmail(raw, { dataDir: mailRoot, envelopeRecipient: recipient, envelopeSender: "test@sendtest.joltmx.com" });
      return { accepted: true, senderDomain: "sendtest.joltmx.com" };
    },
    scanMail: () => scanner.scan(),
    listMailEvents: () => events,
  });
  scanner = new MailConnectionScanner({
    dataDir: mailRoot,
    now: () => Date.now() + 1_000,
    processMessage: async (message) => { events.push({ id: "archived-public-test", ...message }); return { deduplicated: false }; },
  });
  verifier.start("mail");
  await verifier.running.get("mail");
  const result = verifier.status("mail");
  assert.equal(result.phase, "verified");
  assert.equal(result.evidence.url, "/app/mail?message=archived-public-test");
  assert.equal(events.length, 1);
});

test("verification expires without committing binding when content evidence never arrives", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pa-domain-timeout-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  let current = new Date("2026-07-18T08:00:00.000Z");
  const verifier = fixture({
    dataRoot,
    now: () => new Date(current),
    sleep: async () => { current = new Date(current.getTime() + DOMAIN_BINDING_TIMEOUT_MS); },
    sendVerificationMail: async () => ({ accepted: true, senderDomain: "sendtest.joltmx.com" }),
  });
  verifier.start("mail");
  await verifier.running.get("mail");
  const result = verifier.status("mail");
  assert.equal(result.phase, "failed");
  assert.equal(result.error.code, "VERIFICATION_TIMEOUT");
  assert.equal(verifier.isVerified("mail"), false);
});

test("a verified result is invalidated when Cloud assigns a different resource", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pa-domain-resource-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  let domain = "owner.personal-agent.cn";
  const verifier = fixture({ dataRoot, services: () => services(domain) });
  verifier.start("sites");
  await verifier.running.get("sites");
  assert.equal(verifier.isVerified("sites"), true);
  domain = "renamed.personal-agent.cn";
  assert.equal(verifier.status("sites").phase, "idle");
  assert.equal(verifier.isVerified("sites"), false);
});

test("custom Site binding uses the three-step SOP and verifies the final custom HTTPS origin", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pa-custom-domain-site-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  let requested = "";
  let publication = null;
  const verifier = fixture({
    dataRoot,
    customBindings: () => ({ sites: { domain: "agent.example.net", phase: "dns", serviceReady: true } }),
    publishPage: async (input) => { publication = input; return { url: "/public/uploads/domain-verification/index.html" }; },
    fetchImpl: async (url) => { requested = String(url); return new Response(publication.content, { status: 200 }); },
  });
  const started = verifier.start("sites", { binding: "custom" });
  assert.equal(started.binding, "custom");
  assert.deepEqual(started.steps.map((step) => step.label), ["启动转发服务", "配置自定义域名", "验证并生效"]);
  await verifier.running.get("sites");
  assert.equal(verifier.status("sites", "custom").phase, "verified");
  assert.equal(requested, "https://agent.example.net/public/uploads/domain-verification/index.html");
  assert.equal(verifier.status("sites", "platform").phase, "idle");
});

test("custom mail binding sends to agent at the custom domain and requires real local receipt", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pa-custom-domain-mail-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  let delivery;
  const events = [];
  const verifier = fixture({
    dataRoot,
    customBindings: () => ({ mail: { domain: "mail.example.net", phase: "dns", serviceReady: true } }),
    sendVerificationMail: async (input) => { delivery = input; events.push({ id: "custom-mail", sender: { address: "test@sendtest.joltmx.com" }, receivedAt: new Date().toISOString(), payload: { recipients: [input.recipient] } }); return { accepted: true, senderDomain: "sendtest.joltmx.com" }; },
    listMailEvents: () => events,
  });
  verifier.start("mail", { binding: "custom" });
  await verifier.running.get("mail");
  assert.equal(delivery.recipient, "agent@mail.example.net");
  const result = verifier.status("mail", "custom");
  assert.equal(result.phase, "verified");
  assert.equal(result.steps.length, 3);
});

function fixture(overrides = {}) {
  let publishedContent = "";
  return new DomainBindingVerification({
    dataRoot: overrides.dataRoot,
    services: overrides.services || (() => services("owner.personal-agent.cn")),
    externalAccess: () => ({ ready: true, origin: "https://owner.personal-agent.cn" }),
    publishPage: overrides.publishPage || (async (input) => { publishedContent = input.content; return { url: "/public/uploads/domain-verification/index.html", input }; }),
    sendVerificationMail: overrides.sendVerificationMail || (async () => ({ accepted: true, senderDomain: "sendtest.joltmx.com" })),
    scanMail: overrides.scanMail || (async () => ({})),
    listMailEvents: overrides.listMailEvents || (() => []),
    customBindings: overrides.customBindings || (() => ({})),
    fetchImpl: overrides.fetchImpl || (async () => new Response(publishedContent, { status: 200 })),
    now: overrides.now,
    sleep: overrides.sleep || (async () => {}),
  });
}

function services(domain) {
  return { publicDomain: { ready: true, value: domain }, agentMail: { ready: true, value: `agent@${domain}` } };
}
