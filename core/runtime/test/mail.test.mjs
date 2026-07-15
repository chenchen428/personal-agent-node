import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { localMailPlan, localMailStatus } from "../src/mail.ts";
import { renderShim } from "../src/cli-shims.ts";

test("mail status is redacted, local-only, and bounds archive accounting", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-mail-status-"));
  const dataRoot = path.join(root, "data");
  const installRoot = path.join(root, "install");
  const binDir = path.join(root, "bin");
  const mailDir = path.join(dataRoot, "mail");
  const entrypoint = path.join(installRoot, "current", "core", "agent", "bin", "oab-mail-ingest.mjs");
  const shim = path.join(binDir, "open-abg-mail-ingest");
  try {
    fs.mkdirSync(path.dirname(entrypoint), { recursive: true });
    fs.mkdirSync(path.join(mailDir, "archive", "2026-07-14"), { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(entrypoint, "// bundled entrypoint\n");
    fs.writeFileSync(shim, "#!/bin/sh\n");
    for (let index = 0; index < 5; index += 1) {
      fs.writeFileSync(path.join(mailDir, "archive", "2026-07-14", `${index}.eml`), `Subject: ${index}\r\n\r\nbody`);
    }
    const config = {
      dataRoot,
      mailDir,
      domain: "example.site",
      envPath: path.join(dataRoot, "secrets", "applications", "site.env"),
      ports: { bridge: 8788 },
      env: { OPEN_AGENT_BRIDGE_MAIL_INGEST_TOKEN: "configured-but-never-returned" },
    };
    const canonicalEntrypoint = path.join(fs.realpathSync(installRoot), "current", "core", "agent", "bin", "oab-mail-ingest.mjs");
    fs.writeFileSync(shim, renderShim({
      platform: "linux",
      entrypoint: canonicalEntrypoint,
      envPath: config.envPath,
      environment: {
        PRIVATE_SITE_DATA_ROOT: dataRoot,
        OPEN_AGENT_BRIDGE_MAIL_DATA_DIR: mailDir,
        OPEN_AGENT_BRIDGE_API_BASE: "http://127.0.0.1:8788",
      },
    }));
    const status = localMailStatus(config, { platform: "linux", installRoot, binDir, env: { PATH: binDir }, archiveScanLimit: 3 });
    assert.equal(status.smtpServerBundled, false);
    assert.equal(status.ingress.ready, true);
    assert.equal(status.ingress.followsCurrent, true);
    assert.equal(status.archive.scanned, true);
    assert.equal(status.archive.truncated, true);
    assert.equal(status.archive.scanLimit, 3);
    assert.ok(status.archive.messages <= 3);
    assert.deepEqual(status.suggestedRecipients, ["agent@example.site", "bills@example.site"]);
    assert.deepEqual(status.policy, {
      mtaUserManaged: true,
      recipientAllowlistOwner: "user-managed-mta",
      smtpServerBundled: false,
      managedRawMailTunnelBundled: false,
    });
    assert.doesNotMatch(JSON.stringify(status), /configured-but-never-returned/);

    const doctorStatus = localMailStatus(config, { platform: "linux", installRoot, binDir, env: { PATH: binDir }, scanArchive: false });
    assert.deepEqual(doctorStatus.archive, { scanned: false, truncated: false, messages: null, bytes: null });
    fs.writeFileSync(shim, "#!/bin/sh\nexit 0\n");
    const stale = localMailStatus(config, { platform: "linux", installRoot, binDir, env: { PATH: binDir }, scanArchive: false });
    assert.equal(stale.ingress.ready, false);
    assert.equal(stale.ingress.followsCurrent, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("mail plan is non-mutating and excludes bundled or managed mail protocols", () => {
  const plan = localMailPlan({ domain: "example.site" });
  assert.equal(plan.mutates, false);
  assert.equal(plan.previewOnly, true);
  assert.equal(plan.smtpServerBundled, false);
  assert.equal(plan.delivery.command, "open-abg-mail-ingest");
  assert.deepEqual(plan.suggestedRecipients, ["agent@example.site", "bills@example.site"]);
  assert.equal("acceptedRecipients" in plan, false);
  assert.match(plan.boundaries.join("\n"), /SMTP and IMAP require protocol-aware transport/);
  assert.match(plan.boundaries.join("\n"), /Public TCP port 25 is not opened by default/);
});
