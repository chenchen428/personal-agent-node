#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import qrcodeTerminal from "qrcode-terminal";

const personalAgentHome = path.resolve(process.env.PERSONAL_AGENT_HOME || path.join(os.homedir(), ".personal-agent"));
const siteDataRoot = path.resolve(process.env.PRIVATE_SITE_DATA_ROOT || path.join(personalAgentHome, "workspace"));
loadServiceEnv(process.env.OPEN_AGENT_BRIDGE_ENV_FILE || path.join(siteDataRoot, "secrets", "applications", "site.env"));

const args = parseArgs(process.argv.slice(2));
const command = args._[0] || "help";
const subcommand = args._[1] || "";
const apiBase = (process.env.OPEN_AGENT_BRIDGE_API_BASE || `http://127.0.0.1:${process.env.OPEN_AGENT_BRIDGE_PORT || "8788"}`).replace(/\/+$/, "");
const token = process.env.OPEN_AGENT_BRIDGE_API_TOKEN || "";

try {
  if (command === "session" && (subcommand === "list" || subcommand === "search")) {
    const query = args.query || args.q || (subcommand === "search" ? args._.slice(2).join(" ") : "");
    if (subcommand === "search" && !query) throw new Error("--query is required");
    print(await listSessions({ query }));
  } else if (command === "session" && subcommand === "start") {
    const task = args.task || args.t || args._.slice(2).join(" ");
    if (!task) throw new Error("--task is required");
    const result = await post("/api/sessions", {
      task,
      title: args.title,
      parentSessionId: args.parent,
      workspaceRoot: args.workspace,
      createdBy: "oab-cli",
    });
    print(result.session);
  } else if (command === "session" && (subcommand === "input" || subcommand === "resume")) {
    const sessionId = args.session || args.s;
    const content = args.text || args.content || args._.slice(2).join(" ");
    if (!sessionId) throw new Error("--session is required");
    if (!content) throw new Error("--text is required");
    print(await post(`/api/sessions/${encodeURIComponent(sessionId)}/input`, {
      content,
      notifyWechat: args['notify-wechat'] === true,
    }));
  } else if (command === "session" && subcommand === "status") {
    const sessionId = args.session || args.s;
    if (!sessionId) throw new Error("--session is required");
    print((await get(`/api/sessions/${encodeURIComponent(sessionId)}`)).session);
  } else if (command === "memory" && subcommand === "sessions") {
    print(await get(`/api/memory-sessions?limit=${encodeURIComponent(args.limit || "200")}`));
  } else if (command === "memory" && subcommand === "list") {
    const params = memoryQueryParams({ defaultLimit: 50 });
    print(await get(`/api/memories?${params}`));
  } else if (command === "memory" && subcommand === "recall") {
    print(await post("/api/memories/recall", {
      sessionId: currentSessionId(),
      query: args.query || args.q || args._.slice(2).join(" "),
      type: args.type,
      limit: Number(args.limit || 8),
    }));
  } else if (command === "memory" && subcommand === "remember") {
    const content = args.content || args.text || args._.slice(2).join(" ");
    if (!content) throw new Error("--content is required");
    print((await post("/api/memories", {
      sessionId: currentSessionId(),
      type: args.type || "context",
      content,
    })).memory);
  } else if (command === "memory" && subcommand === "get") {
    const memoryId = args.id || args.memory;
    if (!memoryId) throw new Error("--id is required");
    print((await get(`/api/memories/${encodeURIComponent(memoryId)}`)).memory);
  } else if (command === "memory" && subcommand === "update") {
    const memoryId = args.id || args.memory;
    if (!memoryId) throw new Error("--id is required");
    const patchBody = {};
    if (args.type !== undefined) patchBody.type = args.type;
    if (args.content !== undefined || args.text !== undefined) patchBody.content = args.content || args.text;
    if (!Object.keys(patchBody).length) throw new Error("--type or --content is required");
    print((await patch(`/api/memories/${encodeURIComponent(memoryId)}`, patchBody)).memory);
  } else if (command === "memory" && (subcommand === "forget" || subcommand === "delete")) {
    const memoryId = args.id || args.memory;
    if (!memoryId) throw new Error("--id is required");
    print(await del(`/api/memories/${encodeURIComponent(memoryId)}`));
  } else if (command === "data" && subcommand === "schema") {
    if (args.object || args.table) print((await get(`/api/agent-data/objects/${encodeURIComponent(args.object || args.table)}`)).object);
    else print((await get("/api/agent-data/schema")).objects);
  } else if (command === "data" && subcommand === "status") {
    print((await get("/api/agent-data/status")).status);
  } else if (command === "data" && (subcommand === "sql" || subcommand === "query")) {
    const statement = args.statement || args.sql || (args.file ? fs.readFileSync(path.resolve(args.file), "utf8") : args._.slice(2).join(" "));
    if (subcommand === "sql") {
      if (!statement) throw new Error("--statement, --file, or SQL text is required");
      print((await post("/api/agent-data/sql", {
        sql: statement,
        actor: args.actor || "agent",
        sessionId: args.session || process.env.OPEN_AGENT_BRIDGE_SESSION_ID || "",
        runId: args.run || args.runId || "",
      })).result);
    } else {
      const object = args.object || args.table;
      if (!object) throw new Error("--object is required");
      const body = {
        object,
        search: args.search || "",
        page: { number: Number(args.page || 1), size: Number(args.limit || args.size || 50) },
      };
      if (args.field) body.filters = [{ field: args.field, operator: args.operator || "eq", value: args.value || "" }];
      if (args.sort) body.sort = [{ field: args.sort, direction: args.direction || "asc" }];
      if (args.group) body.groupBy = [args.group];
      if (args.aggregate) body.metrics = [{ function: args.aggregate, field: args.metric || "" }];
      print((await post("/api/agent-data/query", body)).result);
    }
  } else if (command === "data" && subcommand === "snapshots") {
    print((await get("/api/agent-data/snapshots")).snapshots);
  } else if (command === "data" && subcommand === "snapshot") {
    print((await post("/api/agent-data/snapshots", { reason: args.reason || "agent" })).snapshot);
  } else if (command === "data" && subcommand === "restore") {
    const snapshotId = args.id || args.snapshot;
    if (!snapshotId) throw new Error("--id is required");
    print((await post(`/api/agent-data/snapshots/${encodeURIComponent(snapshotId)}/restore`, {})).result);
  } else if (command === "data" && subcommand === "metadata") {
    if (!args.object) throw new Error("--object is required");
    print((await post("/api/agent-data/metadata", {
      objectName: args.object,
      fieldName: args.field || "",
      displayName: args.name || "",
      description: args.description || "",
      sensitivity: args.sensitivity || "private",
    })).metadata);
  } else if (command === "automation" && subcommand === "sources") {
    print((await get("/api/agent-automations/sources")).sources);
  } else if (command === "automation" && subcommand === "source") {
    const source = args.file ? JSON.parse(fs.readFileSync(path.resolve(args.file), "utf8")) : {
      id: args.id, name: args.name, kind: args.kind, accountRef: args.account,
      capabilities: String(args.capabilities || "").split(",").map((value) => value.trim()).filter(Boolean),
      sensitivity: args.sensitivity, enabled: !args.disabled,
    };
    print((await post("/api/agent-automations/sources", source)).source);
  } else if (command === "automation" && subcommand === "rules") {
    print((await get("/api/agent-automations/rules")).rules);
  } else if (command === "automation" && subcommand === "mail-policies") {
    print(await get(`/api/agent-automations/mail-protection?limit=${encodeURIComponent(args.limit || "100")}&offset=${encodeURIComponent(args.offset || "0")}`));
  } else if (command === "automation" && subcommand === "mail-policy") {
    const sender = args.sender || args.email;
    if (!sender || !args.policy) throw new Error("--sender and --policy are required");
    if (!["neutral", "trusted", "blocked"].includes(String(args.policy))) throw new Error("--policy must be neutral, trusted, or blocked");
    print((await post("/api/agent-automations/mail-policies", {
      sender,
      policy: args.policy,
      reason: args.reason || "Agent policy update",
      dailyLimit: args.limit ? Number(args.limit) : undefined,
      expiresAt: args.expires || undefined,
    })).policy);
  } else if (command === "automation" && subcommand === "rule") {
    const ruleId = args.id || args.rule;
    if (ruleId && !args.file && !args.name) print((await get(`/api/agent-automations/rules/${encodeURIComponent(ruleId)}`)).rule);
    else {
      const rule = args.file ? JSON.parse(fs.readFileSync(path.resolve(args.file), "utf8")) : {
        id: ruleId, name: args.name, description: args.description, sourceId: args.source,
        eventType: args.event || "message.received",
        conditions: args.conditions ? JSON.parse(args.conditions) : {},
        action: args.action ? JSON.parse(args.action) : {},
        permissions: args.permissions ? JSON.parse(args.permissions) : {},
        enabled: !args.disabled,
      };
      print(ruleId
        ? (await patch(`/api/agent-automations/rules/${encodeURIComponent(ruleId)}`, rule)).rule
        : (await post("/api/agent-automations/rules", rule)).rule);
    }
  } else if (command === "automation" && subcommand === "events") {
    print((await get(`/api/agent-automations/events?limit=${encodeURIComponent(args.limit || "100")}`)).events);
  } else if (command === "automation" && subcommand === "event") {
    const eventId = args.id || args.event;
    if (eventId && !args.file) print((await get(`/api/agent-automations/events/${encodeURIComponent(eventId)}`)).event);
    else {
      if (!args.file) throw new Error("--file is required to ingest an event");
      print(await post("/api/agent-automations/events", JSON.parse(fs.readFileSync(path.resolve(args.file), "utf8"))));
    }
  } else if (command === "automation" && subcommand === "event-replay") {
    const eventId = args.id || args.event;
    if (!eventId) throw new Error("--id is required");
    print(await post(`/api/agent-automations/events/${encodeURIComponent(eventId)}/replay`, { ruleId: args.rule || args.ruleId }));
  } else if (command === "automation" && subcommand === "runs") {
    print((await get(`/api/agent-automations/runs?limit=${encodeURIComponent(args.limit || "100")}`)).runs);
  } else if (command === "automation" && subcommand === "templates") {
    print((await get("/api/agent-automations/templates")).templates);
  } else if (command === "automation" && subcommand === "template") {
    if (args["source-file"]) {
      print((await post("/api/agent-automations/templates/install", {
        id: args.id,
        name: args.name,
        purpose: args.purpose,
        sourceFingerprint: args.fingerprint,
        source: fs.readFileSync(path.resolve(args["source-file"]), "utf8"),
      })).template);
    } else {
      if (!args.file) throw new Error("--file or --source-file is required");
      print((await post("/api/agent-automations/templates", JSON.parse(fs.readFileSync(path.resolve(args.file), "utf8")))).template);
    }
  } else if (command === "automation" && subcommand === "template-run") {
    const templateId = args.id || args.template;
    if (!templateId || !args["input-file"]) throw new Error("--id and --input-file are required");
    print((await post(`/api/agent-automations/templates/${encodeURIComponent(templateId)}/run`, {
      input: JSON.parse(fs.readFileSync(path.resolve(args["input-file"]), "utf8")),
      version: args.version ? Number(args.version) : undefined,
    })).result);
  } else if (command === "automation" && subcommand === "template-resolve") {
    if (!args.fingerprint) throw new Error("--fingerprint is required");
    print((await get(`/api/agent-automations/templates/resolve?sourceFingerprint=${encodeURIComponent(args.fingerprint)}`)).template);
  } else if (command === "automation" && ["template-activate", "template-rollback", "template-disable"].includes(subcommand)) {
    const templateId = args.id || args.template;
    if (!templateId) throw new Error("--id is required");
    if (subcommand === "template-rollback" && !args.version) throw new Error("--version is required");
    const action = subcommand.replace("template-", "");
    print((await post(`/api/agent-automations/templates/${encodeURIComponent(templateId)}/${action}`, {
      version: args.version ? Number(args.version) : undefined,
      reason: args.reason,
    })).template);
  } else if ((command === "cron" || command === "corn") && subcommand === "list") {
    print((await get("/api/agent-corn/tasks")).tasks);
  } else if ((command === "cron" || command === "corn") && subcommand === "create") {
    const prompt = args.prompt || args.task || args.content || args._.slice(2).join(" ");
    if (!args.name) throw new Error("--name is required");
    if (!args.cron && !args.schedule) throw new Error("--cron is required");
    if (!prompt) throw new Error("--prompt is required");
    print((await post("/api/agent-corn/tasks", {
      name: args.name,
      cron: args.cron || args.schedule,
      timezone: args.timezone,
      prompt,
      workspaceName: args.workspaceName || args.workspace,
      workspaceRoot: args.workspaceRoot,
      recipientId: args.recipient || args.recipientId,
      enabled: !args.disabled,
    })).task);
  } else if ((command === "cron" || command === "corn") && subcommand === "update") {
    const taskId = args.id || args.taskId || args.task;
    if (!taskId) throw new Error("--id is required");
    const patchBody = {};
    if (args.name !== undefined) patchBody.name = args.name;
    if (args.cron !== undefined || args.schedule !== undefined) patchBody.cron = args.cron || args.schedule;
    if (args.timezone !== undefined) patchBody.timezone = args.timezone;
    if (args.prompt !== undefined || args.content !== undefined) patchBody.prompt = args.prompt || args.content;
    if (args.workspaceName !== undefined || args.workspace !== undefined) patchBody.workspaceName = args.workspaceName || args.workspace;
    if (args.workspaceRoot !== undefined) patchBody.workspaceRoot = args.workspaceRoot;
    if (args.recipient !== undefined || args.recipientId !== undefined) patchBody.recipientId = args.recipient || args.recipientId;
    if (args.enabled) patchBody.enabled = true;
    if (args.disabled) patchBody.enabled = false;
    print((await patch(`/api/agent-corn/tasks/${encodeURIComponent(taskId)}`, patchBody)).task);
  } else if ((command === "cron" || command === "corn") && subcommand === "delete") {
    const taskId = args.id || args.taskId || args.task;
    if (!taskId) throw new Error("--id is required");
    print(await del(`/api/agent-corn/tasks/${encodeURIComponent(taskId)}`));
  } else if ((command === "cron" || command === "corn") && subcommand === "run") {
    const taskId = args.id || args.taskId || args.task;
    if (!taskId) throw new Error("--id is required");
    print(await post(`/api/agent-corn/tasks/${encodeURIComponent(taskId)}/run`, {}));
  } else if (command === "channel" && subcommand === "status") {
    const provider = channelProvider();
    print(await get(`/api/channels/${encodeURIComponent(provider)}/status`));
  } else if (command === "channel" && subcommand === "login") {
    const provider = channelProvider();
    if (!args.execute) {
      print({
        ok: true,
        execute: false,
        provider,
        confirmationRequired: true,
        action: "send-login-qrcode-to-wechat",
        next: "Run again with --execute only after the user explicitly replies 确认开始.",
      });
    } else {
      const login = await post(`/api/channels/${encodeURIComponent(provider)}/login`, {
        recipientId: args.recipient || args.recipientId,
      });
      if (login.status === "confirmed") {
        print({ ok: true, execute: true, provider, status: "confirmed", delivered: false, message: "Channel is already logged in." });
      } else {
        print({
          ok: true,
          execute: true,
          provider,
          status: login.status,
          session: login.session,
          expiresAt: login.expiresAt,
          delivered: login.delivered === true,
          monitoring: login.monitoring === true,
          next: "The bridge is monitoring automatically. If Xiaohongshu sends an SMS code, the user should reply with that code in WeChat.",
        });
      }
    }
  } else if (command === "channel" && subcommand === "login-status") {
    const provider = channelProvider();
    const loginSession = String(args.session || args.s || "").trim();
    if (!loginSession) throw new Error("--session is required");
    print(await get(`/api/channels/${encodeURIComponent(provider)}/login/status?session=${encodeURIComponent(loginSession)}`));
  } else if (command === "wechat" && subcommand === "status") {
    print((await get("/api/status")).wechat);
  } else if (command === "wechat" && subcommand === "login") {
    const login = await post("/api/channels/wechat/login/start", {});
    if (args.json) {
      print(login);
    } else {
      qrcodeTerminal.generate(login.qrContent, { small: true });
      console.log("Scan the QR code with WeChat. Waiting for confirmation...");
      const expiresAt = new Date(login.expiresAt).getTime();
      let connected = false;
      while (Date.now() < expiresAt) {
        await delay(2000);
        const status = await get(`/api/channels/wechat/login/status?session=${encodeURIComponent(login.session)}`);
        if (status.connected) {
          connected = true;
          console.log("WeChat connected.");
          break;
        }
        if (status.status === "expired" || status.status === "missing") throw new Error("WeChat login expired");
      }
      if (!connected) throw new Error("WeChat login expired");
    }
  } else if (command === "wechat" && subcommand === "send-file") {
    const filePath = resolveRegularFile(args.file || args.f);
    print(await post("/api/channels/wechat/send-file", {
      filePath,
      title: args.title,
      recipientId: args.recipient || args.recipientId,
    }));
  } else if (command === "wechat" && subcommand === "send-image") {
    const filePath = resolveRegularFile(args.file || args.f);
    print(await post("/api/channels/wechat/send-image", {
      filePath,
      caption: args.caption,
      recipientId: args.recipient || args.recipientId,
    }));
  } else if (command === "notify") {
    const message = args.message || args.text || args._.slice(1).join(" ");
    if (!message) throw new Error("--message is required");
    print(await post("/api/channels/wechat/notify", { message, recipientId: args.recipient || args.recipientId }));
  } else if ((command === "file" || command === "private-file") && subcommand === "link") {
    const filePath = args.file || args.f ? resolveRegularFile(args.file || args.f) : "";
    const relativePath = String(args.relative || "").trim();
    if (!filePath && !relativePath) throw new Error("--file or --relative is required");
    print(await post("/api/private-files/link", {
      filePath,
      relativePath,
      expiresSeconds: Number(args.expires || 3600),
    }));
  } else if (command === "file" && subcommand === "search") {
    const params = new URLSearchParams({
      query: args.query || args.q || args._.slice(2).join(" "),
      tier: args.tier || "all",
      limit: String(args.limit || 50),
    });
    if (args.visibility) params.set("visibility", args.visibility);
    if (args.source) params.set("source", args.source);
    print((await get(`/api/files/search?${params}`)).files);
  } else if (command === "file" && subcommand === "stat") {
    const objectId = args.id || args.object;
    if (!objectId) throw new Error("--id is required");
    print((await get(`/api/files/${encodeURIComponent(objectId)}`)).file);
  } else if (command === "file" && subcommand === "materialize") {
    const objectId = args.id || args.object;
    if (!objectId) throw new Error("--id is required");
    print((await post(`/api/files/${encodeURIComponent(objectId)}/materialize`, {
      ttlDays: durationDays(args.ttl || args.days || "7d", 7),
      taskId: args.task || args.taskId,
    })).file);
  } else if (command === "file" && subcommand === "pin") {
    const objectId = args.id || args.object;
    if (!objectId) throw new Error("--id is required");
    print((await post(`/api/files/${encodeURIComponent(objectId)}/pin`, {
      days: durationDays(args.days || args.ttl || "30d", 30),
      reason: args.reason,
    })).file);
  } else if (command === "file" && subcommand === "unpin") {
    const objectId = args.id || args.object;
    if (!objectId) throw new Error("--id is required");
    print((await post(`/api/files/${encodeURIComponent(objectId)}/unpin`, {})).file);
  } else if (command === "file" && subcommand === "gc") {
    print(await post("/api/files/gc", { execute: args.execute === true }));
  } else if (command === "file" && subcommand === "verify-storage") {
    print(await post("/api/files/verify-storage", { execute: args.execute === true }));
  } else if (command === "file" && subcommand === "reconcile") {
    const root = args.root || args.dir;
    if (!root) throw new Error("--root is required");
    const excludeRelativePaths = args["exclude-manifest"]
      ? readResourceExclusions(args["exclude-manifest"])
      : [];
    print(await post("/api/files/reconcile", {
      root: path.resolve(root),
      visibility: args.visibility || "private",
      source: args.source || "migration",
      prefix: args.prefix || "",
      excludeRelativePaths,
      execute: args.execute === true,
    }));
  } else if (command === "pages" && subcommand === "upload") {
    const file = args.file || args.f;
    if (!file) throw new Error("--file is required");
    const resolved = path.resolve(file);
    const content = fs.readFileSync(resolved);
    const result = await post(args.private ? "/api/publications/upload" : "/api/pages/upload", {
      fileName: args.name || path.basename(resolved),
      content: content.toString("base64"),
      encoding: "base64",
      folder: args.folder,
      publicationId: args.folder,
      mimeType: args.mime,
      overwrite: Boolean(args.overwrite),
    });
    print(args.private ? result.publication : result.asset);
  } else {
    help();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function get(pathname) {
  const response = await fetch(`${apiBase}${pathname}`, { headers: headers() });
  return readResponse(response);
}

async function post(pathname, body) {
  const response = await fetch(`${apiBase}${pathname}`, {
    method: "POST",
    headers: { ...headers(), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return readResponse(response);
}

async function patch(pathname, body) {
  const response = await fetch(`${apiBase}${pathname}`, {
    method: "PATCH",
    headers: { ...headers(), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return readResponse(response);
}

async function del(pathname) {
  const response = await fetch(`${apiBase}${pathname}`, {
    method: "DELETE",
    headers: headers(),
  });
  return readResponse(response);
}

async function readResponse(response) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok || data.ok === false) throw new Error(data.error || text || `HTTP ${response.status}`);
  return data;
}

function headers() {
  return token ? { authorization: `Bearer ${token}` } : {};
}

function print(value) {
  if (args.json) console.log(JSON.stringify(value, null, 2));
  else if (value?.url) console.log(value.url);
  else console.log(JSON.stringify(value, null, 2));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listSessions({ query = "" } = {}) {
  const limit = Math.min(Math.max(Number.parseInt(args.limit || "20", 10) || 20, 1), 50);
  let cursor = args.cursor || "";
  const sessions = [];
  let hasMore = false;
  do {
    const params = new URLSearchParams({ limit: String(limit), summary: "1" });
    if (query) params.set("query", query);
    if (cursor) params.set("cursor", cursor);
    if (args.archived) params.set("archived", "1");
    const page = await get(`/api/sessions?${params}`);
    sessions.push(...(page.sessions || []).map(sessionSummary));
    cursor = page.nextCursor || "";
    hasMore = Boolean(page.hasMore);
  } while (args.all && hasMore);
  return { sessions, nextCursor: cursor, hasMore };
}

function sessionSummary(session) {
  return {
    id: session.id,
    role: session.role,
    parentSessionId: session.parentSessionId,
    channel: session.channel,
    status: session.status,
    title: session.title,
    taskDescription: session.taskDescription,
    summary: session.summary,
    workspaceRoot: session.workspaceRoot,
    hasResumeThread: Boolean(session.cliSessionId),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    url: session.url,
    eventCount: Number(session.eventCount || 0),
    childSessionCount: Number(session.childSessionCount || 0),
  };
}

function resolveRegularFile(value) {
  if (!value) throw new Error("--file is required");
  const resolved = path.resolve(value);
  if (!fs.statSync(resolved).isFile()) throw new Error("--file must point to a regular file");
  return resolved;
}

function channelProvider() {
  const provider = String(args.provider || args._[2] || "xiaohongshu").trim().toLowerCase();
  if (provider !== "xiaohongshu") throw new Error(`Unsupported channel provider: ${provider}`);
  return provider;
}

function currentSessionId() {
  const sessionId = args.session || args.s || process.env.OPEN_AGENT_BRIDGE_SESSION_ID || "";
  if (!sessionId) throw new Error("--session is required outside an active Agent Bridge session");
  return sessionId;
}

function memoryQueryParams({ defaultLimit }) {
  const params = new URLSearchParams({
    sessionId: currentSessionId(),
    limit: String(args.limit || defaultLimit),
  });
  if (args.query || args.q) params.set("query", args.query || args.q);
  if (args.type) params.set("type", args.type);
  return params;
}

function help() {
  console.log(`Usage:
  open-abg session start --task "..." [--parent <session>] [--workspace <path>] [--json]
  open-abg session list [--query "..."] [--limit <n>] [--cursor <cursor>] [--all] [--json]
  open-abg session search --query "..." [--all] [--json]
  open-abg session input --session <id> --text "..." [--notify-wechat]
  open-abg session resume --session <id> --task "..."
  open-abg session status --session <id> [--json]
  open-abg memory sessions [--limit <n>] [--json]
  open-abg memory list [--session <id>] [--query "..."] [--type <type>] [--json]
  open-abg memory recall [--session <id>] [--query "..."] [--type <type>] [--limit <n>] [--json]
  open-abg memory remember [--session <id>] --type <preference|fact|decision|context|todo|instruction> --content "..."
  open-abg memory get --id <memory-id> [--json]
  open-abg memory update --id <memory-id> [--type <type>] [--content "..."]
  open-abg memory forget --id <memory-id>
  open-abg data status [--json]
  open-abg data schema [--object <table>] [--json]
  open-abg data sql --statement "<SQL>" [--session <id>] [--run <automation-run>] [--json]
  open-abg data sql --file <sql-file> [--json]
  open-abg data query --object <table> [--search <text>] [--field <column> --operator <op> --value <value>] [--group <column> --aggregate <fn> --metric <column>]
  open-abg data snapshots [--json]
  open-abg data snapshot [--reason <text>] [--json]
  open-abg data restore --id <snapshot-id> [--json]
  open-abg data metadata --object <table> [--field <column>] [--name <label>] [--description <text>] [--sensitivity <level>]
  open-abg automation sources [--json]
  open-abg automation source --file <source.json>
  open-abg automation rules [--json]
  open-abg automation mail-policies [--limit <n>] [--offset <n>] [--json]
  open-abg automation mail-policy --sender <email> --policy <neutral|trusted|blocked> --reason <text> [--limit <n>] [--expires <iso>]
  open-abg automation rule --id <rule-id> [--json]
  open-abg automation rule --file <rule.json>
  open-abg automation events [--limit <n>] [--json]
  open-abg automation event --id <event-id> [--json]
  open-abg automation event --file <event.json>
  open-abg automation event-replay --id <event-id> [--rule <rule-id>]
  open-abg automation runs [--limit <n>] [--json]
  open-abg automation templates [--json]
  open-abg automation template --file <template.json>
  open-abg automation template --source-file <parse.mjs> --name <name> [--id <id>] [--purpose <text>] [--fingerprint <value>]
  open-abg automation template-run --id <template-id> --input-file <input.json> [--version <n>]
  open-abg automation template-resolve --fingerprint <value>
  open-abg automation template-activate --id <template-id> [--version <n>] [--reason <text>]
  open-abg automation template-rollback --id <template-id> --version <n> [--reason <text>]
  open-abg automation template-disable --id <template-id> [--reason <text>]
  open-abg cron list [--json]
  open-abg cron create --name <name> --cron "0 9 * * *" --prompt "..." [--timezone <iana-zone>] [--workspace <name>] [--recipient <wechat-id>] [--json]
  open-abg cron update --id <task-id> [--name <name>] [--cron "..."] [--timezone <iana-zone>] [--prompt "..."] [--enabled|--disabled]
  open-abg cron delete --id <task-id>
  open-abg cron run --id <task-id> [--json]
  open-abg channel status xiaohongshu [--json]
  open-abg channel login xiaohongshu [--execute] [--recipient <wechat-id>] [--json]
  open-abg channel login-status xiaohongshu --session <login-session> [--json]
  open-abg wechat status [--json]
  open-abg wechat login [--json]
  open-abg wechat send-file --file <path> [--title <name>] [--recipient <wechat-id>]
  open-abg wechat send-image --file <path> [--caption "..."] [--recipient <wechat-id>]
  open-abg notify --message "..." [--recipient <wechat-id>]
  open-abg file link --file <private-file-path> [--expires <seconds>] [--json]
  open-abg file search [--query <text>] [--source <source>] [--visibility public|private] [--tier hot|cold|all]
  open-abg file stat --id <object-id> [--json]
  open-abg file materialize --id <object-id> [--ttl 7d] [--task <task-id>] [--json]
  open-abg file pin --id <object-id> [--days 30] [--reason <text>] [--json]
  open-abg file unpin --id <object-id> [--json]
  open-abg file gc [--dry-run] [--execute] [--json]
  open-abg file verify-storage [--execute] [--json]
  open-abg file reconcile --root <allowlisted-dir> --source <source> --visibility public|private [--prefix <path>] [--exclude-manifest <json>] [--execute] [--json]
  open-abg pages upload --file <path> [--folder <name>] [--private] [--json]`);
}

function durationDays(value, fallback) {
  const match = /^(\d+)(?:d)?$/i.exec(String(value || "").trim());
  if (!match) return fallback;
  return Math.min(Math.max(Number(match[1]) || fallback, 1), 3650);
}

function readResourceExclusions(filePath) {
  const resolved = path.resolve(String(filePath || ""));
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
  const files = Array.isArray(parsed) ? parsed : parsed.files;
  if (!Array.isArray(files) || files.some((item) => typeof item !== "string")) {
    throw new Error("exclude manifest must contain a files array of relative paths");
  }
  return files;
}

function loadServiceEnv(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("-")) {
      parsed._.push(arg);
      continue;
    }
    const key = arg.replace(/^--?/, "");
    if (key === "json" || key === "overwrite" || key === "private" || key === "enabled" || key === "disabled" || key === "all" || key === "archived" || key === "execute" || key === "notify-wechat") {
      parsed[key] = true;
      continue;
    }
    parsed[key] = argv[i + 1] || "";
    i += 1;
  }
  return parsed;
}
