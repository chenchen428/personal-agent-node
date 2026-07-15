import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveNodeConfig } from "./config.ts";
import { createOperationStore, operationError } from "./operations.ts";

const isEntrypoint = ["control-service.mjs", "control-service.ts"].includes(path.basename(process.argv[1] || ""));

export function controlEndpoint(config, platform = process.platform) {
  if (platform === "win32") return `\\\\.\\pipe\\personal-agent-${crypto.createHash("sha256").update(config.dataRoot).digest("hex").slice(0, 16)}`;
  return path.join(config.runtimeDir, "control.sock");
}

export function createControlService({ config = resolveNodeConfig(), now, logger = console } = {}) {
  const endpoint = controlEndpoint(config);
  const operations = createOperationStore({ dataRoot: config.dataRoot, now });
  const approvalChallenges = new Map();
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    socket.setTimeout(10_000, () => socket.destroy());
    let input = "";
    let handled = false;
    socket.on("data", (chunk) => {
      if (handled) return;
      input += chunk;
      if (Buffer.byteLength(input) > 1024 * 1024) { handled = true; socket.end(`${JSON.stringify(errorEnvelope(operationError("REQUEST_TOO_LARGE", "Control request is too large", 2)))}\n`); return; }
      const newline = input.indexOf("\n");
      if (newline < 0) return;
      handled = true;
      const line = input.slice(0, newline);
      input = "";
      let request;
      try { request = JSON.parse(line); } catch { socket.end(`${JSON.stringify(errorEnvelope(operationError("INVALID_REQUEST", "Control request must be valid JSON", 2)))}\n`); return; }
      handleControlRequest(request, { operations, approvalChallenges }).then((response) => socket.end(`${JSON.stringify(response)}\n`)).catch((error) => socket.end(`${JSON.stringify(errorEnvelope(error))}\n`));
    });
  });
  server.on("error", (error) => logger.error?.(`[personal-agent-control] ${error.message}`));
  return {
    server,
    endpoint,
    operations,
    async listen() {
      if (process.platform !== "win32") fs.rmSync(endpoint, { force: true });
      fs.mkdirSync(config.runtimeDir, { recursive: true, mode: 0o700 });
      await new Promise((resolve, reject) => { server.once("error", reject); server.listen(endpoint, resolve); });
      if (process.platform !== "win32") fs.chmodSync(endpoint, 0o600);
      return endpoint;
    },
    async close() {
      if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      if (process.platform !== "win32") fs.rmSync(endpoint, { force: true });
    },
  };
}

export async function handleControlRequest(request, { operations, approvalChallenges = new Map() }) {
  if (request?.schemaVersion !== 1 || typeof request.command !== "string") throw operationError("INVALID_REQUEST", "Invalid control request", 2);
  const args = request.args || {};
  if (request.command === "health") return success("health", { service: "personal-agent-control" });
  if (request.command === "operation.list") return success(request.command, { operations: operations.list() });
  if (request.command === "operation.inspect") return success(request.command, { operation: operations.inspect(args.id) });
  if (request.command === "operation.approval-challenge") {
    const operation = operations.inspect(args.id);
    if (operation.digest !== args.digest || operation.status !== "planned") throw operationError("DIGEST_MISMATCH", "Operation is not an approvable plan", 4);
    const nonce = crypto.randomUUID();
    approvalChallenges.set(nonce, { id: args.id, digest: args.digest, expiresAt: Date.now() + 60_000 });
    return success(request.command, { nonce, prompt: `APPROVE ${args.id} ${args.digest.slice(0, 12)}` });
  }
  if (request.command === "operation.approve") {
    const challenge = approvalChallenges.get(args.nonce);
    approvalChallenges.delete(args.nonce);
    if (!challenge || challenge.expiresAt <= Date.now() || challenge.id !== args.id || challenge.digest !== args.digest || args.confirmation !== `APPROVE ${args.id} ${args.digest.slice(0, 12)}`) throw operationError("APPROVAL_REQUIRED", "A fresh local human confirmation is required", 5);
    const actor = { kind: "human", authenticated: true, loopback: true, channel: "local-tty" };
    return success(request.command, { operation: operations.approve(args.id, { digest: args.digest, actor }) });
  }
  throw operationError("CAPABILITY_UNAVAILABLE", `Control command is unavailable: ${request.command}`, 7);
}

export function requestControl(config, command, args = {}, context = {}, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(controlEndpoint(config));
    const timer = setTimeout(() => socket.destroy(operationError("CONTROL_TIMEOUT", "Control service timed out", 7)), timeoutMs);
    let output = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify({ schemaVersion: 1, command, args, context })}\n`));
    socket.on("data", (chunk) => { output += chunk; });
    socket.on("end", () => {
      clearTimeout(timer);
      try {
        const response = JSON.parse(output.trim());
        if (!response.ok) reject(operationError(response.error?.code || "CONTROL_FAILED", response.error?.message || "Control request failed", response.error?.exitCode || 7));
        else resolve(response);
      } catch (error) { reject(error); }
    });
    socket.on("error", (error) => { clearTimeout(timer); reject(error.code === "ENOENT" || error.code === "ECONNREFUSED" ? operationError("CONTROL_UNAVAILABLE", "Personal Agent control service is unavailable", 7) : error); });
  });
}

function success(command, result) { return { schemaVersion: 1, ok: true, command, result, warnings: [], nextActions: [] }; }
function errorEnvelope(error) { return { schemaVersion: 1, ok: false, error: { code: error.code || "CONTROL_FAILED", message: error.message || "Control request failed", exitCode: Number(error.exitCode || 7) }, nextActions: [] }; }

if (isEntrypoint) {
  const service = createControlService();
  service.listen().then((endpoint) => console.log(`personal-agent-control listening ${endpoint}`));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => service.close().finally(() => process.exit(0)));
}
