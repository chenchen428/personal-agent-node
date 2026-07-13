#!/usr/bin/env node
import { runChannelHealthCheck } from "../src/channels/health-check.js";

const dryRun = process.argv.includes("--dry-run");
const result = await runChannelHealthCheck({
  baseUrl: process.env.OPEN_AGENT_BRIDGE_INTERNAL_URL || "http://127.0.0.1:8788",
  apiToken: process.env.OPEN_AGENT_BRIDGE_API_TOKEN || "",
  notify: !dryRun,
});

process.stdout.write(`${JSON.stringify({
  ok: result.ok,
  healthy: result.healthy,
  notified: result.notified,
  channels: result.channels.map(({ provider, state, statusLabel }) => ({ provider, state, statusLabel })),
}, null, 2)}\n`);
