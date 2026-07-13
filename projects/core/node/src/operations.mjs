import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const VALID_RISKS = new Set(["R2", "R3"]);
const VALID_APPROVAL_CHANNELS = new Set(["local-tty", "local-console"]);

export function createOperationStore({ dataRoot, now = () => Date.now(), randomUUID = () => crypto.randomUUID(), ttlMs = 10 * 60_000 } = {}) {
  if (!path.isAbsolute(dataRoot || "")) throw operationError("INVALID_ARGUMENT", "Operation data root must be absolute", 2);
  const directory = path.join(dataRoot, "runtime", "operations");
  const auditFile = path.join(dataRoot, "logs", "audit", "operations.ndjson");
  const executions = new Map();

  function plan({ command, risk, inputSummary, target, stateFingerprint = "", idempotencyKey = "" }) {
    if (!VALID_RISKS.has(risk)) throw operationError("INVALID_ARGUMENT", "Only R2 and R3 operations require approval", 2);
    for (const [label, value] of [["command", command], ["inputSummary", inputSummary], ["target", target]]) {
      if (!String(value || "").trim()) throw operationError("INVALID_ARGUMENT", `Missing operation ${label}`, 2);
    }
    const createdAtMs = now();
    const id = `op_${randomUUID()}`;
    const binding = { schemaVersion: 1, id, command, risk, inputSummary, target, stateFingerprint, idempotencyKey };
    const operation = {
      ...binding,
      digest: digest(binding),
      status: "planned",
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(createdAtMs + ttlMs).toISOString(),
    };
    writeOperation(operation);
    audit("planned", operation);
    return publicOperation(operation);
  }

  function approve(id, { digest: suppliedDigest, actor } = {}) {
    const operation = requireOperation(id);
    ensureCurrent(operation);
    ensureDigest(operation, suppliedDigest);
    if (operation.status !== "planned") throw operationError("INVALID_STATE", `Operation cannot be approved from ${operation.status}`, 4);
    if (!validHumanApproval(actor)) throw operationError("APPROVAL_REQUIRED", "R2/R3 approval requires an authenticated local human", 5);
    operation.status = "approved";
    operation.approvedAt = new Date(now()).toISOString();
    operation.approval = { kind: "human", channel: actor.channel };
    writeOperation(operation);
    audit("approved", operation, operation.approval);
    return publicOperation(operation);
  }

  async function execute(id, options = {}) {
    if (executions.has(id)) return executions.get(id);
    const execution = executeOnce(id, options).finally(() => executions.delete(id));
    executions.set(id, execution);
    return execution;
  }

  async function executeOnce(id, { digest: suppliedDigest, actor, handler } = {}) {
    const operation = requireOperation(id);
    ensureDigest(operation, suppliedDigest);
    if (operation.status === "succeeded") return publicOperation(operation);
    ensureCurrent(operation);
    if (operation.status !== "approved") throw operationError("APPROVAL_REQUIRED", "Operation is not approved", 5);
    if (!actor || actor.kind === "extension") throw operationError("EXECUTION_DENIED", "Invalid operation executor", 5);
    if (typeof handler !== "function") throw operationError("CAPABILITY_UNAVAILABLE", "Operation executor is unavailable", 7);
    operation.status = "executing";
    operation.startedAt = new Date(now()).toISOString();
    writeOperation(operation);
    audit("executing", operation, { kind: actor.kind || "unknown" });
    try {
      const result = await handler(publicOperation(operation));
      operation.status = "succeeded";
      operation.completedAt = new Date(now()).toISOString();
      operation.result = sanitizeResult(result);
      writeOperation(operation);
      audit("succeeded", operation);
      return publicOperation(operation);
    } catch (error) {
      operation.status = "failed";
      operation.completedAt = new Date(now()).toISOString();
      operation.error = { code: error?.code || "EXECUTION_FAILED", message: String(error?.message || "Operation failed").slice(0, 300) };
      writeOperation(operation);
      audit("failed", operation, { code: operation.error.code });
      throw operationError(operation.error.code, operation.error.message, 6);
    }
  }

  function inspect(id) { return publicOperation(requireOperation(id)); }

  function list() {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).filter((name) => /^op_[a-zA-Z0-9-]+\.json$/.test(name)).map((name) => publicOperation(readJson(path.join(directory, name)))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  function ensureCurrent(operation) {
    if (Date.parse(operation.expiresAt) <= now()) {
      if (!['succeeded', 'failed', 'expired'].includes(operation.status)) {
        operation.status = "expired";
        writeOperation(operation);
        audit("expired", operation);
      }
      throw operationError("PLAN_EXPIRED", "Operation plan has expired", 4);
    }
  }

  function ensureDigest(operation, suppliedDigest) {
    if (!suppliedDigest || !constantTimeEqual(operation.digest, suppliedDigest)) throw operationError("DIGEST_MISMATCH", "Operation digest does not match the approved plan", 4);
  }

  function requireOperation(id) {
    if (!/^op_[a-zA-Z0-9-]+$/.test(String(id || ""))) throw operationError("INVALID_ARGUMENT", "Invalid operation id", 2);
    const file = path.join(directory, `${id}.json`);
    if (!fs.existsSync(file)) throw operationError("NOT_FOUND", `Unknown operation: ${id}`, 3);
    return readJson(file);
  }

  function writeOperation(operation) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    atomicJson(path.join(directory, `${operation.id}.json`), operation);
  }

  function audit(event, operation, detail = {}) {
    fs.mkdirSync(path.dirname(auditFile), { recursive: true, mode: 0o700 });
    const record = { schemaVersion: 1, at: new Date(now()).toISOString(), event, operationId: operation.id, command: operation.command, risk: operation.risk, target: operation.target, status: operation.status, detail };
    fs.appendFileSync(auditFile, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    try { fs.chmodSync(auditFile, 0o600); } catch {}
  }

  return { plan, approve, execute, inspect, list, directory, auditFile };
}

function validHumanApproval(actor) {
  return actor?.kind === "human" && actor.authenticated === true && actor.loopback === true && VALID_APPROVAL_CHANNELS.has(actor.channel);
}

function publicOperation(operation) {
  return JSON.parse(JSON.stringify(operation));
}

function digest(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sanitizeResult(result) {
  if (result === undefined) return null;
  const text = JSON.stringify(result);
  if (Buffer.byteLength(text) > 16 * 1024) return { truncated: true };
  return redact(JSON.parse(text));
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /token|secret|password|authorization|cookie|credential/i.test(key) ? "[REDACTED]" : redact(item)]));
}

function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  try { fs.renameSync(temporary, file); } finally { fs.rmSync(temporary, { force: true }); }
  try { fs.chmodSync(file, 0o600); } catch {}
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }

export function operationError(code, message, exitCode) {
  return Object.assign(new Error(message), { code, exitCode });
}
