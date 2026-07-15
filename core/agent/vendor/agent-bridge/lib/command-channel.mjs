import { normalizeAgentCommandAliases, resolveAgentCommandForCommand } from './agent-aliases.mjs';
import { runAppServerCommand, stopAppServerCommand, decideAppServerApproval, probeAppServerSessions, listLoadedAppServerThreadIds, enqueueSessionInput, takeNextQueuedInput, collapseQueuedInputs, hasQueuedInput, queuedInputsSnapshot } from './app-server-runner.mjs';
import { readCodexSessionHistory } from './session-history.mjs';
import { deriveAppServerTransport, shutdownAppServerClient } from './app-server-client.mjs';
import { listWorkspaceFiles } from './workspace-files.mjs';
import { normalizeWorkspaceEntries } from './workspace-registry.mjs';

const RUNNER_WS_PATH = '/api/agent-bridge/ws/runner';
const NORMAL_CLOSE = 1000;
const MIN_RECONNECT_MS = 2_000;
const MAX_RECONNECT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 12_000;
const HELLO_APP_SERVER_PROBE_TIMEOUT_MS = 5_000;

export function startCommandChannel(config, { log = console.error } = {}) {
  let stopped = false;
  let ws = null;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  const runningSessions = new Set();
  const cliSessionIds = new Map();

  const connect = async () => {
    if (stopped) return;
    const WebSocketImpl = await loadWebSocket();
    const url = buildRunnerWsUrl(config.baseUrl);
    ws = new WebSocketImpl(url);
    const socket = ws;

    // 连接看门狗:休眠 / 网络中断后 WS 可能既不 open 也不 close/error 地永久挂起,重连随之
    // 停摆、机器一直离线。超时仍未 open 就强制关闭并重连,让重连循环持续推进直至网络恢复。
    let connectWatchdog = setTimeout(() => {
      connectWatchdog = null;
      log('[agent-bridge-command] connect timeout, forcing reconnect');
      try { socket.close?.(); } catch {}
      if (ws === socket) ws = null;
      if (!stopped) scheduleReconnect();
    }, CONNECT_TIMEOUT_MS);
    connectWatchdog.unref?.();
    const clearConnectWatchdog = () => {
      if (connectWatchdog) { clearTimeout(connectWatchdog); connectWatchdog = null; }
    };

    ws.addEventListener?.('open', () => {
      clearConnectWatchdog();
      reconnectAttempt = 0;
      sendHello().catch((error) => {
        log(`[agent-bridge-command] hello failed: ${error.message}`);
        sendJson(ws, baseHelloPayload([]));
      });
      log(`[agent-bridge-command] connected ${url}`);
    });

    const sendHello = async () => {
      // 探测 app-server（懒启动 + initialize 可能很慢）：最多等 HELLO_APP_SERVER_PROBE_TIMEOUT_MS，
      // 超时按 unknown 上报并立即发 hello，避免 broker 迟迟不注册本机、命令无法投递。
      const probe = await Promise.race([
        listLoadedAppServerThreadIds(config)
          .then((ids) => ({ status: 'online', activeCliSessionIds: ids }))
          .catch(() => ({ status: 'offline', activeCliSessionIds: [] })),
        new Promise((resolve) => {
          const timer = setTimeout(() => resolve({ status: 'unknown', activeCliSessionIds: [] }), HELLO_APP_SERVER_PROBE_TIMEOUT_MS);
          timer.unref?.();
        }),
      ]);
      sendJson(ws, {
        ...baseHelloPayload(probe.activeCliSessionIds, probe.status),
      });
    };

    const baseHelloPayload = (activeCliSessionIds, appServerProbeStatus = 'unknown') => ({
        type: 'runner.hello',
        // Ground-truth set of sessions this worker is actively running right now. On a fresh worker this
        // is empty; on a plain WS reconnect it lists live turns so they're preserved.
        activeSessions: Array.from(runningSessions),
        activeCliSessionIds,
        workspaces: normalizeWorkspaceEntries(config),
        appServer: {
          status: appServerProbeStatus,
          transport: deriveAppServerTransport(config),
          socketPath: config.appServerSocketPath,
          lastCheckedAt: new Date().toISOString(),
        },
        capabilities: {
          commandChannel: 'v1',
          appServer: true,
          sessionProbe: true,
          sessionHistory: true,
          stop: true,
          authorizationDecision: true,
          agentCommandAliases: normalizeAgentCommandAliases(config).map((alias) => ({
            key: alias.key,
            label: alias.label,
            agentType: alias.agentType,
            transport: alias.transport,
            enabled: alias.enabled,
            isDefault: alias.isDefault,
          })),
        },
      });

    ws.addEventListener?.('message', (event) => {
      handleMessage(event.data).catch((error) => {
        log(`[agent-bridge-command] message failed: ${error.message}`);
      });
    });

    ws.addEventListener?.('close', () => {
      clearConnectWatchdog();
      if (ws === socket) ws = null;
      if (!stopped) scheduleReconnect();
    });

    ws.addEventListener?.('error', (event) => {
      clearConnectWatchdog();
      const detail = event?.message || event?.error?.message || 'websocket error';
      log(`[agent-bridge-command] ${detail}`);
    });
  };

  const handleMessage = async (raw) => {
    const message = parseJson(raw);
    if (!message) return;
    if (message.type === 'runner.probe') {
      await handleProbe(message);
      return;
    }
    if (message.type === 'runner.history') {
      await handleHistoryRequest(message);
      return;
    }
    if (message.type !== 'command.deliver') return;
    await handleCommand(message);
  };

  // 历史直读 RPC：broker 转发浏览器请求，worker 现场重建历史并原路返回，全程不落库。
  const handleHistoryRequest = async (message) => {
    const requestId = String(message.requestId || '');
    const sessionId = String(message.sessionId || '');
    if (!requestId) return;
    const workspaceRoot = typeof message.workspaceRoot === 'string' && message.workspaceRoot.trim()
      ? message.workspaceRoot.trim()
      : config.workspace;
    try {
      const result = await readCodexSessionHistory(
        { ...config, workspace: workspaceRoot },
        { sessionId, cliSessionId: message.cliSessionId },
        { log },
      );
      sendJson(ws, { type: 'runner.history.result', requestId, sessionId, messages: result.messages });
    } catch (error) {
      sendJson(ws, { type: 'runner.history.result', requestId, sessionId, messages: [], error: error instanceof Error ? error.message : String(error) });
    }
  };

  const handleProbe = async (message) => {
    const requestId = String(message.requestId || '');
    const results = await probeAppServerSessions(config, Array.isArray(message.sessions) ? message.sessions : [])
      .catch((error) => ({ error: error.message, results: [] }));
    sendJson(ws, {
      type: 'runner.probe.result',
      requestId,
      sessionProbes: Array.isArray(results) ? results : [],
      error: results && !Array.isArray(results) ? results.error : undefined,
    });
  };

  const handleCommand = async (message) => {
    const commandId = String(message.commandId || '');
    const sessionId = String(message.sessionId || message.payload?.sessionId || '');
    if (!commandId) return;

    sendJson(ws, {
      type: 'command.ack',
      commandId,
      payload: { ackedAt: new Date().toISOString() },
    });

    try {
      // Workspace-level queries are answered natively by the worker; no app-server turn needed.
      if (message.commandType === 'workspace.files') {
        const root = commandWorkspace(message, config);
        const listing = listWorkspaceFiles(root);
        sendJson(ws, {
          type: 'command.result',
          commandId,
          success: true,
          payload: { root, ...listing },
        });
        return;
      }

      await handleAppServerCommand(message, commandId, sessionId);
    } catch (error) {
      sendJson(ws, {
        type: 'command.result',
        commandId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const sendSessionEvent = (sessionId, kind, payload) => {
    sendJson(ws, {
      type: 'session.delta',
      sessionId,
      kind,
      payload,
    });
  };

  // Broadcast the current queued-message snapshot for the session so the web can render the「排队中」
  // list. Ephemeral (like runner.state): the broker re-broadcasts to browsers without persisting.
  const broadcastQueue = (sessionId) => {
    sendJson(ws, { type: 'session.queued', sessionId, items: queuedInputsSnapshot(sessionId) });
  };

  // Serial drain: when no runner is active for the session, start the next queued input as a fresh
  // turn. Runs entirely synchronously up to startAppServerRunner's `runningSessions.add`, so a command
  // arriving "concurrently" can never slip past the busy check and start a second turn.
  const maybeFlushNext = (sessionId) => {
    if (!sessionId || runningSessions.has(sessionId)) return; // a turn is active; it flushes in its finally
    const next = takeNextQueuedInput(sessionId);
    if (!next) return;
    broadcastQueue(sessionId);
    log(`[agent-bridge-command] flushing queued input for ${sessionId}`);
    // Internal flush: commandId=null -> no command.* lifecycle (the queued command was already resolved).
    startAppServerRunner(next.message, next.content, next.commandId).catch((error) => {
      log(`[agent-bridge-command] queued flush failed: ${error.message}`);
    });
  };

  // Forward a runner session event to the broker, capturing the cliSessionId (= app-server thread id).
  const forwardEvent = (event) => {
    const nextCliSessionId = event.payload?.cliSessionId;
    if (typeof nextCliSessionId === 'string' && nextCliSessionId.trim()) {
      cliSessionIds.set(event.sessionId, nextCliSessionId.trim());
    }
    sendSessionEvent(event.sessionId, event.kind, event.payload);
  };

  // Drive every remote action through the long-lived codex app-server thread.
  const handleAppServerCommand = async (message, commandId, sessionId) => {
    if (message.commandType === 'session.stop') {
      // flushQueued: interrupt the current turn AND send all queued messages at once (merged into one
      // turn). Collapse the queue BEFORE the interrupt so the finally-flush picks up the single merged
      // item; if idle (no active turn), kick the flush directly.
      const flushQueued = message.payload?.flushQueued === true && sessionId && hasQueuedInput(sessionId);
      if (flushQueued) collapseQueuedInputs(sessionId);
      const stopped = sessionId ? stopAppServerCommand(sessionId) : false;
      if (flushQueued) {
        broadcastQueue(sessionId);
        if (!stopped) maybeFlushNext(sessionId); // idle: no turn to interrupt, flush the merged item now
      }
      sendJson(ws, { type: 'runner.state', sessionId, state: stopped ? 'stopping' : 'not_found', commandId });
      sendJson(ws, { type: 'command.result', commandId, success: true, payload: { stopped, flushedQueued: flushQueued } });
      return;
    }
    if (message.commandType === 'authorization.decide') {
      const decided = sessionId ? decideAppServerApproval(sessionId, safePayload(message.payload)) : false;
      sendJson(ws, decided
        ? { type: 'command.result', commandId, success: true, payload: { mode: 'app-server.approval' } }
        : { type: 'command.result', commandId, success: false, error: 'no pending approval for session', payload: { sessionId } });
      return;
    }
    if (message.commandType === 'session.input') {
      const content = extractCommandContent(message.payload);
      // Busy (a turn is running) -> queue the message and run it after the current turn completes
      // (serial execution). The queued command is resolved now; its turn runs later via maybeFlushNext.
      if (sessionId && runningSessions.has(sessionId)) {
        const snapshot = enqueueSessionInput(sessionId, { id: commandId, content, message, commandId: null });
        broadcastQueue(sessionId);
        log(`[agent-bridge-command] queued input for ${sessionId} (queue depth ${snapshot?.length ?? '?'})`);
        sendJson(ws, { type: 'command.result', commandId, success: true, payload: { mode: 'queued' } });
        return;
      }
      await startAppServerRunner(message, content || 'Continue the session.', commandId);
      return;
    }
    if (message.commandType === 'session.start') {
      const content = extractCommandContent(message.payload)
        || String(message.payload?.taskDescription || '')
        || 'Start a new Agent Bridge session.';
      await startAppServerRunner(message, content, commandId);
      return;
    }
    sendJson(ws, { type: 'command.result', commandId, success: false, error: `unsupported command type: ${message.commandType}` });
  };

  // commandId may be null for an internal queue flush (the queued command was already resolved as
  // `mode:queued`), in which case the command.* lifecycle messages are skipped — the turn still streams
  // session events and runner.state, and session.status='running' keeps the web's running indicator on.
  const startAppServerRunner = async (message, content, commandId) => {
    const sessionId = String(message.sessionId || message.payload?.sessionId || `codex-${Date.now()}`);
    // Safety net: never run two turns for one session concurrently. If busy, queue instead (no message
    // is ever dropped — the old "runner already active" hard-reject is gone).
    if (runningSessions.has(sessionId)) {
      enqueueSessionInput(sessionId, { id: commandId || `flush-${sessionId}`, content, message, commandId: null });
      broadcastQueue(sessionId);
      if (commandId) sendJson(ws, { type: 'command.result', commandId, success: true, payload: { mode: 'queued' } });
      return;
    }
    runningSessions.add(sessionId);
    sendJson(ws, { type: 'runner.state', sessionId, state: 'running', commandId });
    if (commandId) sendJson(ws, { type: 'command.running', commandId, payload: { state: 'running', sessionId } });
    try {
      const cliSessionId = message.payload?.cliSessionId || cliSessionIds.get(sessionId);
      const resolved = resolveAgentCommandForCommand(config, message, { resume: false, cliSessionId });
      // Per-session picker overrides forwarded from the web (model / reasoning / approval / sandbox).
      const ctrl = message.payload || {};
      const controls = {
        ...(typeof ctrl.model === 'string' && ctrl.model.trim() ? { appServerModel: ctrl.model.trim() } : {}),
        ...(typeof ctrl.reasoningEffort === 'string' && ctrl.reasoningEffort.trim() ? { appServerReasoningEffort: ctrl.reasoningEffort.trim() } : {}),
        ...(typeof ctrl.approvalPolicy === 'string' && ctrl.approvalPolicy.trim() ? { appServerApprovalPolicy: ctrl.approvalPolicy.trim() } : {}),
        ...(typeof ctrl.sandbox === 'string' && ctrl.sandbox.trim() ? { appServerSandbox: ctrl.sandbox.trim() } : {}),
        ...(ctrl.collaborationMode === 'plan' || ctrl.collaborationMode === 'default' ? { appServerCollaborationMode: ctrl.collaborationMode } : {}),
      };
      const result = await runAppServerCommand({
        ...config,
        ...controls,
        workspace: commandWorkspace(message, config),
        workspaceName: typeof message.payload?.workspaceName === 'string' ? message.payload.workspaceName : config.workspaceName,
        allowCreateThread: message.payload?.allowCreateThread === true,
        sessionId,
        command: resolved.command,
        agentType: resolved.alias.agentType,
        agentAlias: resolved.alias.key,
        agentCommandAliases: normalizeAgentCommandAliases(config),
        cliSessionId,
        taskDescription: String(message.payload?.taskDescription || content).slice(0, 200),
        source: 'agent-bridge-ui',
        stdin: content,
        onSessionEvent: forwardEvent,
      });
      if (commandId) sendJson(ws, { type: 'command.result', commandId, success: true, payload: result });
    } catch (error) {
      if (commandId) sendJson(ws, { type: 'command.result', commandId, success: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      runningSessions.delete(sessionId);
      sendJson(ws, { type: 'runner.state', sessionId, state: 'idle', commandId });
      // Serial drain: start the next queued input (if any) now that this turn is done.
      maybeFlushNext(sessionId);
    }
  };

  const scheduleReconnect = () => {
    if (reconnectTimer || stopped) return;
    reconnectAttempt += 1;
    const delay = Math.min(MAX_RECONNECT_MS, MIN_RECONNECT_MS * reconnectAttempt);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect().catch((error) => {
        log(`[agent-bridge-command] reconnect failed: ${error.message}`);
        scheduleReconnect();
      });
    }, delay);
    reconnectTimer.unref?.();
  };

  connect().catch((error) => {
    log(`[agent-bridge-command] connect failed: ${error.message}`);
    scheduleReconnect();
  });

  return {
    stop() {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try { ws?.close?.(NORMAL_CLOSE, 'worker stopped'); } catch {}
      try { shutdownAppServerClient(); } catch {}
    },
  };
}

function commandWorkspace(message, config) {
  return typeof message.payload?.workspaceRoot === 'string' && message.payload.workspaceRoot.trim()
    ? message.payload.workspaceRoot.trim()
    : config.workspace;
}

async function loadWebSocket() {
  if (globalThis.WebSocket) return globalThis.WebSocket;
  const mod = await import('ws');
  return mod.WebSocket || mod.default;
}

function buildRunnerWsUrl(baseUrl) {
  const url = new URL(baseUrl);
  const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol === 'https:') url.protocol = 'wss:';
  else if (url.protocol === 'http:' && isLocalhost) url.protocol = 'ws:';
  else if (url.protocol === 'http:' && process.env.AGENT_BRIDGE_ALLOW_INSECURE_WS === '1') url.protocol = 'ws:';
  else throw new Error('Agent Bridge command WS requires an https baseUrl outside local development');
  url.pathname = RUNNER_WS_PATH;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function sendJson(ws, payload) {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify(payload));
}

function parseJson(raw) {
  try {
    const text = typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractCommandContent(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const value = payload.content ?? payload.initialInput ?? payload.text ?? payload.message;
  return typeof value === 'string' ? value.trim() : '';
}

function safePayload(payload) {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
}
