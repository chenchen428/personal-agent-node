import crypto from "node:crypto";
import fs from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

export const SELF_HOSTED_RELAY_PROTOCOL = "pa-reverse-ws-v1";
const MAX_FRAME_BYTES = 128 * 1024;
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const MAX_STREAMS = 128;
const HOP_HEADERS = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);

export type SelfHostedRelayConfig = {
  schemaVersion: 1;
  domain: string;
  siteId: string;
  tokenSha256: string;
  listenHost: string;
  listenPort: number;
  generation: number;
  heartbeatSeconds: number;
};

type RelayStream = {
  id: string;
  kind: "http" | "websocket";
  request: IncomingMessage;
  response?: ServerResponse;
  browser?: WebSocket;
  requestSeq: number;
  responseSeq: number;
  bytesIn: number;
  bytesOut: number;
  responseStarted: boolean;
  ended: boolean;
  timeout?: NodeJS.Timeout;
};

export function loadSelfHostedRelayConfig(filePath = process.env.PERSONAL_AGENT_RELAY_CONFIG || "/etc/personal-agent-relay/config.json"): SelfHostedRelayConfig {
  const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const domain = String(value.domain || "").trim().toLowerCase();
  const siteId = String(value.siteId || "").trim();
  const tokenSha256 = String(value.tokenSha256 || "").trim().toLowerCase();
  const listenHost = String(value.listenHost || "127.0.0.1").trim();
  const listenPort = boundedInteger(value.listenPort ?? 8090, 1, 65535, "listenPort");
  const generation = boundedInteger(value.generation ?? 1, 1, Number.MAX_SAFE_INTEGER, "generation");
  const heartbeatSeconds = boundedInteger(value.heartbeatSeconds ?? 20, 5, 120, "heartbeatSeconds");
  if (value.schemaVersion !== 1 || !/^[a-z0-9.-]{4,253}$/.test(domain) || !/^[A-Za-z0-9_-]{6,128}$/.test(siteId)) throw new Error("Invalid self-hosted Relay identity");
  if (!/^[a-f0-9]{64}$/.test(tokenSha256)) throw new Error("Invalid self-hosted Relay token digest");
  if (!new Set(["127.0.0.1", "::1"]).has(listenHost)) throw new Error("Self-hosted Relay must listen on loopback");
  return { schemaVersion: 1, domain, siteId, tokenSha256, listenHost, listenPort, generation, heartbeatSeconds };
}

export function createSelfHostedRelay({ config, logger = console }: { config: SelfHostedRelayConfig; logger?: Pick<Console, "log" | "error"> }) {
  let node: WebSocket | null = null;
  let nodeReady = false;
  let lastPongAt = 0;
  let heartbeat: NodeJS.Timeout | null = null;
  const streams = new Map<string, RelayStream>();
  const nodeWss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES * 2 + 16 * 1024, perMessageDeflate: false });
  const browserWss = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY_BYTES, perMessageDeflate: false });
  const server = http.createServer((request, response) => handleHttp(request, response));

  server.on("upgrade", (request, socket, head) => {
    const url = safeUrl(request, config.domain);
    if (!url) return rejectUpgrade(socket, 400);
    if (url.pathname === "/v1/connect" && !url.search) {
      if (!connectorHostAllowed(request, config.domain)) return rejectUpgrade(socket, 400);
      if (!validProtocol(request) || !validToken(request, config.tokenSha256)) return rejectUpgrade(socket, 401);
      return nodeWss.handleUpgrade(request, socket, head, (peer) => acceptNode(peer));
    }
    const spaceRoute = spaceRouteForRequest(request, config.domain);
    if (spaceRoute === null) return rejectUpgrade(socket, 400);
    if (!nodeReady || !node || node.readyState !== WebSocket.OPEN) return rejectUpgrade(socket, 503);
    browserWss.handleUpgrade(request, socket, head, (peer) => openWebSocketStream(request, peer, spaceRoute));
  });

  function handleHttp(request: IncomingMessage, response: ServerResponse) {
    const url = safeUrl(request, config.domain);
    if (!url) return sendText(response, 400, "Bad Request\n");
    if (url.pathname === "/__personal_agent_relay/health") {
      return sendJson(response, 200, { ok: true, domain: config.domain, siteId: config.siteId, connected: nodeReady, protocol: SELF_HOSTED_RELAY_PROTOCOL });
    }
    if (url.pathname === "/v1/connect") return sendText(response, 426, "WebSocket Upgrade Required\n", { upgrade: "websocket" });
    const spaceRoute = spaceRouteForRequest(request, config.domain);
    if (spaceRoute === null) return sendText(response, 400, "Bad Request\n");
    if (!nodeReady || !node || node.readyState !== WebSocket.OPEN) return sendText(response, 503, "Personal Agent Node is offline\n");
    if (streams.size >= MAX_STREAMS) return sendText(response, 503, "Relay stream limit reached\n");
    const stream = createStream("http", request, { response });
    sendNode({ v: 1, type: "request.start", id: stream.id, kind: "http", method: request.method || "GET", path: request.url || "/", headers: requestHeaders(request, spaceRoute) });
    request.on("data", (chunk: Buffer) => {
      if (stream.ended) return;
      stream.bytesIn += chunk.length;
      if (stream.bytesIn > MAX_BODY_BYTES) return failStream(stream, 413, "Request too large");
      sendChunks(stream, "request.data", chunk);
    });
    request.on("end", () => { if (!stream.ended) sendNode({ v: 1, type: "request.end", id: stream.id }); });
    request.on("aborted", () => cancelStream(stream, "client_disconnected"));
    request.on("error", () => cancelStream(stream, "client_error"));
  }

  function openWebSocketStream(request: IncomingMessage, browser: WebSocket, spaceRoute: string) {
    const stream = createStream("websocket", request, { browser });
    sendNode({ v: 1, type: "request.start", id: stream.id, kind: "websocket", method: "GET", path: request.url || "/", headers: requestHeaders(request, spaceRoute) });
    browser.on("message", (data, isBinary) => {
      if (stream.ended) return;
      const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      stream.bytesIn += bytes.length;
      if (stream.bytesIn > MAX_BODY_BYTES) return cancelStream(stream, "request_too_large");
      sendChunks(stream, "request.data", bytes, { opcode: isBinary ? "binary" : "text" });
    });
    browser.on("close", (code) => {
      if (stream.ended) return;
      sendNode({ v: 1, type: "request.data", id: stream.id, seq: stream.requestSeq++, data: "", opcode: "close", closeCode: safeCloseCode(code) });
      sendNode({ v: 1, type: "request.end", id: stream.id });
      finishStream(stream);
    });
    browser.on("error", () => cancelStream(stream, "client_error"));
  }

  function acceptNode(peer: WebSocket) {
    let ready = false;
    const helloTimer = setTimeout(() => peer.close(1002, "hello_timeout"), 5000);
    peer.on("message", (data, isBinary) => {
      try {
        if (isBinary) throw new Error("Binary Relay control message");
        const message = parseMessage(data);
        if (!ready) {
          if (message.type !== "hello" || message.protocol !== SELF_HOSTED_RELAY_PROTOCOL) throw new Error("Invalid Relay hello");
          const capabilities = Array.isArray(message.capabilities) ? message.capabilities.map(String) : [];
          if (!capabilities.includes("http") || !capabilities.includes("stream")) throw new Error("Relay client capability mismatch");
          clearTimeout(helloTimer);
          if (node && node !== peer) node.close(4001, "replaced");
          node = peer;
          nodeReady = true;
          ready = true;
          lastPongAt = Date.now();
          startHeartbeat();
          sendNode({ v: 1, type: "ready", connectionId: opaqueId("conn"), generation: config.generation, heartbeatSeconds: config.heartbeatSeconds, maxFrameBytes: MAX_FRAME_BYTES });
          logger.log?.(`[self-hosted-relay] node ready site=${config.siteId}`);
          return;
        }
        if (message.type === "pong") { lastPongAt = Date.now(); return; }
        if (message.type === "ping") { sendNode({ v: 1, type: "pong", timestamp: Number(message.timestamp) || Date.now() }); return; }
        handleNodeResponse(message);
      } catch (error) {
        logger.error?.(`[self-hosted-relay] protocol error: ${error instanceof Error ? error.message : "unknown"}`);
        peer.close(1002, "protocol_error");
      }
    });
    peer.on("close", () => {
      clearTimeout(helloTimer);
      if (node !== peer) return;
      node = null;
      nodeReady = false;
      stopHeartbeat();
      for (const stream of [...streams.values()]) failStream(stream, 503, "Personal Agent Node disconnected");
    });
    peer.on("error", () => peer.close());
  }

  function handleNodeResponse(message: Record<string, any>) {
    const id = String(message.id || "");
    const stream = streams.get(id);
    if (!stream) throw new Error("Unknown Relay stream");
    resetTimeout(stream);
    if (message.type === "response.error") return failStream(stream, 502, "Node request failed");
    if (message.type === "response.start") {
      if (stream.responseStarted) throw new Error("Duplicate response.start");
      stream.responseStarted = true;
      const status = Number(message.status);
      if (!Number.isInteger(status) || status < 100 || status > 599) throw new Error("Invalid response status");
      if (stream.kind === "http") stream.response!.writeHead(status, responseHeaders(message.headers));
      else if (status !== 101) return failStream(stream, 502, "Node WebSocket rejected");
      return;
    }
    if (!stream.responseStarted) throw new Error("Response data before response.start");
    if (message.type === "response.data") {
      const seq = Number(message.seq);
      if (seq !== stream.responseSeq++) throw new Error("Out-of-order Relay response");
      const bytes = decodeChunk(message.data);
      stream.bytesOut += bytes.length;
      if (stream.bytesOut > MAX_BODY_BYTES) return failStream(stream, 502, "Response too large");
      if (stream.kind === "http") stream.response!.write(bytes);
      else if (message.opcode === "close") stream.browser?.close(safeCloseCode(message.closeCode));
      else stream.browser?.send(bytes, { binary: message.opcode === "binary" });
      return;
    }
    if (message.type === "response.end") return finishStream(stream);
    throw new Error("Unknown Relay response message");
  }

  function createStream(kind: RelayStream["kind"], request: IncomingMessage, target: Pick<RelayStream, "response" | "browser">): RelayStream {
    const stream: RelayStream = { id: opaqueId("stream"), kind, request, ...target, requestSeq: 0, responseSeq: 0, bytesIn: 0, bytesOut: 0, responseStarted: false, ended: false };
    streams.set(stream.id, stream);
    resetTimeout(stream);
    return stream;
  }

  function sendChunks(stream: RelayStream, type: string, bytes: Buffer, extra: Record<string, unknown> = {}) {
    for (let offset = 0; offset < bytes.length; offset += MAX_FRAME_BYTES) {
      sendNode({ v: 1, type, id: stream.id, seq: stream.requestSeq++, data: bytes.subarray(offset, offset + MAX_FRAME_BYTES).toString("base64"), ...extra });
    }
  }

  function sendNode(message: Record<string, unknown>) {
    if (!node || node.readyState !== WebSocket.OPEN) throw new Error("Personal Agent Node is offline");
    node.send(JSON.stringify(message));
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeat = setInterval(() => {
      if (!nodeReady || Date.now() - lastPongAt > config.heartbeatSeconds * 3000) return node?.close(4000, "pong_timeout");
      try { sendNode({ v: 1, type: "ping", timestamp: Date.now() }); } catch {}
    }, config.heartbeatSeconds * 1000);
    heartbeat.unref?.();
  }

  function stopHeartbeat() { if (heartbeat) clearInterval(heartbeat); heartbeat = null; }

  function resetTimeout(stream: RelayStream) {
    if (stream.timeout) clearTimeout(stream.timeout);
    stream.timeout = setTimeout(() => cancelStream(stream, "stream_timeout"), 60_000);
    stream.timeout.unref?.();
  }

  function cancelStream(stream: RelayStream, reason: string) {
    if (stream.ended) return;
    try { sendNode({ v: 1, type: "request.cancel", id: stream.id, reason }); } catch {}
    failStream(stream, 502, "Relay stream cancelled");
  }

  function failStream(stream: RelayStream, status: number, message: string) {
    if (stream.ended) return;
    if (stream.kind === "http" && stream.response && !stream.response.headersSent) sendText(stream.response, status, `${message}\n`);
    else if (stream.kind === "http") stream.response?.destroy();
    else stream.browser?.close(1011, "relay_error");
    finishStream(stream, false);
  }

  function finishStream(stream: RelayStream, endTarget = true) {
    if (stream.ended) return;
    stream.ended = true;
    if (stream.timeout) clearTimeout(stream.timeout);
    streams.delete(stream.id);
    if (endTarget && stream.kind === "http") stream.response?.end();
    if (endTarget && stream.kind === "websocket" && stream.browser?.readyState === WebSocket.OPEN) stream.browser.close(1000);
  }

  return {
    server,
    listen: () => new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(config.listenPort, config.listenHost, () => resolve()); }),
    close: () => new Promise<void>((resolve) => { stopHeartbeat(); node?.close(1001, "relay_shutdown"); for (const stream of [...streams.values()]) failStream(stream, 503, "Relay shutdown"); browserWss.close(); nodeWss.close(); server.close(() => resolve()); }),
    status: () => ({ connected: nodeReady, siteId: config.siteId, domain: config.domain, streams: streams.size }),
  };
}

function parseMessage(data: WebSocket.RawData): Record<string, any> {
  const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
  if (Buffer.byteLength(text) > MAX_FRAME_BYTES * 2 + 16 * 1024) throw new Error("Relay frame too large");
  const value = JSON.parse(text);
  if (!value || value.v !== 1 || typeof value.type !== "string") throw new Error("Invalid Relay frame");
  return value;
}

function requestHeaders(request: IncomingMessage, spaceRoute = "") {
  const headers: Record<string, string | string[]> = {};
  for (const [rawName, rawValue] of Object.entries(request.headers)) {
    const name = rawName.toLowerCase();
    if (HOP_HEADERS.has(name) || name === "authorization" || name === "host" || name.startsWith("sec-websocket-") || name.startsWith("x-personal-agent-")) continue;
    if (Array.isArray(rawValue)) headers[name] = rawValue.map(String).slice(0, 32);
    else if (rawValue !== undefined) headers[name] = String(rawValue).slice(0, 8192);
  }
  if (spaceRoute) headers["x-personal-agent-space-route"] = spaceRoute;
  return headers;
}

function responseHeaders(value: unknown) {
  const headers: Record<string, string | string[]> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return headers;
  for (const [rawName, rawValue] of Object.entries(value)) {
    const name = rawName.toLowerCase();
    if (HOP_HEADERS.has(name) || name === "content-length" || rawValue === undefined) continue;
    headers[name] = Array.isArray(rawValue) ? rawValue.map(String).slice(0, 32) : String(rawValue).slice(0, 8192);
  }
  return headers;
}

function validToken(request: IncomingMessage, expectedHash: string) {
  const match = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(String(request.headers.authorization || ""));
  if (!match) return false;
  const actual = crypto.createHash("sha256").update(match[1]).digest();
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function validProtocol(request: IncomingMessage) {
  return String(request.headers["sec-websocket-protocol"] || "").split(",").map((value) => value.trim()).includes(SELF_HOSTED_RELAY_PROTOCOL);
}

function safeUrl(request: IncomingMessage, domain: string) {
  try {
    const host = String(request.headers.host || "").split(":", 1)[0].toLowerCase();
    if (host && host !== domain && !host.endsWith(`.${domain}`) && host !== "127.0.0.1" && host !== "localhost") return null;
    const url = new URL(request.url || "/", `http://${host || domain}`);
    return url.pathname.startsWith("/") && !url.pathname.startsWith("//") ? url : null;
  } catch { return null; }
}

function spaceRouteForRequest(request: IncomingMessage, domain: string): string | null {
  const host = String(request.headers.host || "").split(":", 1)[0].toLowerCase();
  if (!host || host === domain || host === "127.0.0.1" || host === "localhost") return "";
  if (!host.endsWith(`.${domain}`)) return null;
  const label = host.slice(0, -(domain.length + 1));
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label) ? label : null;
}

function connectorHostAllowed(request: IncomingMessage, domain: string) {
  const host = String(request.headers.host || "").split(":", 1)[0].toLowerCase();
  return !host || host === domain || host === `connect.${domain}` || host === "127.0.0.1" || host === "localhost";
}

function decodeChunk(value: unknown) {
  const text = String(value || "");
  if (text && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) throw new Error("Invalid Relay data");
  const bytes = Buffer.from(text, "base64");
  if (bytes.length > MAX_FRAME_BYTES) throw new Error("Relay data frame too large");
  return bytes;
}

function opaqueId(prefix: string) { return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`; }
function safeCloseCode(value: unknown) { const code = Number(value); return Number.isInteger(code) && code >= 1000 && code <= 4999 && ![1004, 1005, 1006, 1015].includes(code) ? code : 1000; }
function boundedInteger(value: unknown, min: number, max: number, name: string) { const number = Number(value); if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`Invalid ${name}`); return number; }
function sendJson(response: ServerResponse, status: number, body: unknown) { const text = `${JSON.stringify(body)}\n`; response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text), "cache-control": "no-store" }); response.end(text); }
function sendText(response: ServerResponse, status: number, body: string, headers: Record<string, string> = {}) { response.writeHead(status, { "content-type": "text/plain; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store", ...headers }); response.end(body); }
function rejectUpgrade(socket: NodeJS.WritableStream & { destroy(): void }, status: number) { const body = status === 401 ? "Unauthorized\n" : status === 503 ? "Service Unavailable\n" : "Bad Request\n"; socket.end?.(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`); }
