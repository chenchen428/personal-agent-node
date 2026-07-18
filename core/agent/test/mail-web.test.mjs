import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { ingestRawEmail } from "../src/automation/mail-ingest.js";
import { parseMailForDisplay, readMailAttachment } from "../src/automation/mail-reader.js";
import { renderMailPage } from "../src/web/mail-page.js";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const workspaceRoot = path.resolve(projectRoot, "..", "..");

test("mail reader produces safe text and downloadable attachment metadata", async () => {
  const raw = Buffer.from([
    "From: Example Bank <bill@example.com>",
    "To: bills@personal-agent.local",
    "Subject: =?UTF-8?B?5LiD5pyI6LSm5Y2V?=",
    "Date: Fri, 11 Jul 2026 09:30:00 +0800",
    "Message-ID: <statement-7@example.com>",
    "MIME-Version: 1.0",
    "Content-Type: multipart/mixed; boundary=mail-boundary",
    "",
    "--mail-boundary",
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from("<p>本月消费 <strong>128.50</strong> 元</p><script>alert(1)</script>").toString("base64"),
    "--mail-boundary",
    "Content-Type: text/csv; name=statement.csv",
    "Content-Disposition: attachment; filename=statement.csv",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from("date,amount\n2026-07-01,128.50\n").toString("base64"),
    "--mail-boundary--",
  ].join("\r\n"));

  const mail = await parseMailForDisplay(raw);
  assert.equal(mail.subject, "七月账单");
  assert.equal(mail.from[0].address, "bill@example.com");
  assert.match(mail.body, /本月消费 128\.50 元/);
  assert.doesNotMatch(mail.body, /script|alert/);
  assert.deepEqual(mail.attachments.map((item) => item.name), ["statement.csv"]);

  const attachment = await readMailAttachment(raw, 0);
  assert.equal(attachment.contentType, "text/csv");
  assert.match(attachment.content.toString("utf8"), /2026-07-01,128\.50/);
});

test("mail page renders a responsive read-only inbox without executing message HTML", () => {
  const event = {
    id: "event-1",
    sourceId: "src_mail_agent",
    title: "<script>alert(1)</script>",
    sender: { displayName: "Example Bank", address: "bill@example.com" },
    payload: { recipients: ["bills@personal-agent.local"], textPreview: "安全预览", attachments: [{ name: "bill.csv" }] },
    receivedAt: "2026-07-11T01:30:00.000Z",
    matched: true,
  };
  const html = renderMailPage({
    events: [event],
    total: 1,
    selectedEvent: event,
    selectedRuns: [{ matched: true, reason: "包含月度消费汇总", status: "matched" }],
    content: {
      subject: event.title,
      from: [{ name: "Example Bank", address: "bill@example.com" }],
      to: [{ address: "bills@personal-agent.local" }],
      body: "账单正文",
      attachments: [{ index: 0, name: "bill.csv", contentType: "text/csv", sizeBytes: 128 }],
    },
  });
  assert.match(html, /class="mail-workspace"/);
  assert.match(html, /个人认证/);
  assert.match(html, /Agent 已关注/);
  assert.match(html, /\/message\/event-1\/attachments\/0/);
  assert.match(html, /@media\(max-width:760px\)/);
  assert.match(html, /mail-has-selection \.mail-list-pane\{display:none\}/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("mail is registered as a protected fixed path", () => {
  const routes = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "registry", "routes.json"), "utf8"));
  const app = routes.routes.find((entry) => entry.pattern === "/app/*");
  assert.equal(app.access, "authenticated");
  assert.equal(app.capability, "console");
  const capabilities = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "registry", "capabilities.json"), "utf8"));
  assert.equal(capabilities.capabilities.find((entry) => entry.id === "mail").owner, "personal-agent-node");
});

test("mail web requires authentication and serves message, raw EML, and attachments", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-mail-web-server-"));
  const mailDir = path.join(dataDir, "mail-ingress");
  const appRoot = path.join(dataDir, "apps", "installed", "personal-agent.daily-brief");
  fs.mkdirSync(path.join(appRoot, "dist"), { recursive: true });
  fs.writeFileSync(path.join(appRoot, "personal-agent.app.json"), `${JSON.stringify({
    apiVersion: "personal-agent/app-v1",
    id: "personal-agent.daily-brief",
    name: "Daily Brief",
    entry: "dist/index.html",
    requires: { nodeApi: "1" },
  })}\n`);
  fs.writeFileSync(path.join(appRoot, "dist", "index.html"), "<!doctype html><title>Daily Brief</title>");
  const agentDataDir = path.join(dataDir, "data");
  fs.mkdirSync(agentDataDir, { recursive: true });
  const agentData = new DatabaseSync(path.join(agentDataDir, "agent-data.sqlite"));
  agentData.exec("CREATE TABLE shared_expenses (category TEXT, amount INTEGER); INSERT INTO shared_expenses VALUES ('travel', 680)");
  agentData.close();
  const port = await availablePort();
  let output = "";
  const child = spawn(process.execPath, [path.join(workspaceRoot, "node_modules", "tsx", "dist", "cli.mjs"), "src/server/server.ts"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      OPEN_AGENT_BRIDGE_HOST: "127.0.0.1",
      OPEN_AGENT_BRIDGE_PORT: String(port),
      OPEN_AGENT_BRIDGE_DATA_DIR: dataDir,
      OPEN_AGENT_BRIDGE_MAIL_DATA_DIR: mailDir,
      PRIVATE_SITE_DATA_ROOT: dataDir,
      WECHAT_INBOUND_ATTACHMENTS_DIR: path.join(dataDir, "inbound"),
      OPEN_AGENT_BRIDGE_API_TOKEN: "mail-web-api-token",
      OPEN_AGENT_BRIDGE_MAIL_INGEST_TOKEN: "mail-web-ingest-token",
      PERSONAL_AGENT_AUTH_PASSWORD: "mail-web-password",
      PERSONAL_AGENT_AUTH_COOKIE_SECRET: "mail-web-cookie-secret-with-enough-length",
      OPEN_AGENT_BRIDGE_CHANNEL_POLL: "0",
      OPEN_AGENT_BRIDGE_SCHEDULER: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  await waitForServer(port, child, () => output);

  const raw = Buffer.from([
    "From: Example Bank <bill@example.com>",
    "To: bills@personal-agent.local",
    "Subject: Authenticated statement",
    "Message-ID: <mail-web-server@example.com>",
    "MIME-Version: 1.0",
    "Content-Type: multipart/mixed; boundary=web-test",
    "",
    "--web-test",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Authenticated mail body",
    "--web-test",
    "Content-Type: text/plain; name=receipt.txt",
    "Content-Disposition: attachment; filename=receipt.txt",
    "",
    "attachment body",
    "--web-test--",
  ].join("\r\n"));
  const ingested = await ingestRawEmail(raw, {
    dataDir: mailDir,
    apiBase: `http://127.0.0.1:${port}`,
    apiToken: "mail-web-ingest-token",
    envelopeRecipient: "bills@personal-agent.local",
  });
  const headers = { authorization: "Bearer mail-web-api-token" };
  const scan = await fetch(`http://127.0.0.1:${port}/api/connections/mail/scan`, { method: "POST", headers });
  assert.equal(scan.status, 200);
  const scannedMailbox = await fetch(`http://127.0.0.1:${port}/api/mail/messages`, { headers });
  const scannedMailboxPayload = await scannedMailbox.json();
  ingested.event = scannedMailboxPayload.events.find((event) => event.title === "Authenticated statement");
  assert.ok(ingested.event?.id);

  const unauthorized = await fetch(`http://127.0.0.1:${port}/mail`, {
    headers: { accept: "text/html" },
    redirect: "manual",
  });
  assert.equal(unauthorized.status, 302);
  assert.match(unauthorized.headers.get("location") || "", /^\/login\?return_to=/);

  const login = await fetch(`http://127.0.0.1:${port}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password: "mail-web-password", return_to: "/mail" }),
  });
  assert.equal(login.status, 303);
  const sessionCookie = (login.headers.get("set-cookie") || "").split(";", 1)[0];
  const cookiePage = await fetch(`http://127.0.0.1:${port}/mail`, {
    headers: { cookie: sessionCookie },
  });
  assert.equal(cookiePage.status, 200);
  assert.match(await cookiePage.text(), /Authenticated statement/);

  const page = await fetch(`http://127.0.0.1:${port}/mail?message=${encodeURIComponent(ingested.event.id)}`, { headers });
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(page.headers.get("cache-control") || "", /private, no-store/);
  assert.match(html, /Authenticated statement/);
  assert.match(html, /Authenticated mail body/);
  assert.match(html, /receipt\.txt/);
  assert.doesNotMatch(html, new RegExp(escapeRegExp(ingested.archivePath)));

  const apiView = await fetch(`http://127.0.0.1:${port}/api/mail/messages?message=${encodeURIComponent(ingested.event.id)}`, { headers });
  const apiPayload = await apiView.json();
  assert.equal(apiView.status, 200);
  assert.equal(apiPayload.ok, true);
  assert.equal(apiPayload.selectedEvent.id, ingested.event.id);
  assert.equal(apiPayload.content.subject, "Authenticated statement");
  assert.doesNotMatch(JSON.stringify(apiPayload), new RegExp(escapeRegExp(ingested.archivePath)));

  const unauthorizedNodeApi = await fetch(`http://127.0.0.1:${port}/api/node/v1/capabilities`);
  assert.equal(unauthorizedNodeApi.status, 401);
  assert.deepEqual((await unauthorizedNodeApi.json()).error.code, "AUTHENTICATION_REQUIRED");

  const nodeCapabilities = await fetch(`http://127.0.0.1:${port}/api/node/v1/capabilities`, { headers });
  const nodeCapabilitiesPayload = await nodeCapabilities.json();
  assert.equal(nodeCapabilitiesPayload.schemaVersion, 1);
  assert.equal(nodeCapabilitiesPayload.ok, true);
  assert.deepEqual(nodeCapabilitiesPayload.result.supportedMajors, ["1"]);
  assert.equal(nodeCapabilitiesPayload.result.capabilities.data.rawSql, false);
  assert.equal(nodeCapabilitiesPayload.result.capabilities.apps.history.append, true);

  const nodeMail = await fetch(`http://127.0.0.1:${port}/api/node/v1/mail/messages/${encodeURIComponent(ingested.event.id)}`, { headers });
  const nodeMailPayload = await nodeMail.json();
  assert.equal(nodeMailPayload.schemaVersion, 1);
  assert.equal(nodeMailPayload.result.message.id, ingested.event.id);
  assert.equal(nodeMailPayload.result.content.subject, "Authenticated statement");

  const nodeData = await fetch(`http://127.0.0.1:${port}/api/node/v1/data/schema`, { headers });
  const nodeDataPayload = await nodeData.json();
  assert.equal(nodeDataPayload.schemaVersion, 1);
  assert.equal(nodeDataPayload.result.objects[0].name, "shared_expenses");

  const nodeDataQuery = await fetch(`http://127.0.0.1:${port}/api/node/v1/data/query`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ object: "shared_expenses", page: { number: 1, size: 3 } }),
  });
  const nodeDataQueryPayload = await nodeDataQuery.json();
  assert.equal(nodeDataQueryPayload.result.rows[0].category, "travel");
  assert.equal(nodeDataQueryPayload.result.rows[0].amount, 680);

  const historyHeaders = { ...headers, "x-personal-agent-app-id": "personal-agent.daily-brief" };
  const appendHistory = await fetch(`http://127.0.0.1:${port}/api/node/v1/apps/personal-agent.daily-brief/history`, {
    method: "POST",
    headers: { ...historyHeaders, "content-type": "application/json" },
    body: JSON.stringify({ kind: "refresh", title: "Refresh brief", summary: "Shared data was read.", sources: ["data"] }),
  });
  assert.equal(appendHistory.status, 201);
  assert.match((await appendHistory.json()).result.history.id, /^apphist_/);
  const listHistory = await fetch(`http://127.0.0.1:${port}/api/node/v1/apps/personal-agent.daily-brief/history`, { headers: historyHeaders });
  const listHistoryPayload = await listHistory.json();
  assert.equal(listHistoryPayload.result.total, 1);
  assert.equal(listHistoryPayload.result.items[0].sources[0], "data");
  const legacyActivity = await fetch(`http://127.0.0.1:${port}/api/node/v1/apps/personal-agent.daily-brief/activity?limit=8`, { headers: historyHeaders });
  const legacyActivityPayload = await legacyActivity.json();
  assert.equal(legacyActivity.status, 200);
  assert.equal(legacyActivityPayload.result.total, 1);
  const mismatchedHistory = await fetch(`http://127.0.0.1:${port}/api/node/v1/apps/personal-agent.daily-brief/history`, {
    headers: { ...headers, "x-personal-agent-app-id": "example.other" },
  });
  assert.equal(mismatchedHistory.status, 403);
  assert.equal((await mismatchedHistory.json()).error.code, "APP_IDENTITY_REQUIRED");

  const nodePages = await fetch(`http://127.0.0.1:${port}/api/node/v1/pages`, { headers });
  const nodePagesPayload = await nodePages.json();
  assert.equal(nodePagesPayload.schemaVersion, 1);
  assert.ok(Array.isArray(nodePagesPayload.result.assets));

  const missingNodeApi = await fetch(`http://127.0.0.1:${port}/api/node/v1/unknown`, { headers });
  assert.equal(missingNodeApi.status, 404);
  assert.equal((await missingNodeApi.json()).error.code, "NOT_FOUND");

  const importedRaw = Buffer.from([
    "From: Local Tester <tester@example.com>",
    "To: agent@personal-agent.local",
    "Subject: Imported from setup guide",
    "Message-ID: <mail-import-api@example.com>",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "This message validates the self-service EML import.",
  ].join("\r\n"));
  const imported = await fetch(`http://127.0.0.1:${port}/api/mail/import`, {
    method: "POST",
    headers: { ...headers, "content-type": "message/rfc822" },
    body: importedRaw,
  });
  const importedPayload = await imported.json();
  assert.equal(imported.status, 201);
  assert.equal(importedPayload.ok, true);
  assert.equal(importedPayload.eventId, "");

  const importedScan = await fetch(`http://127.0.0.1:${port}/api/connections/mail/scan`, { method: "POST", headers });
  assert.equal(importedScan.status, 200);
  const importedMessages = await fetch(`http://127.0.0.1:${port}/api/mail/messages`, { headers });
  const importedMessagesPayload = await importedMessages.json();
  const importedEvent = importedMessagesPayload.events.find((event) => event.title === "Imported from setup guide");
  assert.match(importedEvent.id, /^aevt_/);

  const importedView = await fetch(`http://127.0.0.1:${port}/api/mail/messages?message=${encodeURIComponent(importedEvent.id)}`, { headers });
  const importedViewPayload = await importedView.json();
  assert.equal(importedViewPayload.content.subject, "Imported from setup guide");

  const original = await fetch(`http://127.0.0.1:${port}/mail/messages/${encodeURIComponent(ingested.event.id)}/raw`, { headers });
  assert.equal(original.status, 200);
  assert.equal(original.headers.get("content-type"), "message/rfc822");
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), raw);

  const attachment = await fetch(`http://127.0.0.1:${port}/mail/messages/${encodeURIComponent(ingested.event.id)}/attachments/0`, { headers });
  assert.equal(attachment.status, 200);
  assert.match(attachment.headers.get("content-disposition") || "", /receipt\.txt/);
  assert.match(await attachment.text(), /attachment body/);
});

async function availablePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(port, child, getOutput) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`mail web server exited early: ${getOutput()}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      // Retry while the isolated server starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`mail web server did not start: ${getOutput()}`);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
