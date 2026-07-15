import { WebSocketServer } from "ws";

const RUNNER_WS_PATH = "/api/agent-bridge/ws/runner";

export class AgentBridgeBroker {
  constructor({ store, hub, logger = console }) {
    this.store = store;
    this.hub = hub;
    this.logger = logger;
    this.runnerSocket = null;
    this.runnerStatus = "offline";
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on("connection", (socket) => this.attachRunnerSocket(socket));
  }

  close() {
    if (this.runnerSocket?.socket) {
      try { this.runnerSocket.socket.close(); } catch {
        // Best effort cleanup for tests and process shutdown.
      }
    }
    this.runnerSocket = null;
    this.runnerStatus = "offline";
    this.wss.close();
  }

  status() {
    return { status: this.runnerStatus };
  }

  handleUpgrade(request, socket, head) {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (url.pathname !== RUNNER_WS_PATH) return false;
    this.wss.handleUpgrade(request, socket, head, (ws) => this.wss.emit("connection", ws, request));
    return true;
  }

  async handleRequest(request, response, url) {
    if (url.pathname === "/api/agent-bridge/workspaces" && request.method === "GET") {
      sendJson(response, 200, {
        ok: true,
        workspaces: this.store.listWorkspaces().map(publicWorkspace),
      });
      return true;
    }

    if (url.pathname === "/api/agent-bridge/workspaces" && request.method === "POST") {
      const body = await readJsonBody(request);
      const workspace = this.store.upsertWorkspace(body);
      sendJson(response, 200, { ok: true, workspace: publicWorkspace(workspace) });
      return true;
    }

    if (url.pathname === "/api/agent-bridge/heartbeat" && request.method === "POST") {
      const body = await readJsonBody(request);
      const workspaces = this.store.upsertWorkspacesFromHeartbeat(body);
      sendJson(response, 200, {
        ok: true,
        runner: { status: this.runnerStatus },
        workspaces: workspaces.map(publicWorkspace),
      });
      return true;
    }

    if (url.pathname === "/api/agent-bridge/sessions" && request.method === "GET") {
      const sessions = this.store.listSessions({ includeArchived: true });
      sendJson(response, 200, { ok: true, sessions: sessions.map(publicSession) });
      return true;
    }

    if (url.pathname === "/api/agent-bridge/sessions" && request.method === "POST") {
      const body = await readJsonBody(request);
      const session = this.createBrokerSession(body);
      sendJson(response, 200, { ok: true, session: publicSession(session) });
      return true;
    }

    const sessionMatch = /^\/api\/agent-bridge\/sessions\/([^/]+)$/.exec(url.pathname);
    if (sessionMatch && request.method === "GET") {
      const session = this.store.getSession(decodeURIComponent(sessionMatch[1]));
      if (!session) sendJson(response, 404, { ok: false, error: "session not found" });
      else sendJson(response, 200, {
        ok: true,
        session: publicSession(session),
        commands: this.store.listCommands({ sessionId: session.id }).map(publicCommand),
      });
      return true;
    }

    const actionMatch = /^\/api\/agent-bridge\/sessions\/([^/]+)\/actions$/.exec(url.pathname);
    if (actionMatch && request.method === "POST") {
      const sessionId = decodeURIComponent(actionMatch[1]);
      const body = await readJsonBody(request);
      const result = await this.dispatchSessionAction(sessionId, body);
      sendJson(response, 200, {
        ok: true,
        ...result,
        command: publicCommand(result.command),
        session: publicSession(result.session),
      });
      return true;
    }

    return false;
  }

  createBrokerSession(body) {
    const workspaceName = String(body.workspaceName || body.workspace || "").trim();
    const workspace = this.resolveWorkspace({ name: workspaceName });
    return this.store.createSession({
      role: "worker",
      parentSessionId: body.parentSessionId || null,
      title: body.title || body.taskDescription || body.content || "Agent Bridge session",
      taskDescription: body.taskDescription || body.task || body.content || "",
      workspaceRoot: body.workspaceRoot || workspace?.workspaceRoot || process.cwd(),
      status: body.action === "new" ? "idle" : "start",
      metadata: {
        workspaceName: workspaceName || workspace?.name || "",
        agentAlias: body.agentAlias || "codex",
        source: "agent-bridge-broker",
      },
    });
  }

  async dispatchSessionAction(sessionId, body) {
    const session = this.store.getSession(sessionId);
    if (!session) throw new Error("session not found");
    const action = String(body.action || "send");
    const content = String(body.content || body.text || body.message || "").trim();
    const commandType = commandTypeForAction(action, session);
    const payload = {
      sessionId,
      content,
      initialInput: content,
      taskDescription: session.taskDescription || content,
      workspaceRoot: body.workspaceRoot || session.workspaceRoot,
      workspaceName: body.workspaceName || session.metadata?.workspaceName || "",
      agentAlias: body.agentAlias || session.metadata?.agentAlias || "codex",
      cliSessionId: session.cliSessionId || undefined,
      allowCreateThread: commandType === "session.start",
      ...(body.payload && typeof body.payload === "object" ? body.payload : {}),
    };
    const command = this.store.createCommand({
      sessionId,
      commandType,
      payload,
    });
    const delivered = this.deliverCommand(command);
    const nextCommand = this.store.updateCommand(command.id, { status: delivered ? "delivered" : "queued" });
    if (content && action === "send") {
      this.store.appendEvent(sessionId, "session.user_message", {
        content,
        source: "agent-bridge-ui",
        metadata: { commandId: command.id, action },
      });
    }
    this.hub.broadcast({ type: "session.updated", session: this.store.getSessionRecord(sessionId) });
    return { command: nextCommand, delivered, session: this.store.getSession(sessionId) };
  }

  attachRunnerSocket(socket) {
    socket.on("message", (raw) => {
      const message = parseJson(raw);
      if (!message) return;
      try {
        if (message.type === "runner.hello") {
          if (this.runnerSocket?.socket && this.runnerSocket.socket !== socket) {
            try { this.runnerSocket.socket.close(); } catch {
              // Best effort cleanup before replacing the single local runner.
            }
          }
          this.runnerSocket = { socket };
          this.runnerStatus = "online";
          if (Array.isArray(message.workspaces)) {
            this.store.upsertWorkspacesFromHeartbeat({
              appServer: message.appServer,
              agentCommandAliases: message.capabilities?.agentCommandAliases,
              workspaces: message.workspaces,
            });
          }
          this.flushQueuedCommands();
          return;
        }
        this.handleRunnerMessage(message);
      } catch (error) {
        this.logger.error?.(`[agent-bridge-broker] runner message failed: ${error.message}`);
      }
    });

    socket.on("close", () => {
      if (this.runnerSocket?.socket === socket) {
        this.runnerSocket = null;
        this.runnerStatus = "offline";
      }
    });
  }

  handleRunnerMessage(message) {
    if (message.type === "command.ack") {
      this.store.updateCommand(message.commandId, { status: "acked" });
      return;
    }
    if (message.type === "command.running") {
      this.store.updateCommand(message.commandId, { status: "running", result: message.payload || {} });
      return;
    }
    if (message.type === "command.result") {
      this.store.updateCommand(message.commandId, {
        status: message.success === false ? "failed" : "done",
        result: message.payload || {},
        error: message.error || "",
      });
      return;
    }
    if (message.type === "runner.state") {
      const status = message.state === "running" ? "running" : message.state === "stopping" ? "paused" : "idle";
      this.store.updateSession(message.sessionId, { status });
      this.hub.broadcast({ type: "session.updated", session: this.store.getSessionRecord(message.sessionId) });
      return;
    }
    if (message.type === "session.delta") {
      const event = this.store.appendEvent(message.sessionId, message.kind, {
        ...(message.payload || {}),
        metadata: message.payload?.metadata || {},
      });
      this.hub.broadcast({ type: "session.delta", event, session: this.store.getSessionRecord(message.sessionId) });
      return;
    }
    if (message.type === "session.queued") {
      this.hub.broadcast({ type: "session.queued", sessionId: message.sessionId, items: message.items || [] });
    }
  }

  deliverCommand(command) {
    const runner = this.firstOnlineSocket();
    if (!runner?.socket || runner.socket.readyState !== 1) return false;
    runner.socket.send(JSON.stringify({
      type: "command.deliver",
      commandId: command.id,
      commandType: command.commandType,
      sessionId: command.sessionId,
      payload: command.payload,
    }));
    return true;
  }

  flushQueuedCommands() {
    for (const command of this.store.listCommands()) {
      if (command.status !== "queued") continue;
      if (this.deliverCommand(command)) {
        this.store.updateCommand(command.id, { status: "delivered" });
      }
    }
  }

  firstOnlineSocket() {
    return this.runnerSocket;
  }

  resolveWorkspace({ name }) {
    const workspaceName = String(name || "").trim();
    if (workspaceName) {
      const exact = this.store.getWorkspace({ name: workspaceName });
      if (exact) return exact;
    }
    const workspaces = this.store.listWorkspaces();
    if (workspaceName) return workspaces.find((workspace) => workspace.name === workspaceName) || null;
    return workspaces[0] || null;
  }
}

function commandTypeForAction(action, session) {
  if (action === "stop") return "session.stop";
  if (action === "authorization.decide") return "authorization.decide";
  return session.cliSessionId ? "session.input" : "session.start";
}

function publicWorkspace(workspace) {
  if (!workspace) return null;
  return workspace;
}

function publicSession(session) {
  if (!session) return null;
  return {
    ...session,
    metadata: publicMetadata(session.metadata),
    messages: Array.isArray(session.messages) ? session.messages.map(publicMessage) : session.messages,
    events: Array.isArray(session.events) ? session.events.map(publicEvent) : session.events,
  };
}

function publicCommand(command) {
  if (!command) return null;
  return command;
}

function publicMessage(message) {
  return message ? { ...message, metadata: publicMetadata(message.metadata) } : message;
}

function publicEvent(event) {
  if (!event) return event;
  const payload = event.payload && typeof event.payload === "object"
    ? publicPayload(event.payload)
    : event.payload;
  return { ...event, payload };
}

function publicPayload(payload) {
  const publicRow = { ...payload, metadata: publicMetadata(payload.metadata) };
  return publicRow;
}

function publicMetadata(metadata) {
  return { ...(metadata || {}) };
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function parseJson(raw) {
  try {
    const text = typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload, null, 2));
}
