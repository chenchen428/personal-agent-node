import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MailConnectionScanner } from "../src/connections/mail/scanner.js";

test("mail connection scans a continuous minute interval and persists its successful cursor", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pa-mail-scanner-"));
  const endMs = Date.parse("2026-07-17T08:01:00.000Z");
  const manifest = {
    sourceId: "connection_local_mail",
    eventType: "mail.received",
    receivedAt: "2026-07-17T08:00:30.000Z",
    dedupeKey: "sha256:one",
  };
  writeManifest(dataDir, manifest);
  const seen = new Set();
  const scanner = new MailConnectionScanner({
    dataDir,
    now: () => endMs,
    processMessage: async (message) => {
      const deduplicated = seen.has(message.dedupeKey);
      seen.add(message.dedupeKey);
      return { deduplicated };
    },
  });

  const first = await scanner.scan();
  assert.deepEqual({ found: first.found, processed: first.processed, deduplicated: first.deduplicated }, { found: 1, processed: 1, deduplicated: 0 });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "scanner", "state.json"), "utf8")).cursorAt, "2026-07-17T08:01:00.000Z");
  assert.equal(scanner.status().details.intervalSeconds, 60);

  const second = await scanner.scan();
  assert.deepEqual({ found: second.found, processed: second.processed, deduplicated: second.deduplicated }, { found: 0, processed: 0, deduplicated: 0 });
});

test("mail connection does not advance its cursor when processing fails", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pa-mail-scanner-failure-"));
  writeManifest(dataDir, { sourceId: "connection_local_mail", eventType: "mail.received", receivedAt: "2026-07-17T08:00:30.000Z", dedupeKey: "sha256:failure" });
  const scanner = new MailConnectionScanner({
    dataDir,
    now: () => Date.parse("2026-07-17T08:01:00.000Z"),
    processMessage: async () => { throw new Error("processing failed"); },
  });
  await assert.rejects(scanner.scan(), /processing failed/);
  assert.equal(fs.existsSync(path.join(dataDir, "scanner", "state.json")), false);
});

function writeManifest(dataDir, value) {
  const dir = path.join(dataDir, "archive", value.receivedAt.slice(0, 10));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${value.dedupeKey.replace(":", "-")}.json`), `${JSON.stringify(value)}\n`);
}
