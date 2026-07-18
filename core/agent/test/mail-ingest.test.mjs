import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ingestRawEmail, MAX_MAIL_BYTES, parseHeaders } from "../src/automation/mail-ingest.js";

test("mail ingress archives raw EML and queues a manifest for interval scanning", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-mail-ingest-"));
  const expiredArchive = path.join(dataDir, "archive", "2000-01-01");
  fs.mkdirSync(expiredArchive, { recursive: true });
  fs.writeFileSync(path.join(expiredArchive, "expired.eml"), "expired");
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
  const result = await ingestRawEmail(raw, { dataDir, envelopeRecipient: "bills@personal-agent.local" });

  assert.equal(result.message.title, "月度账单");
  assert.equal(result.message.payload.attachments[0].name, "statement.csv");
  assert.equal(result.message.risk.spamScore, 1.25);
  assert.match(result.message.risk.authenticationResults, /dmarc=pass/);
  assert.equal(fs.existsSync(result.archivePath), true);
  assert.equal(path.relative(dataDir, result.archivePath).split(path.sep)[0], "archive");
  assert.equal(fs.existsSync(path.join(dataDir, "mail")), false);
  assert.equal(fs.existsSync(expiredArchive), false);
  assert.equal(result.queuedForIntervalScan, true);
  assert.equal(fs.existsSync(result.manifestPath), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(result.manifestPath, "utf8")), result.message);
  assert.equal(parseHeaders(raw)["message-id"], "<bill-1@example.com>");
});

test("mail ingress rejects oversized content before archive", async () => {
  await assert.rejects(ingestRawEmail(Buffer.alloc(MAX_MAIL_BYTES + 1), { dataDir: os.tmpdir() }), /email exceeds/);
});
