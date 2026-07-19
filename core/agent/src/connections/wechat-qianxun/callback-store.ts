import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isPlainObject } from "./protocol.ts";

const MAX_EVENT_FILE_BYTES = 5 * 1024 * 1024;
const MAX_EVENT_BYTES = 64 * 1024;

export type QianxunCallback = {
  type: string;
  accountWxid: string;
  port?: number;
  outerEvent?: number;
  data: unknown;
};

export function parseQianxunCallback(body: unknown): QianxunCallback | null {
  if (!isPlainObject(body)) return null;
  const nested = isPlainObject(body.data) && typeof body.data.type === "string" ? body.data : body;
  if (typeof nested.type !== "string" || !nested.type.trim()) return null;
  const accountWxid = firstString(nested.wxid, body.wxid);
  return {
    type: nested.type.trim(),
    accountWxid,
    port: firstFiniteNumber(nested.port, body.port),
    outerEvent: firstFiniteNumber(body.event),
    data: nested.data,
  };
}

export class QianxunCallbackStore {
  readonly filePath: string;
  private readonly eventKeys = new Set<string>();

  constructor(dataRoot: string) {
    this.filePath = path.join(dataRoot, "connections", "wechat", "qianxun", "events.ndjson");
    for (const file of [`${this.filePath}.1`, this.filePath]) {
      if (!fs.existsSync(file)) continue;
      for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean)) {
        try {
          const key = JSON.parse(line)?.eventKey;
          if (typeof key === "string") this.eventKeys.add(key);
        } catch {}
      }
    }
  }

  append(callback: QianxunCallback) {
    const record = normalizeEvent(callback);
    const line = `${JSON.stringify(record)}\n`;
    if (Buffer.byteLength(line) > MAX_EVENT_BYTES) throw Object.assign(new Error("Qianxun callback is too large after normalization"), { statusCode: 413 });
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    this.rotateIfNeeded(Buffer.byteLength(line));
    fs.appendFileSync(this.filePath, line, { encoding: "utf8", mode: 0o600 });
    this.eventKeys.add(record.eventKey);
    try { fs.chmodSync(this.filePath, 0o600); } catch {}
    return record;
  }

  appendUnique(callback: QianxunCallback) {
    const record = normalizeEvent(callback);
    const duplicate = this.eventKeys.has(record.eventKey) ? this.findByEventKey(record.eventKey) : null;
    if (duplicate) return { record: duplicate, duplicate: true };
    const line = `${JSON.stringify(record)}\n`;
    if (Buffer.byteLength(line) > MAX_EVENT_BYTES) throw Object.assign(new Error("Qianxun callback is too large after normalization"), { statusCode: 413 });
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    this.rotateIfNeeded(Buffer.byteLength(line));
    fs.appendFileSync(this.filePath, line, { encoding: "utf8", mode: 0o600 });
    this.eventKeys.add(record.eventKey);
    try { fs.chmodSync(this.filePath, 0o600); } catch {}
    return { record, duplicate: false };
  }

  private findByEventKey(eventKey: string) {
    for (const file of [this.filePath, `${this.filePath}.1`]) {
      if (!fs.existsSync(file)) continue;
      for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).reverse()) {
        try {
          const record = JSON.parse(line);
          if (record?.eventKey === eventKey) return record;
        } catch {}
      }
    }
    return null;
  }

  list(limit = 50) {
    const bounded = Math.min(Math.max(Number(limit) || 50, 1), 200);
    return this.listAll().slice(-bounded).reverse();
  }

  listAll(): Record<string, unknown>[] {
    const files = [`${this.filePath}.1`, this.filePath].filter((file) => fs.existsSync(file));
    return files.flatMap((file) => fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try {
        const record = JSON.parse(line);
        return record && typeof record === "object" && !Array.isArray(record) ? [record as Record<string, unknown>] : [];
      } catch { return []; }
    }));
  }

  private rotateIfNeeded(incomingBytes: number) {
    let currentBytes = 0;
    try { currentBytes = fs.statSync(this.filePath).size; } catch {}
    if (currentBytes + incomingBytes <= MAX_EVENT_FILE_BYTES) return;
    const rotated = `${this.filePath}.1`;
    try { fs.rmSync(rotated, { force: true }); } catch {}
    fs.renameSync(this.filePath, rotated);
  }
}

function normalizeEvent(callback: QianxunCallback) {
  const data = isPlainObject(callback.data) ? callback.data : {};
  const message = ["recvMsg", "D0003"].includes(callback.type) ? {
    timeStamp: boundedString(data.timeStamp, 32),
    fromType: finiteNumber(data.fromType),
    msgType: finiteNumber(data.msgType),
    msgSource: finiteNumber(data.msgSource),
    fromWxid: boundedString(data.fromWxid, 160),
    finalFromWxid: boundedString(data.finalFromWxid, 160),
    toWxid: boundedString(data.toWxid, 160),
    atWxidList: Array.isArray(data.atWxidList) ? data.atWxidList.slice(0, 100).map((value) => boundedString(value, 160)).filter(Boolean) : [],
    signature: boundedString(data.signature, 300),
    msg: boundedString(data.msg, 16 * 1024),
  } : null;
  return {
    schemaVersion: 1,
    id: `qxe_${randomUUID()}`,
    eventKey: eventKey(callback, message),
    receivedAt: new Date().toISOString(),
    type: callback.type,
    accountWxid: callback.accountWxid,
    ...(callback.port ? { port: callback.port } : {}),
    ...(callback.outerEvent ? { outerEvent: callback.outerEvent } : {}),
    ...(message ? { message } : { data: boundedObject(data) }),
  };
}

function eventKey(callback: QianxunCallback, message: Record<string, unknown> | null) {
  const stable = message?.signature
    ? `${callback.accountWxid}:${callback.type}:${message.signature}`
    : JSON.stringify({ accountWxid: callback.accountWxid, type: callback.type, message, data: callback.data });
  return `qxc_${createHash("sha256").update(stable).digest("hex").slice(0, 32)}`;
}

function boundedObject(value: Record<string, unknown>) {
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    if (typeof item === "string") output[key] = boundedString(item, 2_000);
    else if (typeof item === "number" || typeof item === "boolean" || item === null) output[key] = item;
  }
  return output;
}

function boundedString(value: unknown, max: number) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function finiteNumber(value: unknown) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function firstFiniteNumber(...values: unknown[]) {
  for (const value of values) if (Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function firstString(...values: unknown[]) {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return "";
}
