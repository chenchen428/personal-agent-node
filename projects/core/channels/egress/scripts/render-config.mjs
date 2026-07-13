#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const siteDataRoot = path.resolve(process.env.PRIVATE_SITE_DATA_ROOT || path.join(os.homedir(), ".personal-agent.local"));
const envPath = path.resolve(args.env || path.join(siteDataRoot, "secrets", "channels", "egress.env"));
const outputPath = path.resolve(args.output || path.join(siteDataRoot, "channels", "egress", "sing-box.json"));
const templatePath = path.join(projectRoot, "config", "sing-box.template.json");

if (!fs.existsSync(envPath)) fail("channel egress secret file is missing", 2);

const values = parseEnv(fs.readFileSync(envPath, "utf8"));
const required = [
  "CHANNEL_EGRESS_SS_SERVER",
  "CHANNEL_EGRESS_SS_PORT",
  "CHANNEL_EGRESS_SS_METHOD",
  "CHANNEL_EGRESS_SS_PASSWORD",
];
const missing = required.filter((key) => !String(values[key] || "").trim());
if (missing.length) fail(`channel egress secret fields are missing: ${missing.join(", ")}`, 2);

const port = Number.parseInt(values.CHANNEL_EGRESS_SS_PORT, 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) fail("CHANNEL_EGRESS_SS_PORT must be between 1 and 65535");

const config = JSON.parse(fs.readFileSync(templatePath, "utf8"));
const outbound = config.outbounds.find((item) => item.tag === "channel-ss-out");
outbound.server = values.CHANNEL_EGRESS_SS_SERVER;
outbound.server_port = port;
outbound.method = values.CHANNEL_EGRESS_SS_METHOD;
outbound.password = values.CHANNEL_EGRESS_SS_PASSWORD;
if (values.CHANNEL_EGRESS_SS_PLUGIN) outbound.plugin = values.CHANNEL_EGRESS_SS_PLUGIN;
if (values.CHANNEL_EGRESS_SS_PLUGIN_OPTS) outbound.plugin_opts = values.CHANNEL_EGRESS_SS_PLUGIN_OPTS;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const temporaryPath = `${outputPath}.${process.pid}.tmp`;
fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
try {
  fs.chmodSync(temporaryPath, 0o600);
  fs.renameSync(temporaryPath, outputPath);
  fs.chmodSync(outputPath, 0o600);
} finally {
  fs.rmSync(temporaryPath, { force: true });
}
process.stdout.write(`${JSON.stringify({ ok: true, output: outputPath })}\n`);

function parseArgs(input) {
  const result = {};
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] === "--env") result.env = input[++index];
    else if (input[index] === "--output") result.output = input[++index];
    else fail(`unknown argument: ${input[index]}`);
  }
  return result;
}

function parseEnv(content) {
  const result = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) fail("invalid channel egress env line");
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[key] = value;
  }
  return result;
}

function fail(message, code = 1) {
  process.stderr.write(`[channel-egress] ${message}\n`);
  process.exit(code);
}
