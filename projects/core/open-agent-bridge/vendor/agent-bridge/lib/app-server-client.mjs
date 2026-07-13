// JSON-RPC transport for a long-lived `codex app-server` process.
//
// One app-server child per worker holds all threads (sessions), giving hot resume, interactive
// approval, steer/interrupt, and structured events from a single official protocol.
//
// Wire protocol (verified, codex 0.142.5): newline-delimited JSON, NO `jsonrpc` field. Demux by shape:
//   - method + id  => server->client REQUEST (we must reply {id,result} or {id,error})
//   - method only  => notification
//   - id + result/error => response to one of our requests
//
// Transport choice: plain `codex app-server` over the child's stdio. Proven for start/turn/resume/
// approval/interrupt and cross-process warm resume (M1-M3/M5). Multi-client survival across a worker
// restart (ws:// fan-out) is a later enhancement; disk rollout + thread/resume already recovers threads.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import readline from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_SOCKET_WAIT_MS = 5_000;

export function createAppServerClient({
  command = 'codex',
  args,
  cwd,
  env,
  log = () => {},
  transport = 'stdio',
  socketPath,
  allowStdioFallback = true,
} = {}) {
  let child = null;
  let rl = null;
  let ws = null;
  let nextId = 1;
  let readyPromise = null;
  let disposed = false;
  let activeTransport = transport === 'unix' ? 'unix' : 'stdio';

  const pending = new Map();            // request id -> { resolve, reject, timer, method }
  const pendingServerRequests = new Map(); // server request id -> { method, params }
  const notifyHandlers = new Set();     // fn(msg) for pure notifications
  const serverRequestHandlers = new Set(); // fn(msg) for server->client requests
  const closeHandlers = new Set();      // fn({ code, signal }) when the child exits

  function write(obj) {
    if (activeTransport === 'unix') {
      if (!ws || ws.readyState !== 1) return false;
      try { ws.send(JSON.stringify(obj)); return true; } catch { return false; }
    }
    if (!child || !child.stdin.writable) return false;
    try { child.stdin.write(JSON.stringify(obj) + '\n'); return true; } catch { return false; }
  }

  function handleFrame(rawLine) {
    const line = String(rawLine).trim();
    if (!line || line[0] !== '{') return; // skip banners / non-JSON stderr bleed
    let msg;
    try { msg = JSON.parse(line); } catch { return; }

    // server -> client request
    if (msg.id != null && typeof msg.method === 'string') {
      pendingServerRequests.set(msg.id, { method: msg.method, params: msg.params });
      if (serverRequestHandlers.size === 0) {
        // no handler registered: fail closed so the turn does not hang.
        errorToServerRequest(msg.id, `unhandled server request: ${msg.method}`);
        return;
      }
      for (const fn of serverRequestHandlers) { try { fn(msg); } catch (e) { log(`[app-server] serverRequest handler error: ${e.message}`); } }
      return;
    }
    // notification
    if (typeof msg.method === 'string') {
      for (const fn of notifyHandlers) { try { fn(msg); } catch (e) { log(`[app-server] notify handler error: ${e.message}`); } }
      return;
    }
    // response to one of our requests
    if (msg.id != null) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(rpcError(p.method, msg.error));
      else p.resolve(msg.result);
    }
  }

  function spawnChild(spawnArgs) {
    child = spawn(command, spawnArgs, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...(env || {}) } });
    rl = readline.createInterface({ input: child.stdout });
    rl.on('line', handleFrame);
    child.stderr.on('data', (chunk) => {
      const detail = String(chunk || '').trim();
      if (detail) log(`[app-server:stderr] ${detail.slice(0, 4000)}`);
    });
    child.on('error', (e) => log(`[app-server] child error: ${e.code || 'error'} ${e.message}`));
    child.on('close', (code, signal) => {
      const err = new Error(`app-server exited (code=${code} signal=${signal})`);
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(err); }
      pending.clear();
      pendingServerRequests.clear();
      try { rl?.close(); } catch {}
      child = null; rl = null; readyPromise = null;
      try { ws?.close?.(); } catch {}
      ws = null;
      for (const fn of closeHandlers) { try { fn({ code, signal }); } catch {} }
    });
  }

  async function startTransport() {
    if (activeTransport === 'unix') {
      await startUnixTransport();
      return;
    }
    spawnChild(args ?? ['app-server']);
  }

  async function startUnixTransport() {
    const targetSocket = socketPath || process.env.AGENT_BRIDGE_CODEX_APP_SERVER_SOCKET;
    if (!targetSocket) throw new Error('unix app-server socketPath is required');
    mkdirSync(dirname(targetSocket), { recursive: true });
    // 上一个 app-server 崩溃不会 unlink socket 文件：残留文件会让 waitForSocket 立即命中、
    // 连接吊死在没人监听的 socket 上（还可能让新子进程 bind 失败）。先清掉，由本次 spawn 独占。
    try { unlinkSync(targetSocket); } catch { /* 不存在即忽略 */ }
    spawnChild(args ?? ['app-server', '--listen', `unix://${targetSocket}`]);
    await waitForSocket(targetSocket);
    const WebSocketImpl = await loadWebSocket();
    await new Promise((resolve, reject) => {
      const url = `ws+unix://${targetSocket}:/`;
      ws = new WebSocketImpl(url);
      const timer = setTimeout(() => reject(new Error(`timeout connecting ${url}`)), 10_000);
      timer.unref?.();
      ws.addEventListener?.('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener?.('message', (event) => handleFrame(event.data));
      ws.addEventListener?.('error', (event) => {
        const message = event?.message || event?.error?.message || 'websocket error';
        log(`[app-server] unix socket error: ${message}`);
        // 连接期出错（如 ECONNREFUSED）立即失败，让 ensureStarted 走 stdio 回退，而不是干等 10s 超时。
        clearTimeout(timer);
        reject(new Error(`unix socket error: ${message}`));
      });
      ws.addEventListener?.('close', () => {
        if (disposed) return;
        const err = new Error('app-server unix socket closed');
        for (const p of pending.values()) { clearTimeout(p.timer); p.reject(err); }
        pending.clear();
        pendingServerRequests.clear();
        readyPromise = null;
        for (const fn of closeHandlers) { try { fn({ code: null, signal: 'socket-close' }); } catch {} }
      });
    });
  }

  /** Lazily spawn + run the initialize handshake. Memoized; re-runs after a crash. */
  function ensureStarted() {
    if (disposed) return Promise.reject(new Error('app-server client disposed'));
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      try {
        await startTransport();
      } catch (error) {
        if (activeTransport !== 'unix' || !allowStdioFallback) throw error;
        log(`[app-server] unix transport failed, falling back to stdio: ${error.message}`);
        shutdownTransport();
        activeTransport = 'stdio';
        await startTransport();
      }
      await request('initialize', {
        clientInfo: { name: 'agent-bridge', title: 'Agent Bridge', version: '0.1.0' },
        capabilities: { experimentalApi: true },
      }, 30_000);
      notify('initialized', {});
      log('[app-server] initialized');
    })().catch((e) => { readyPromise = null; throw e; });
    return readyPromise;
  }

  /** Send a JSON-RPC request and await its response. Does NOT auto-start (call ensureStarted first). */
  function request(method, params, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      if (!child) { reject(new Error('app-server not started')); return; }
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout: ${method}`)); }, timeoutMs);
      timer.unref?.();
      pending.set(id, { resolve, reject, timer, method });
      if (!write({ id, method, params })) { pending.delete(id); clearTimeout(timer); reject(new Error(`write failed: ${method}`)); }
    });
  }

  /** Convenience: ensure the server is up, then send the request. */
  async function call(method, params, timeoutMs) {
    await ensureStarted();
    return request(method, params, timeoutMs);
  }

  function notify(method, params) { write({ method, params }); }

  function respondToServerRequest(id, result) {
    if (!pendingServerRequests.has(id)) return false;
    pendingServerRequests.delete(id);
    return write({ id, result: result ?? {} });
  }
  function errorToServerRequest(id, message, code = -32000) {
    if (!pendingServerRequests.has(id)) return false;
    pendingServerRequests.delete(id);
    return write({ id, error: { code, message: String(message) } });
  }

  return {
    ensureStarted,
    call,
    request,
    notify,
    respondToServerRequest,
    errorToServerRequest,
    onNotify(fn) { notifyHandlers.add(fn); return () => notifyHandlers.delete(fn); },
    onServerRequest(fn) { serverRequestHandlers.add(fn); return () => serverRequestHandlers.delete(fn); },
    onClose(fn) { closeHandlers.add(fn); return () => closeHandlers.delete(fn); },
    hasPendingServerRequest(id) { return pendingServerRequests.has(id); },
    isRunning() { return child != null || ws?.readyState === 1; },
    transport() { return activeTransport; },
    shutdown() {
      disposed = true;
      shutdownTransport();
    },
  };

  function shutdownTransport() {
    try { ws?.close?.(); } catch {}
    ws = null;
    try { child?.kill('SIGTERM'); } catch {}
    const c = child;
    setTimeout(() => { try { if (c && !c.killed) c.kill('SIGKILL'); } catch {} }, 3_000).unref?.();
  }
}

async function waitForSocket(socketPath, timeoutMs = DEFAULT_SOCKET_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(socketPath)) return;
    await delay(100);
  }
  throw new Error(`app-server unix socket did not appear: ${socketPath}`);
}

async function loadWebSocket() {
  const mod = await import('ws');
  return mod.WebSocket || mod.default;
}

function rpcError(method, error) {
  const detail = error && typeof error === 'object' ? (error.message || JSON.stringify(error)) : String(error);
  const err = new Error(`${method} failed: ${detail}`);
  // 标记“这是 app-server 明确答复的错误”（区别于超时/传输失败），供调用方判断错误可信度。
  err.isRpcError = true;
  err.rpcCode = error && typeof error === 'object' ? error.code : undefined;
  return err;
}

// Module singleton — one app-server per worker process.
let singleton = null;
export function getAppServerClient(options) {
  if (!singleton) singleton = createAppServerClient(options);
  return singleton;
}
/** transport 推导规则只此一份：显式配置优先，配了 socketPath 即 unix，否则 stdio。 */
export function deriveAppServerTransport(config = {}) {
  return config.appServerTransport || (config.appServerSocketPath ? 'unix' : 'stdio');
}
/** 供心跳上报使用：本进程的 app-server 客户端当前是否有存活的子进程/连接。不会触发启动。 */
export function isAppServerClientRunning() {
  return singleton?.isRunning?.() === true;
}
/** Shut down the singleton app-server child if one is running (worker cleanup). No-op otherwise. */
export function shutdownAppServerClient() {
  try { singleton?.shutdown(); } catch {}
  singleton = null;
}
export function resetAppServerClient() { shutdownAppServerClient(); } // test hook alias
