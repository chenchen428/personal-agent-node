import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ingestRawEmail, parseHeaders } from "../src/automation/mail-ingest.js";

test("mail ingress archives raw EML and submits one generic automation event", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-mail-ingest-"));
  const expiredArchive = path.join(dataDir, "mail", "archive", "2000-01-01");
  fs.mkdirSync(expiredArchive, { recursive: true });
  fs.writeFileSync(path.join(expiredArchive, "expired.eml"), "expired");
  const requests = [];
  const raw = Buffer.from([
    "From: Example Bank <bill@example.com>",
    "To: bills@personal-agent.local",
    "Subject: =?UTF-8?B?5pyI5bqm6LSm5Y2V?=",
    "Message-ID: <bill-1@example.com>",
    "Authentication-Results: mail.example; dmarc=pass; spf=pass; dkim=pass",
    "X-Rspamd-Score: 1.25 / 15.00",
    "Content-Type: multipart/mixed; boundary=test",
    "",
    "--test",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "本月消费记录",
    "--test",
    "Content-Disposition: attachment; filename=statement.csv",
    "",
    "date,amount",
    "--test--",
  ].join("\r\n"));
  const result = await ingestRawEmail(raw, {
    dataDir,
    envelopeRecipient: "bills@personal-agent.local",
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ ok: true, event: { id: "event-1" }, runs: [] }), { status: 200 });
    },
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.title, "月度账单");
  assert.equal(requests[0].body.payload.attachments[0].name, "statement.csv");
  assert.equal(requests[0].body.risk.spamScore, 1.25);
  assert.match(requests[0].body.risk.authenticationResults, /dmarc=pass/);
  assert.equal(fs.existsSync(result.archivePath), true);
  assert.equal(fs.existsSync(expiredArchive), false);
  assert.equal(result.event.id, "event-1");
  assert.equal(parseHeaders(raw)["message-id"], "<bill-1@example.com>");
});
