import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocket } from "ws";
import { writeJsonAtomic } from "./config.ts";

export const REVERSE_TUNNEL_PROTOCOL = "pa-reverse-ws-v1";
export const DEFAULT_MAX_FRAME_BYTES = 128 * 1024;
const DEFAULT_MAX_BODY_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_BUFFERED_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_STREAMS = 64;
const DEFAULT_MAX_REJECTED_STREAMS = 64;
const REJECTED_STREAM_TTL_MS = 60_000;
const HOP_BY_HOP_HEADERS = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade",
]);

export function loadReverseTunnelConfig(config) {
  const document = readJson(path.join(config.configDir, "cloud.json"));
  if (config.site?.connectionMode !== "managed-cloud") throw tunnelError("TUNNEL_NOT_SELECTED", "Managed Cloud is not selected");
  if (!document?.tunnel) throw tunnelError("TUNNEL_CONFIG_MISSING", "Reverse tunnel enrollment is missing");
  const tunnel = validateReverseTunnelContract(document.tunnel);
  const token = String(config.env?.PERSONAL_AGENT_CLOUD_TOKEN || "").trim();
  if (token.length < 16 || token.length > 2048) throw tunnelError("TUNNEL_TOKEN_MISSING", "Reverse tunnel credential is missing");
  const accessExpiresAt = validTimestamp(document.credential?.accessExpiresAt);
  const refreshAvailable = Boolean(String(config.env?.PERSONAL_AGENT_CLOUD_REFRESH_TOKEN || "").trim() && document.credential?.refreshEndpoint);
  return { ...tunnel, token, accessExpiresAt, refreshAvailable, clientVersion: String(document.clientVersion || process.env.npm_package_version || "unknown").slice(0, 40) };
}

export function validateReverseTunnelContract(value) {
  if (!value || value.protocol !== REVERSE_TUNNEL_PROTOCOL) throw tunnelError("TUNNEL_PROTOCOL_UNSUPPORTED", "Unsupported reverse tunnel protocol");
  const endpoint = new URL(String(value.endpoint || ""));
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname);
  if (endpoint.protocol !== "wss:" && !(loopback && endpoint.protocol === "ws:")) throw tunnelError("TUNNEL_ENDPOINT_INVALID", "Reverse tunnel endpoint must use WSS");
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw tunnelError("TUNNEL_ENDPOINT_INVALID", "Reverse tunnel endpoint cannot contain credentials, query, or fragment");
  const heartbeatSeconds = boundedInteger(value.heartbeatSeconds, 5, 120, "heartbeatSeconds");
  const maxFrameBytes = boundedInteger(value.maxFrameBytes, 16 * 1024, 1024 * 1024, "maxFrameBytes");
  const generation = boundedInteger(value.generation, 1, Number.MAX_SAFE_INTEGER, "generation");
  return { protocol: REVERSE_TUNNEL_PROTOCOL, endpoint: endpoint.toString(), heartbeatSeconds, maxFrameBytes, generation };
}

export class ReverseTunnelConnector {
  constructor({ config, tunnel, refreshCredential = null, silentCredential = null, logger = console, WebSocketImpl = WebSocket, httpRequest = http.request, now = () => new Date(), random = Math.random } = {}) {
    this.config = config;
    this.tunnel = { ...tunnel };
    this.logger = logger;
    this.WebSocketImpl = WebSocketImpl;
    this.httpRequest = httpRequest;
    this.now = now;
    this.random = random;
    this.refreshCredential = refreshCredential;
    this.silentCredential = silentCredential;
    this.statePath = path.join(config.runtimeDir, "reverse-tunnel.json");
    this.streams = new Map();
    this.rejectedStreams = new Map();
    this.socket = null;
    this.stopped = false;
    this.ready = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.watchdogTimer = null;
    this.lastServerActivity = 0;
    this.connectedAt = 0;
    this.disconnectCause = "";
    this.authRecovery = null;
    this.reauthRequired = false;
  }

  start() {
    if (this.stopped) throw tunnelError("TUNNEL_STOPPED", "Reverse tunnel connector is stopped");
    this.connect();
    return this;
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.cancelAll("connector_stopped");
    try { this.socket?.close(1000, "connector stopped"); } catch {}
    this.writeState("stopped");
  }

  connect() {
    if (this.stopped || this.reauthRequired || this.authRecovery) return;
    this.connectedAt = Date.now();
    this.lastServerActivity = this.connectedAt;
    this.writeState("connecting");
    const socket = new this.WebSocketImpl(this.tunnel.endpoint, REVERSE_TUNNEL_PROTOCOL, {
      headers: { authorization: `Bearer ${this.tunnel.token}` },
      maxPayload: Math.max(this.tunnel.maxFrameBytes * 2, 512 * 1024),
      handshakeTimeout: 15_000,
      perMessageDeflate: false,
    });
    this.socket = socket;
    socket.on("unexpected-response", (_request, response) => {
      if (socket !== this.socket) return;
      response?.resume?.();
      if (Number(response?.statusCode) === 401) {
        this.disconnectCause = "credential_rejected";
        void this.recoverCredential("broker_401");
      }
    });
    socket.on("open", () => {
      this.lastServerActivity = Date.now();
      this.connectedAt = this.lastServerActivity;
      this.disconnectCause = "";
      this.logger.log?.("[reverse-tunnel] connected");
      this.send({ v: 1, type: "hello", protocol: REVERSE_TUNNEL_PROTOCOL, clientVersion: this.tunnel.clientVersion, capabilities: ["http", "stream", "websocket"] });
    });
    socket.on("message", (data, isBinary) => {
      if (isBinary) return this.failConnection("TUNNEL_BINARY_CONTROL", "Binary control frames are not supported");
      this.lastServerActivity = Date.now();
      try { this.handleMessage(parseTunnelMessage(data, { maxFrameBytes: this.tunnel.maxFrameBytes })); }
      catch (error) { this.failConnection(error.code || "TUNNEL_PROTOCOL_ERROR", error.message); }
    });
    socket.on("close", (code, reason) => {
      if (socket !== this.socket) return;
      this.ready = false;
      this.cancelAll("tunnel_disconnected");
      const closedAt = Date.now();
      const cause = diagnosticCloseCause(code, reason, this.disconnectCause);
      const detail = { closeCode: Number(code) || 0, cause, connectedMs: Math.max(0, closedAt - this.connectedAt), lastServerActivityMs: Math.max(0, closedAt - this.lastServerActivity) };
      if (this.stopped) {
        this.logger.log?.(`[reverse-tunnel] stopped: code=${detail.closeCode} cause=${cause}`);
        this.writeState("stopped", detail);
        return;
      }
      this.logger.error?.(`[reverse-tunnel] disconnected: code=${detail.closeCode} cause=${cause} connected_ms=${detail.connectedMs} server_idle_ms=${detail.lastServerActivityMs}`);
      if (this.authRecovery || this.reauthRequired || cause === "credential_rejected") return;
      this.writeState("degraded", detail);
      this.scheduleReconnect();
    });
    socket.on("error", (error) => {
      const code = safeErrorCode(error);
      this.disconnectCause ||= `socket_error_${String(code).toLowerCase()}`;
      this.logger.error?.(`[reverse-tunnel] connection failed: ${code}`);
    });
    this.startWatchdog();
  }

  handleMessage(message) {
    if (message.type === "ready") {
      if (message.generation < this.tunnel.generation) throw tunnelError("TUNNEL_GENERATION_STALE", "Cloud returned a stale tunnel generation");
      this.ready = true;
      this.reconnectAttempt = 0;
      this.tunnel.generation = message.generation;
      if (message.heartbeatSeconds) this.tunnel.heartbeatSeconds = message.heartbeatSeconds;
      if (message.maxFrameBytes) this.tunnel.maxFrameBytes = Math.min(this.tunnel.maxFrameBytes, message.maxFrameBytes);
      this.logger.log?.(`[reverse-tunnel] ready: generation=${this.tunnel.generation} heartbeat_seconds=${this.tunnel.heartbeatSeconds}`);
      this.writeState("ready", { connectionId: boundedOpaque(message.connectionId, "connectionId"), lastPongAt: this.now().toISOString(), authorizationRequired: false });
      return;
    }
    if (message.type === "ping") {
      this.send({ v: 1, type: "pong", timestamp: message.timestamp });
      this.writeState(this.ready ? "ready" : "connecting", { lastPongAt: this.now().toISOString() });
      return;
    }
    if (!this.ready) throw tunnelError("TUNNEL_NOT_READY", "Tunnel request arrived before ready");
    if (message.type === "request.start") return this.startStream(message);
    if (message.type === "request.data") return this.writeStream(message);
    if (message.type === "request.end") return this.endStream(message.id);
    if (message.type === "request.cancel") return this.cancelStream(message.id, "cloud_cancelled");
    throw tunnelError("TUNNEL_MESSAGE_UNKNOWN", "Unknown tunnel message type");
  }

  startStream(message) {
    if (this.streams.has(message.id) || this.rejectedStreams.has(message.id)) throw tunnelError("TUNNEL_STREAM_DUPLICATE", "Duplicate tunnel stream");
    if (this.streams.size >= DEFAULT_MAX_STREAMS) return this.sendError(message.id, "STREAM_LIMIT_EXCEEDED");
    if (!isTunnelRouteAllowed(this.config.distribution, message.path, message.kind, message.method)) {
      this.rememberRejectedStream(message.id);
      return this.sendError(message.id, "REMOTE_ROUTE_DENIED");
    }
    const tunnelPath = resolveTunnelRequestPath(message.path);
    const headers = sanitizeRequestHeaders(message.headers);
    headers.host = this.config.domain || "127.0.0.1";
    const stream = { id: message.id, kind: message.kind, nextRequestSeq: 0, nextResponseSeq: 0, requestBytes: 0, responseBytes: 0, ended: false, endRequested: false, draining: false, pendingHttp: [], pendingBytes: 0, request: null, localSocket: null };
    this.streams.set(message.id, stream);
    if (message.kind === "websocket") return this.startWebSocketStream(stream, message, headers);
    const request = this.httpRequest({ hostname: "127.0.0.1", port: this.config.gateway.port, method: message.method, path: tunnelPath, headers }, (response) => {
      if (!this.streams.has(stream.id)) return response.destroy();
      this.send({ v: 1, type: "response.start", id: stream.id, status: response.statusCode || 502, headers: sanitizeResponseHeaders(response.headers) });
      response.on("data", (chunk) => {
        if (!this.streams.has(stream.id)) return;
        stream.responseBytes += chunk.length;
        if (stream.responseBytes > DEFAULT_MAX_BODY_BYTES) return this.abortStream(stream, "RESPONSE_TOO_LARGE");
        this.sendData("response.data", stream, chunk, "nextResponseSeq");
        if (this.socket?.bufferedAmount > DEFAULT_MAX_BUFFERED_BYTES) {
          response.pause();
          const resume = setInterval(() => {
            if (!this.streams.has(stream.id) || this.socket?.bufferedAmount <= DEFAULT_MAX_BUFFERED_BYTES / 2) {
              clearInterval(resume);
              if (this.streams.has(stream.id)) response.resume();
            }
          }, 20);
          resume.unref?.();
        }
      });
      response.on("end", () => this.finishStream(stream));
      response.on("error", () => this.abortStream(stream, "LOCAL_RESPONSE_FAILED"));
    });
    stream.request = request;
    request.setTimeout(60_000, () => this.abortStream(stream, "LOCAL_UPSTREAM_TIMEOUT"));
    request.on("error", () => this.abortStream(stream, "LOCAL_UPSTREAM_FAILED"));
  }

  startWebSocketStream(stream, message, headers) {
    const localSocket = new this.WebSocketImpl(`ws://127.0.0.1:${this.config.gateway.port}${message.path}`, [], { headers, maxPayload: DEFAULT_MAX_BODY_BYTES, perMessageDeflate: false });
    stream.localSocket = localSocket;
    stream.pending = [];
    localSocket.on("open", () => {
      this.send({ v: 1, type: "response.start", id: stream.id, status: 101, headers: {} });
      for (const item of stream.pending.splice(0)) localSocket.send(item.data, { binary: item.binary });
      stream.pendingBytes = 0;
    });
    localSocket.on("message", (data, isBinary) => {
      const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
      stream.responseBytes += bytes.length;
      if (stream.responseBytes > DEFAULT_MAX_BODY_BYTES) return this.abortStream(stream, "RESPONSE_TOO_LARGE");
      this.sendData("response.data", stream, bytes, "nextResponseSeq", { opcode: isBinary ? "binary" : "text" });
    });
    localSocket.on("close", (closeCode) => {
      if (!this.streams.has(stream.id)) return;
      const safeCloseCode = [1004, 1005, 1006, 1015].includes(closeCode) || closeCode < 1000 ? 1000 : closeCode;
      this.send({ v: 1, type: "response.data", id: stream.id, seq: stream.nextResponseSeq++, data: "", opcode: "close", closeCode: safeCloseCode });
      this.finishStream(stream);
    });
    localSocket.on("error", () => this.abortStream(stream, "LOCAL_WEBSOCKET_FAILED"));
  }

  writeStream(message) {
    const rejected = this.rejectedStreams.get(message.id);
    if (rejected) return this.drainRejectedStream(rejected, message);
    const stream = this.requireStream(message.id);
    if (message.seq !== stream.nextRequestSeq) throw tunnelError("TUNNEL_SEQUENCE_INVALID", "Out-of-order tunnel frame");
    stream.nextRequestSeq += 1;
    const data = decodeFrameData(message.data, this.tunnel.maxFrameBytes);
    stream.requestBytes += data.length;
    if (stream.requestBytes > DEFAULT_MAX_BODY_BYTES) return this.abortStream(stream, "REQUEST_TOO_LARGE");
    if (stream.kind === "websocket") {
      if (message.opcode === "close") { stream.localSocket?.close(message.closeCode || 1000); return; }
      if (message.opcode === "ping") { stream.localSocket?.ping(data); return; }
      if (message.opcode === "pong") { stream.localSocket?.pong(data); return; }
      const binary = message.opcode === "binary";
      if (stream.localSocket?.readyState === this.WebSocketImpl.OPEN) stream.localSocket.send(data, { binary });
      else {
        stream.pendingBytes += data.length;
        if (stream.pendingBytes > DEFAULT_MAX_BUFFERED_BYTES) return this.abortStream(stream, "STREAM_BUFFER_EXCEEDED");
        stream.pending.push({ data, binary });
      }
      return;
    }
    if (stream.ended) throw tunnelError("TUNNEL_STREAM_ENDED", "Tunnel stream already ended");
    if (stream.draining || stream.pendingHttp.length) {
      stream.pendingBytes += data.length;
      if (stream.pendingBytes > DEFAULT_MAX_BUFFERED_BYTES) return this.abortStream(stream, "STREAM_BUFFER_EXCEEDED");
      stream.pendingHttp.push(data);
      return;
    }
    if (!stream.request.write(data)) {
      stream.draining = true;
      stream.request.once("drain", () => this.flushHttpStream(stream));
    }
  }

  endStream(id) {
    if (this.forgetRejectedStream(id)) return;
    const stream = this.requireStream(id);
    if (stream.ended) throw tunnelError("TUNNEL_STREAM_ENDED", "Tunnel stream already ended");
    stream.ended = true;
    if (stream.kind === "http") {
      stream.endRequested = true;
      if (!stream.draining && !stream.pendingHttp.length) stream.request.end();
    }
  }

  flushHttpStream(stream) {
    if (!this.streams.has(stream.id)) return;
    stream.draining = false;
    while (stream.pendingHttp.length) {
      const data = stream.pendingHttp.shift();
      stream.pendingBytes -= data.length;
      if (!stream.request.write(data)) {
        stream.draining = true;
        stream.request.once("drain", () => this.flushHttpStream(stream));
        return;
      }
    }
    if (stream.endRequested) stream.request.end();
  }

  finishStream(stream) {
    if (!this.streams.delete(stream.id)) return;
    this.send({ v: 1, type: "response.end", id: stream.id });
  }

  abortStream(stream, code) {
    if (!this.streams.delete(stream.id)) return;
    try { stream.request?.destroy(); } catch {}
    try { stream.localSocket?.close(1011, "local stream failed"); } catch {}
    this.sendError(stream.id, code);
  }

  cancelStream(id) {
    if (this.forgetRejectedStream(id)) return;
    const stream = this.streams.get(id);
    if (!stream) return;
    this.streams.delete(id);
    try { stream.request?.destroy(); } catch {}
    try { stream.localSocket?.close(1001, "request cancelled"); } catch {}
  }

  cancelAll(reason) {
    for (const id of [...this.streams.keys()]) this.cancelStream(id, reason);
    for (const id of [...this.rejectedStreams.keys()]) this.forgetRejectedStream(id);
  }

  rememberRejectedStream(id) {
    if (this.rejectedStreams.size >= DEFAULT_MAX_REJECTED_STREAMS) this.forgetRejectedStream(this.rejectedStreams.keys().next().value);
    const timer = setTimeout(() => this.forgetRejectedStream(id), REJECTED_STREAM_TTL_MS);
    timer.unref?.();
    this.rejectedStreams.set(id, { id, nextRequestSeq: 0, requestBytes: 0, timer });
  }

  drainRejectedStream(stream, message) {
    if (message.seq !== stream.nextRequestSeq) throw tunnelError("TUNNEL_SEQUENCE_INVALID", "Out-of-order tunnel frame");
    stream.nextRequestSeq += 1;
    stream.requestBytes += decodeFrameData(message.data, this.tunnel.maxFrameBytes).length;
    if (stream.requestBytes > DEFAULT_MAX_BODY_BYTES) this.forgetRejectedStream(stream.id);
  }

  forgetRejectedStream(id) {
    const stream = this.rejectedStreams.get(id);
    if (!stream) return false;
    clearTimeout(stream.timer);
    this.rejectedStreams.delete(id);
    return true;
  }

  requireStream(id) {
    const stream = this.streams.get(id);
    if (!stream) throw tunnelError("TUNNEL_STREAM_UNKNOWN", "Unknown tunnel stream");
    return stream;
  }

  sendData(type, stream, data, sequenceKey, extra = {}) {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
    for (let offset = 0; offset < bytes.length; offset += this.tunnel.maxFrameBytes) {
      const chunk = bytes.subarray(offset, offset + this.tunnel.maxFrameBytes);
      this.send({ v: 1, type, id: stream.id, seq: stream[sequenceKey]++, data: chunk.toString("base64"), ...extra });
    }
  }

  sendError(id, code) {
    this.send({ v: 1, type: "response.error", id, code });
  }

  send(message) {
    if (!this.socket || this.socket.readyState !== this.WebSocketImpl.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  failConnection(code, message) {
    this.logger.error(`[reverse-tunnel] protocol failure: ${code}`);
    this.writeState("failed", { code });
    try { this.socket?.close(1002, String(message || code).slice(0, 120)); } catch {}
  }

  startWatchdog() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = setInterval(() => {
      if (this.shouldRefreshCredential()) {
        void this.recoverCredential("access_expiring", { keepConnection: true });
        return;
      }
      if (!this.socket || this.socket.readyState !== this.WebSocketImpl.OPEN) return;
      const idleMs = Date.now() - this.lastServerActivity;
      if (idleMs > this.tunnel.heartbeatSeconds * 2250) {
        this.disconnectCause = "heartbeat_timeout";
        this.logger.error?.(`[reverse-tunnel] heartbeat timeout: server_idle_ms=${idleMs}`);
        this.socket.terminate();
      }
    }, Math.max(1000, this.tunnel.heartbeatSeconds * 1000));
    this.watchdogTimer.unref?.();
  }

  scheduleReconnect() {
    if (this.stopped || this.reauthRequired || this.authRecovery) return;
    const base = Math.min(30_000, 1000 * 2 ** Math.min(this.reconnectAttempt, 5));
    const delay = Math.round(base * (0.8 + this.random() * 0.4));
    this.reconnectAttempt += 1;
    const nextRetryAt = new Date(this.now().getTime() + delay).toISOString();
    this.logger.log?.(`[reverse-tunnel] reconnect scheduled: attempt=${this.reconnectAttempt} delay_ms=${delay}`);
    this.writeState("degraded", { cause: this.disconnectCause || "connection_failed", reconnectAttempt: this.reconnectAttempt, nextRetryAt });
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
    this.reconnectTimer.unref?.();
  }

  shouldRefreshCredential() {
    const expiresAt = Date.parse(String(this.tunnel.accessExpiresAt || ""));
    return Boolean(this.tunnel.refreshAvailable && this.refreshCredential && !this.authRecovery && Number.isFinite(expiresAt) && expiresAt - this.now().getTime() <= 2 * 60_000);
  }

  recoverCredential(reason, { keepConnection = false } = {}) {
    if (this.authRecovery) return this.authRecovery;
    this.writeState("degraded", { cause: reason, authorizationRequired: false });
    if ((!this.tunnel.refreshAvailable || typeof this.refreshCredential !== "function") && typeof this.silentCredential !== "function") {
      this.reauthRequired = true;
      this.writeState("reauth_required", { cause: "refresh_unavailable", authorizationRequired: true, setupAction: "connectivity.managed-authorize" });
      return Promise.resolve(false);
    }
    let recovered = false;
    this.authRecovery = Promise.resolve()
      .then(async () => {
        if (this.tunnel.refreshAvailable && typeof this.refreshCredential === "function") {
          this.writeState("refreshing", { cause: reason, authorizationRequired: false });
          try { return await this.refreshCredential(); }
          catch (error) {
            if (!requiresReauthorization(safeErrorCode(error)) || typeof this.silentCredential !== "function") throw error;
          }
        }
        this.writeState("authorizing", { cause: reason, authorizationRequired: false, method: "silent-browser-session" });
        return this.silentCredential();
      })
      .then((credential) => {
        this.tunnel.token = String(credential.token);
        this.tunnel.accessExpiresAt = credential.accessExpiresAt;
        if (credential.generation) this.tunnel.generation = Number(credential.generation);
        this.reauthRequired = false;
        recovered = true;
        this.reconnectAttempt = 0;
        this.disconnectCause = "";
        this.writeState(keepConnection && this.ready ? "ready" : "recovered", { recoveredAt: this.now().toISOString(), authorizationRequired: false });
        if (!keepConnection || !this.ready) {
          try { this.socket?.terminate?.(); } catch {}
          this.socket = null;
        }
        return true;
      })
      .catch((error) => {
        const code = safeErrorCode(error);
        if (requiresReauthorization(code)) {
          this.reauthRequired = true;
          this.writeState("reauth_required", { cause: String(code).toLowerCase(), authorizationRequired: true, setupAction: "connectivity.managed-authorize" });
        } else {
          this.writeState("degraded", { cause: String(code).toLowerCase(), authorizationRequired: false });
        }
        return false;
      })
      .finally(() => {
        const shouldReconnect = !keepConnection || !this.ready;
        this.authRecovery = null;
        if (shouldReconnect && !this.reauthRequired && !this.stopped) {
          if (recovered) this.connect();
          else this.scheduleReconnect();
        }
      });
    return this.authRecovery;
  }

  writeState(state, extra = {}) {
    writeJsonAtomic(this.statePath, {
      schemaVersion: 1,
      protocol: REVERSE_TUNNEL_PROTOCOL,
      state,
      generation: this.tunnel.generation,
      endpointOrigin: new URL(this.tunnel.endpoint).origin,
      updatedAt: this.now().toISOString(),
      ...extra,
    }, 0o600);
  }
}

export function parseTunnelMessage(raw, { maxFrameBytes = DEFAULT_MAX_FRAME_BYTES } = {}) {
  const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw || "");
  if (!text || Buffer.byteLength(text) > maxFrameBytes * 2 + 4096) throw tunnelError("TUNNEL_FRAME_TOO_LARGE", "Tunnel control frame is too large");
  let message;
  try { message = JSON.parse(text); } catch { throw tunnelError("TUNNEL_JSON_INVALID", "Tunnel frame is not valid JSON"); }
  if (!message || message.v !== 1 || typeof message.type !== "string") throw tunnelError("TUNNEL_FRAME_INVALID", "Tunnel frame envelope is invalid");
  if (["request.start", "request.data", "request.end", "request.cancel"].includes(message.type)) message.id = boundedOpaque(message.id, "stream id");
  if (message.type === "request.start") {
    if (!['http', 'websocket'].includes(message.kind)) throw tunnelError("TUNNEL_KIND_INVALID", "Tunnel request kind is invalid");
    message.method = normalizeMethod(message.method);
    message.path = normalizeTunnelPath(message.path);
    message.headers = normalizeHeaderObject(message.headers);
  }
  if (message.type === "request.data") {
    message.seq = boundedInteger(message.seq, 0, Number.MAX_SAFE_INTEGER, "seq");
    decodeFrameData(message.data, maxFrameBytes);
    if (message.opcode && !["text", "binary", "ping", "pong", "close"].includes(message.opcode)) throw tunnelError("TUNNEL_OPCODE_INVALID", "Tunnel WebSocket opcode is invalid");
    if (message.closeCode !== undefined) message.closeCode = boundedInteger(message.closeCode, 1000, 4999, "closeCode");
  }
  if (message.type === "ready") {
    message.generation = boundedInteger(message.generation, 1, Number.MAX_SAFE_INTEGER, "generation");
    if (message.heartbeatSeconds !== undefined) message.heartbeatSeconds = boundedInteger(message.heartbeatSeconds, 5, 120, "heartbeatSeconds");
    if (message.maxFrameBytes !== undefined) message.maxFrameBytes = boundedInteger(message.maxFrameBytes, 16 * 1024, 1024 * 1024, "maxFrameBytes");
  }
  if (message.type === "ping") message.timestamp = boundedInteger(message.timestamp, 0, Number.MAX_SAFE_INTEGER, "timestamp");
  return message;
}

export function normalizeTunnelPath(value) {
  const input = String(value || "");
  if (!input.startsWith("/") || input.startsWith("//") || input.includes("\\") || /[\u0000-\u001f\u007f]/.test(input)) throw tunnelError("TUNNEL_PATH_INVALID", "Tunnel path is invalid");
  const url = new URL(input, "http://127.0.0.1");
  if (url.origin !== "http://127.0.0.1" || url.username || url.password) throw tunnelError("TUNNEL_PATH_INVALID", "Tunnel path is invalid");
  return `${url.pathname}${url.search}`;
}

export function resolveTunnelRequestPath(requestPath) {
  const normalized = normalizeTunnelPath(requestPath);
  const url = new URL(normalized, "http://127.0.0.1");
  if (url.pathname === "/" || url.pathname === "/app") url.pathname = "/app/mobile";
  return `${url.pathname}${url.search}`;
}

export function isTunnelRouteAllowed(_distribution, requestPath, kind = "http", method = "GET") {
  if (kind !== "http") return false;
  let pathname;
  try { pathname = new URL(resolveTunnelRequestPath(requestPath), "http://127.0.0.1").pathname; }
  catch { return false; }
  const normalizedMethod = String(method || "GET").toUpperCase();
  if (pathname === "/login" || pathname === "/logout") return ["GET", "HEAD", "POST"].includes(normalizedMethod);
  if (!["GET", "HEAD"].includes(normalizedMethod)) return false;
  if (MOBILE_TUNNEL_EXACT_PATHS.has(pathname)) return true;
  return MOBILE_TUNNEL_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

const MOBILE_TUNNEL_EXACT_PATHS = new Set([
  "/app/mobile",
  "/favicon.ico",
  "/api/node/v1/client/overview",
  "/api/node/v1/client/runtime",
  "/api/system/apps",
  "/api/system/spaces",
  "/api/system/mail/status",
  "/api/skills",
  "/api/channels",
  "/api/chat/sessions",
  "/api/app/mail/messages",
]);

const MOBILE_TUNNEL_PATH_PREFIXES = [
  "/app/mobile/",
  "/_next/static/",
  "/_next/image",
  "/apps/",
  "/api/mobile/",
  "/api/chat/sessions/",
  "/api/app/mail/messages/",
  "/public/",
  "/pages/",
  "/publications/",
  "/uploads/",
];

export function sanitizeRequestHeaders(headers) {
  const normalized = normalizeHeaderObject(headers);
  const output = {};
  for (const [name, value] of Object.entries(normalized)) {
    if (!HOP_BY_HOP_HEADERS.has(name) && name !== "authorization" && name !== "host") output[name] = value;
  }
  return output;
}

export function sanitizeResponseHeaders(headers) {
  const output = {};
  for (const [rawName, rawValue] of Object.entries(headers || {})) {
    const name = String(rawName).toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(name) || rawValue === undefined) continue;
    if (Array.isArray(rawValue)) output[name] = rawValue.map((item) => String(item).slice(0, 8192)).slice(0, 32);
    else output[name] = String(rawValue).slice(0, 8192);
  }
  return output;
}

function normalizeHeaderObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  for (const [rawName, rawValue] of Object.entries(value)) {
    const name = String(rawName).toLowerCase();
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]{1,128}$/.test(name)) throw tunnelError("TUNNEL_HEADER_INVALID", "Tunnel header name is invalid");
    if (Array.isArray(rawValue)) output[name] = rawValue.map((item) => boundedHeaderValue(item)).slice(0, 32);
    else output[name] = boundedHeaderValue(rawValue);
  }
  return output;
}

function boundedHeaderValue(value) {
  const text = String(value ?? "");
  if (text.length > 8192 || /[\r\n\u0000]/.test(text)) throw tunnelError("TUNNEL_HEADER_INVALID", "Tunnel header value is invalid");
  return text;
}

function decodeFrameData(value, maxFrameBytes) {
  const text = String(value ?? "");
  if (text && (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text))) throw tunnelError("TUNNEL_DATA_INVALID", "Tunnel frame data is invalid");
  const data = Buffer.from(text, "base64");
  if (data.length > maxFrameBytes) throw tunnelError("TUNNEL_FRAME_TOO_LARGE", "Tunnel data frame is too large");
  return data;
}

function normalizeMethod(value) {
  const method = String(value || "").toUpperCase();
  if (!/^[A-Z]{3,16}$/.test(method)) throw tunnelError("TUNNEL_METHOD_INVALID", "Tunnel method is invalid");
  return method;
}

function boundedOpaque(value, label) {
  const text = String(value || "");
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(text)) throw tunnelError("TUNNEL_ID_INVALID", `Tunnel ${label} is invalid`);
  return text;
}

function boundedInteger(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw tunnelError("TUNNEL_VALUE_INVALID", `Tunnel ${label} is invalid`);
  return number;
}

function safeErrorCode(error) {
  return /^[A-Z0-9_]{1,64}$/.test(String(error?.code || "")) ? error.code : "CONNECTION_ERROR";
}

function requiresReauthorization(code) {
  return new Set([
    "CLOUD_REFRESH_TOKEN_MISSING", "CLOUD_DEVICE_BINDING_MISMATCH", "DEVICE_BINDING_MISMATCH",
    "INVALID_REFRESH_TOKEN", "REFRESH_REPLAYED", "REFRESH_EXPIRED", "REFRESH_FAMILY_SUPERSEDED", "SITE_REVOKED", "CLOUD_REFRESH_REJECTED",
    "CLOUD_SILENT_LOGIN_REQUIRED", "CLOUD_SILENT_CONSENT_REQUIRED", "CLOUD_SILENT_INTERACTION_REQUIRED", "CLOUD_SILENT_MFA_REQUIRED",
    "CLOUD_SILENT_RISK_BLOCKED", "CLOUD_BROWSER_UNAVAILABLE", "CLOUD_SILENT_TIMEOUT", "CLOUD_SILENT_DEVICE_KEY_MISSING",
  ]).has(String(code || "").toUpperCase());
}

function validTimestamp(value) {
  const timestamp = new Date(String(value || ""));
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : "";
}

function diagnosticCloseCause(code, reason, preferred) {
  if (/^[a-z0-9_]{1,64}$/.test(String(preferred || ""))) return preferred;
  const text = Buffer.isBuffer(reason) ? reason.toString("utf8") : String(reason || "");
  if (/^[a-z0-9_]{1,64}$/.test(text)) return text;
  return `close_${Number(code) || 0}`;
}

function tunnelError(code, message) {
  return Object.assign(new Error(message), { code });
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}
