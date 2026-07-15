import fs from "node:fs";
import path from "node:path";

import { mailIngestCliStatus } from "./cli-shims.ts";

const DEFAULT_ARCHIVE_SCAN_LIMIT = 10_000;

export function localMailStatus(config, options = {}) {
  const archive = options.scanArchive === false
    ? { scanned: false, truncated: false, messages: null, bytes: null }
    : archiveSummary(path.join(config.mailDir, "archive"), options.archiveScanLimit);
  const shim = mailIngestCliStatus(config, options);
  const tokenConfigured = Boolean(String(config.env.OPEN_AGENT_BRIDGE_MAIL_INGEST_TOKEN || "").trim());
  return {
    mode: "local-mta-pipe",
    smtpServerBundled: false,
    dataLocation: "PRIVATE_SITE_DATA_ROOT/mail",
    suggestedRecipients: defaultMailRecipients(config.domain),
    ingress: {
      ready: tokenConfigured && shim.ready,
      tokenConfigured,
      shimReady: shim.ready,
      followsCurrent: shim.followsCurrent,
      command: "open-abg-mail-ingest",
    },
    archive,
    web: { path: "/app/mail", transport: "https" },
    policy: {
      mtaUserManaged: true,
      recipientAllowlistOwner: "user-managed-mta",
      smtpServerBundled: false,
      managedRawMailTunnelBundled: false,
    },
  };
}

export function localMailPlan(config) {
  return {
    mode: "local-mta-pipe",
    mutates: false,
    previewOnly: true,
    smtpServerBundled: false,
    suggestedRecipients: defaultMailRecipients(config.domain),
    delivery: {
      command: "open-abg-mail-ingest",
      input: "message/rfc822 on stdin",
      envelopeArguments: ["--recipient", "<envelope-recipient>", "--sender", "<envelope-sender>"],
      successExitCode: 0,
      temporaryFailureExitCode: 75,
    },
    boundaries: [
      "A user-managed local MTA owns SMTP, queueing, retries, TLS, SPF, DKIM, DMARC, and recipient allowlists.",
      "Personal Agent owns local EML archival, automation events, authenticated /app/mail display, backup, and retention.",
      "HTTPS tunnels can expose /app/mail; SMTP and IMAP require protocol-aware transport and cannot use a URL path.",
      "Public TCP port 25 is not opened by default.",
    ],
    nextActions: [
      "Review workflows/local-mail.md and the non-secret Postfix pipe example.",
      "Configure the local MTA to strip and regenerate Authentication-Results before delivery.",
      "Run personal-agent mail status --json after the MTA pipe is configured.",
    ],
  };
}

export function defaultMailRecipients(domain) {
  return [`agent@${domain}`, `bills@${domain}`];
}

function archiveSummary(archiveRoot, requestedLimit) {
  const scanLimit = boundedPositiveInteger(requestedLimit, DEFAULT_ARCHIVE_SCAN_LIMIT);
  if (!fs.existsSync(archiveRoot)) return { scanned: true, truncated: false, scanLimit, messages: 0, bytes: 0 };
  let messages = 0;
  let bytes = 0;
  let visited = 0;
  let truncated = false;
  const pending = [archiveRoot];
  while (pending.length && !truncated) {
    const directory = pending.pop();
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (visited >= scanLimit) {
        truncated = true;
        break;
      }
      visited += 1;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile() && entry.name.endsWith(".eml")) {
        messages += 1;
        try { bytes += fs.statSync(target).size; } catch {}
      }
    }
  }
  return { scanned: true, truncated, scanLimit, messages, bytes };
}

function boundedPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, DEFAULT_ARCHIVE_SCAN_LIMIT) : fallback;
}
