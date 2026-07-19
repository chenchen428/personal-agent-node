#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import qrcodeTerminal from "qrcode-terminal";
import { ingestRawEmail, MAX_MAIL_BYTES } from "../src/connections/mail/mail-ingest.js";
import { normalizeTaskCreate, normalizeTaskPatch } from "../src/server/task-contract.js";

const personalAgentHome = path.resolve(process.env.PERSONAL_AGENT_HOME || path.join(os.homedir(), ".personal-agent"));
const siteDataRoot = path.resolve(process.env.PRIVATE_SITE_DATA_ROOT || path.join(personalAgentHome, "workspace"));
loadServiceEnv(process.env.OPEN_AGENT_BRIDGE_ENV_FILE || path.join(siteDataRoot, "secrets", "applications", "site.env"));

const args = parseArgs(process.argv.slice(2));
const command = args._[0] || "help";
const subcommand = args._[1] || "";
const apiBase = (process.env.OPEN_AGENT_BRIDGE_API_BASE || `http://127.0.0.1:${process.env.OPEN_AGENT_BRIDGE_PORT || "8788"}`).replace(/\/+$/, "");
const token = process.env.OPEN_AGENT_BRIDGE_API_TOKEN || "";

try {
  if (command === "mail" && subcommand === "ingest") {
    const chunks = [];
    let totalBytes = 0;
    for await (const chunk of process.stdin) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > MAX_MAIL_BYTES) throw new Error(`email exceeds ${MAX_MAIL_BYTES} bytes`);
      chunks.push(buffer);
    }
    const result = await ingestRawEmail(Buffer.concat(chunks), {
      dataDir: process.env.OPEN_AGENT_BRIDGE_MAIL_DATA_DIR || path.join(siteDataRoot, "mail"),
      apiBase,
      apiToken: process.env.OPEN_AGENT_BRIDGE_MAIL_INGEST_TOKEN || "",
      envelopeRecipient: args.recipient || "",
      envelopeSender: args.sender || "",
    });
    print({ ok: true, sha256: result.sha256, queuedForIntervalScan: result.queuedForIntervalScan === true });
  } else if (command === "memory") {
    throw new Error("The legacy Memory domain has been removed; the verified main Agent must use pa-cli activity");
  } else if (command === "automation") {
    throw new Error("The standalone automation product has been removed; use pa-cli cron for task-based automation");
  } else if (command === "session" && (subcommand === "list" || subcommand === "search")) {
    const query = args.query || args.q || (subcommand === "search" ? args._.slice(2).join(" ") : "");
    if (subcommand === "search" && !query) throw new Error("--query is required");
    print(await listSessions({ query }));
  } else if (command === "session" && subcommand === "start") {
    const task = readTaskArgument({
      inline: args.task || args.t,
      positionals: args._.slice(2),
      file: args["task-file"],
    });
    if (!task) throw new Error("--task is required");
    const metadata = normalizeTaskCreate({
      parentSessionId: args.parent,
      title: args.title,
      description: args.description || args.desc,
      task,
    });
    const result = await post("/api/sessions", {
      task: metadata.task,
      title: metadata.title || undefined,
      description: metadata.description || undefined,
      parentSessionId: metadata.parentSessionId || undefined,
      workspaceRoot: args.workspace,
      createdBy: "pa-cli",
    });
    print(result.session);
  } else if (command === "session" && subcommand === "update") {
    const sessionId = args.session || args.s;
    if (!sessionId) throw new Error("--session is required");
    const metadata = normalizeTaskPatch({
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.description !== undefined || args.desc !== undefined ? { description: args.description || args.desc } : {}),
    });
    print((await patch(`/api/sessions/${encodeURIComponent(sessionId)}`, metadata)).session);
  } else if (command === "session" && (subcommand === "input" || subcommand === "resume")) {
    const sessionId = args.session || args.s;
    const content = readTaskArgument({
      inline: args.text || args.content || args.task || args.t,
      positionals: args._.slice(2),
      file: args["task-file"],
    });
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
  } else if (command === "connection" && subcommand === "list") {
    print((await get("/api/connections")).connections);
  } else if (command === "connection" && subcommand === "inspect") {
    const connectionId = String(args._[2] || args.id || "").trim();
    if (!connectionId) throw new Error("connection id is required");
    const catalog = (await get("/api/connections")).connections || [];
    const connection = catalog.find((item) => item.id === connectionId);
    if (!connection) throw new Error(`Unknown connection: ${connectionId}`);
    print(connection);
  } else if (command === "connection" && ["wechat", "wechat-personal", "xiaohongshu", "twitter", "notion", "mail", "sites"].includes(subcommand)) {
    const connectionId = subcommand;
    const operation = String(args._[2] || "status").trim();
    if (connectionId === "wechat" && operation === "qianxun") print(await qianxunConnectionCommand(args));
    else if (connectionId === "wechat-personal") print(await personalWechatConnectionCommand(args));
    else if (operation === "status") print((await get(`/api/connections/${encodeURIComponent(connectionId)}/status`)).connection);
    else if (connectionId === "notion" && operation === "connect") print(await post("/api/connections/notion/login/start", {}));
    else if (connectionId === "notion" && operation === "poll") print(await post("/api/connections/notion/login/poll", {}));
    else if (connectionId === "mail" && operation === "scan") print(await post("/api/connections/mail/scan", {}));
    else if (connectionId === "mail" && operation === "history") print(await get(`/api/mail/messages?limit=${encodeURIComponent(args.limit || "50")}`));
    else if (connectionId === "wechat" && operation === "connect") print(await post("/api/channels/wechat/login/start", {}));
    else if (connectionId === "wechat" && operation === "send-file") print(await post("/api/channels/wechat/send-file", {
      filePath: resolveRegularFile(args.file || args.f), title: args.title, recipientId: args.recipient || args.recipientId,
    }));
    else if (connectionId === "wechat" && operation === "send-image") print(await post("/api/channels/wechat/send-image", {
      filePath: resolveRegularFile(args.file || args.f), caption: args.caption, recipientId: args.recipient || args.recipientId,
    }));
    else if (connectionId === "xiaohongshu" && (operation === "open" || operation === "connect")) {
      const result = await post("/api/connections/xiaohongshu/open", {});
      print(operation === "connect" ? { ...result, deprecatedAlias: "connect", connectionCreated: false } : result);
    }
    else if (connectionId === "xiaohongshu" && operation === "search") {
      const keyword = String(args.keyword || args.query || args.q || args._.slice(3).join(" ")).trim();
      if (!keyword) throw new Error("--keyword is required");
      print(await post("/api/connections/xiaohongshu/search", { keyword }));
    } else if (connectionId === "xiaohongshu" && operation === "read") {
      const url = String(args.url || "").trim();
      const feedId = String(args["feed-id"] || args.feedId || args.id || "").trim();
      const xsecToken = String(args["xsec-token"] || args.xsecToken || "").trim();
      if (!url && (!feedId || !xsecToken)) throw new Error("--url or both --feed-id and --xsec-token are required");
      print(await post("/api/connections/xiaohongshu/read", url ? { url } : { feedId, xsecToken }));
    } else if (connectionId === "twitter" && (operation === "open" || operation === "connect")) {
      const result = await post("/api/connections/twitter/open", {});
      print(operation === "connect" ? { ...result, deprecatedAlias: "connect", connectionCreated: false } : result);
    } else if (connectionId === "twitter" && operation === "search") {
      const query = String(args.query || args.keyword || args.q || args._.slice(3).join(" ")).trim();
      if (!query) throw new Error("--query is required");
      print(await post("/api/connections/twitter/search", { query }));
    } else if (connectionId === "twitter" && operation === "read") {
      const url = String(args.url || "").trim();
      const tweetId = String(args["tweet-id"] || args.tweetId || args.id || "").trim();
      if (!url && !tweetId) throw new Error("--url or --tweet-id is required");
      print(await post("/api/connections/twitter/read", url ? { url } : { tweetId }));
    } else if (connectionId === "sites" && operation === "list") print((await get("/api/pages")).assets || []);
    else if (connectionId === "sites" && operation === "tunnel-status") print((await get("/api/connections/sites/status")).connection);
    else if (["mail", "sites"].includes(connectionId) && ["use-platform-domain", "remove-platform-domain"].includes(operation)) print({
      ok: true,
      connectionId,
      confirmationRequired: true,
      setupAction: operation === "use-platform-domain" ? "connectivity.managed-authorize" : "connectivity.managed-disconnect",
      command: `pa-cli connection ${connectionId} ${operation}`,
      next: operation === "use-platform-domain"
        ? "Authenticate with personal-agent.cn after confirming the platform-domain and secure-tunnel change."
        : "Remove the local binding after confirmation; Workspace data and Cloud enrollment are preserved.",
    });
    else if (["mail", "sites"].includes(connectionId) && operation === "use-custom-domain") {
      const domain = String(args.domain || "").trim();
      if (!domain) throw new Error("--domain is required");
      print({ ok: true, connectionId, confirmationRequired: true, risk: "R2", setupAction: "connectivity.custom-domain-start", input: { kind: connectionId, domain }, command: `pa-cli connection ${connectionId} use-custom-domain`, next: "Approve the domain-bound plan, follow the Relay and DNS preparation guide, then run verification." });
    }
    else if (["mail", "sites"].includes(connectionId) && operation === "verify-custom-domain") print(await post(`/api/connections/${connectionId}/domain-binding`, { binding: "custom", deadlineAt: new Date(Date.now() + 3 * 60_000).toISOString() }));
    else if (["mail", "sites"].includes(connectionId) && operation === "remove-custom-domain") print({ ok: true, connectionId, confirmationRequired: true, risk: "R2", setupAction: "connectivity.custom-domain-remove", input: { kind: connectionId }, command: `pa-cli connection ${connectionId} remove-custom-domain`, next: "Approve removal in the authenticated local Console; Workspace data remains local." });
    else throw new Error(`Unsupported connection operation: ${connectionId} ${operation}`);
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
  } else if (command === "pages" && subcommand === "publish") {
    const file = args.file || args.f;
    const desktopThumbnailFile = args["desktop-thumbnail"];
    const mobileThumbnailFile = args["mobile-thumbnail"];
    const folder = args.folder;
    if (!file) throw new Error("--file is required");
    if (!desktopThumbnailFile || !mobileThumbnailFile) {
      throw new Error("HTML publishing requires --desktop-thumbnail <png> and --mobile-thumbnail <png>");
    }
    if (!folder) throw new Error("HTML publishing requires --folder <stable-name>");
    const resolved = path.resolve(file);
    const resolvedDesktopThumbnail = path.resolve(desktopThumbnailFile);
    const resolvedMobileThumbnail = path.resolve(mobileThumbnailFile);
    if (!/\.html?$/i.test(resolved)) throw new Error("pages publish requires an HTML file");
    if (!/\.png$/i.test(resolvedDesktopThumbnail) || !/\.png$/i.test(resolvedMobileThumbnail)) {
      throw new Error("pages publish requires PNG desktop and mobile thumbnails");
    }
    const content = fs.readFileSync(resolved);
    const desktopThumbnail = fs.readFileSync(resolvedDesktopThumbnail);
    const mobileThumbnail = fs.readFileSync(resolvedMobileThumbnail);
    const result = await post(args.private ? "/api/publications/publish" : "/api/pages/publish", {
      fileName: args.name || path.basename(resolved),
      content: content.toString("base64"),
      encoding: "base64",
      folder,
      publicationId: folder,
      mimeType: args.mime || "text/html; charset=utf-8",
      overwrite: Boolean(args.overwrite),
      title: args.title || path.basename(resolved, path.extname(resolved)),
      summary: args.summary || "",
      desktopThumbnail: {
        fileName: args["desktop-thumbnail-name"] || "page-thumbnail-desktop.png",
        content: desktopThumbnail.toString("base64"),
        encoding: "base64",
        mimeType: "image/png",
        alt: args["desktop-thumbnail-alt"] || "",
      },
      mobileThumbnail: {
        fileName: args["mobile-thumbnail-name"] || "page-thumbnail-mobile.png",
        content: mobileThumbnail.toString("base64"),
        encoding: "base64",
        mimeType: "image/png",
        alt: args["mobile-thumbnail-alt"] || "",
      },
    });
    print(pagePublishResult(args.private ? result.publication : result.asset, result.access));
  } else if (command === "pages" && subcommand === "upload") {
    const file = args.file || args.f;
    if (!file) throw new Error("--file is required");
    const resolved = path.resolve(file);
    if (/\.html?$/i.test(resolved)) throw new Error("Use pages publish with desktop and mobile thumbnails when publishing HTML");
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

async function put(pathname, body) {
  const response = await fetch(`${apiBase}${pathname}`, {
    method: "PUT",
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
  else if (value?.linkNotice) console.log(value.linkNotice);
  else console.log(JSON.stringify(value, null, 2));
}

function pagePublishResult(page, access = {}) {
  const internalUrl = String(access.internalUrl || page?.url || "");
  const url = String(access.url || "");
  return {
    ...page,
    internalUrl,
    url,
    linkNotice: url ? "" : String(access.linkNotice || "暂未配置可访问的域名链接，无法直接访问页面"),
  };
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
    internalUrl: session.internalUrl || session.path || "",
    url: session.url,
    linkNotice: session.linkNotice || "",
    eventCount: Number(session.eventCount || 0),
    childSessionCount: Number(session.childSessionCount || 0),
  };
}

function resolveRegularFile(value, option = "--file") {
  if (!value) throw new Error(`${option} is required`);
  const resolved = path.resolve(value);
  if (!fs.statSync(resolved).isFile()) throw new Error(`${option} must point to a regular file`);
  return resolved;
}

function readTaskArgument({ inline, positionals = [], file } = {}) {
  const inlineText = [inline, ...positionals]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!file) return inlineText;
  if (inlineText) throw new Error("--task-file cannot be combined with inline task text");
  return fs.readFileSync(resolveRegularFile(file, "--task-file"), "utf8").trim();
}

function channelProvider() {
  const provider = String(args.provider || args._[2] || "xiaohongshu").trim().toLowerCase();
  if (provider !== "xiaohongshu") throw new Error(`Unsupported channel provider: ${provider}`);
  return provider;
}

async function qianxunConnectionCommand(parsed, operationIndex = 3) {
  const operation = String(parsed._[operationIndex] || "status").trim();
  const prefix = "/api/connections/wechat/qianxun";
  if (operation === "status") return (await get(`${prefix}/status?probe=${parsed.probe === "0" ? "0" : "1"}`)).connection;
  if (operation === "plan-configure") {
    const safeKeyFile = parsed["safe-key-file"] || parsed.safeKeyFile;
    const safeKey = safeKeyFile ? fs.readFileSync(resolveRegularFile(safeKeyFile, "--safe-key-file"), "utf8").trim() : "";
    if (!parsed.url) throw new Error("--url is required");
    return await post(`${prefix}/plan-configure`, {
      baseUrl: parsed.url,
      endpointStyle: parsed["endpoint-style"] || parsed.endpointStyle || "auto",
      bindWxid: parsed.wxid || parsed.bindWxid || "",
      safeKey,
    });
  }
  if (operation === "execute") {
    if (!parsed.operation || !parsed.digest) throw new Error("--operation and --digest are required");
    return await post(`${prefix}/execute`, { operationId: parsed.operation, digest: parsed.digest });
  }
  if (operation === "events") return await get(`${prefix}/events?limit=${encodeURIComponent(parsed.limit || "50")}`);
  if (["profile", "lookup", "friends", "groups", "official-accounts", "members", "stranger"].includes(operation)) {
    return await post(`${prefix}/read`, {
      operation,
      input: {
        wxid: parsed.wxid,
        groupWxid: parsed.group || parsed.groupWxid,
        pq: parsed.pq,
        refresh: parsed.refresh === true || parsed.refresh === "1" || parsed.refresh === "true",
      },
    });
  }
  if (operation.startsWith("plan-")) {
    const action = operation.slice("plan-".length);
    const input = {
      wxid: parsed.to || parsed.wxid,
      text: parsed.text,
      filePath: ["send-image", "send-file"].includes(action) ? resolveRegularFile(parsed.file || parsed.f) : undefined,
      remark: parsed.remark,
      scene: parsed.scene,
      v3: parsed.v3,
      v4: parsed.v4,
      role: parsed.role,
      content: parsed.content,
      type: parsed.type,
      groupWxid: parsed.group || parsed.groupWxid,
      memberWxid: parsed.member || parsed.memberWxid,
    };
    return await post(`${prefix}/plan-action`, { action, input });
  }
  throw new Error(`Unsupported Qianxun connection operation: ${operation}`);
}

async function personalWechatConnectionCommand(parsed) {
  const operation = String(parsed._[2] || "status").trim();
  const prefix = "/api/connections/wechat-personal";
  if (operation === "status") return (await get(`${prefix}/status`)).connection;
  if (operation === "directory") return (await get(`${prefix}/directory`)).directory;
  if (operation === "conversations") {
    const query = new URLSearchParams({ limit: String(parsed.limit || "50") });
    if (parsed.before) query.set("before", String(parsed.before));
    return (await get(`${prefix}/conversations?${query}`)).conversations;
  }
  if (operation === "history") {
    if (!parsed.conversation) throw new Error("--conversation is required");
    const query = new URLSearchParams({ conversation: parsed.conversation, limit: String(parsed.limit || "100") });
    if (parsed.before) query.set("before", String(parsed.before));
    return (await get(`${prefix}/history?${query}`)).messages;
  }
  if (operation === "policy") return (await get(`${prefix}/policy`)).policy;
  if (operation === "detect") {
    const safeKeyFile = parsed["safe-key-file"] || parsed.safeKeyFile;
    const safeKey = safeKeyFile ? fs.readFileSync(resolveRegularFile(safeKeyFile, "--safe-key-file"), "utf8").trim() : "";
    return await post(`${prefix}/detect`, {
      baseUrl: parsed.url || "http://127.0.0.1:8055",
      endpointStyle: parsed["endpoint-style"] || parsed.endpointStyle || "auto",
      bindWxid: parsed.wxid || parsed.bindWxid || "",
      safeKey,
    });
  }
  if (operation === "set-policy") {
    const policyFile = resolveRegularFile(parsed.file || parsed.f, "--file");
    return await put(`${prefix}/policy`, JSON.parse(fs.readFileSync(policyFile, "utf8")));
  }
  return await qianxunConnectionCommand(parsed, 2);
}

function help() {
  console.log(`Usage:
  pa-cli session start (--task "..."|--task-file <utf8-file>) [--parent <session> --title "..." --description "..."] [--workspace <path>] [--json]
  pa-cli session update --session <id> [--title "..."] [--description "..."] [--json]
  pa-cli session list [--query "..."] [--limit <n>] [--cursor <cursor>] [--all] [--json]
  pa-cli session search --query "..." [--all] [--json]
  pa-cli session input --session <id> --text "..." [--notify-wechat]
  pa-cli session resume --session <id> (--task "..."|--task-file <utf8-file>)
  pa-cli session status --session <id> [--json]
  pa-cli data status [--json]
  pa-cli data schema [--object <table>] [--json]
  pa-cli data sql --statement "<SQL>" [--session <id>] [--run <task-run>] [--json]
  pa-cli data sql --file <sql-file> [--json]
  pa-cli data query --object <table> [--search <text>] [--field <column> --operator <op> --value <value>] [--group <column> --aggregate <fn> --metric <column>]
  pa-cli data snapshots [--json]
  pa-cli data snapshot [--reason <text>] [--json]
  pa-cli data restore --id <snapshot-id> [--json]
  pa-cli data metadata --object <table> [--field <column>] [--name <label>] [--description <text>] [--sensitivity <level>]
  pa-cli cron list [--json]
  pa-cli cron create --name <name> --cron "0 9 * * *" --prompt "..." [--timezone <iana-zone>] [--workspace <name>] [--recipient <wechat-id>] [--json]
  pa-cli cron update --id <task-id> [--name <name>] [--cron "..."] [--timezone <iana-zone>] [--prompt "..."] [--enabled|--disabled]
  pa-cli cron delete --id <task-id>
  pa-cli cron run --id <task-id> [--json]
  pa-cli connection list [--json]
  pa-cli connection inspect <wechat|wechat-personal|xiaohongshu|twitter|notion|mail|sites> [--json]
  pa-cli connection <id> status [--json]
  pa-cli connection wechat connect [--json]
  pa-cli connection wechat send-file --file <path> [--title <name>] [--recipient <wechat-id>]
  pa-cli connection wechat send-image --file <path> [--caption "..."] [--recipient <wechat-id>]
  pa-cli connection wechat-personal status|detect|directory|policy [--json]
  pa-cli connection wechat-personal set-policy --file <policy.json> [--json]
  pa-cli connection wechat-personal events [--limit <n>] [--json]
  pa-cli connection wechat qianxun status [--probe 0] [--json]
  pa-cli connection wechat qianxun plan-configure --url http://127.0.0.1:<port> [--endpoint-style auto|wechat|qianxun] [--wxid <expected-wxid>] [--safe-key-file <path>]
  pa-cli connection wechat qianxun profile|friends|groups|official-accounts [--refresh 1] [--json]
  pa-cli connection wechat qianxun lookup --wxid <wxid> [--json]
  pa-cli connection wechat qianxun members --group <group-wxid> [--json]
  pa-cli connection wechat qianxun stranger (--pq <query>|--wxid <wxid>) [--json]
  pa-cli connection wechat qianxun events [--limit <n>] [--json]
  pa-cli connection wechat qianxun plan-send-text --to <wxid> --text "..." [--json]
  pa-cli connection wechat qianxun plan-send-image|plan-send-file --to <wxid> --file <path> [--json]
  pa-cli connection wechat qianxun plan-set-remark --wxid <wxid> --remark "..." [--json]
  pa-cli connection wechat qianxun plan-accept-friend --scene <n> --v3 <value> --v4 <value> [--role <n>] [--json]
  pa-cli connection wechat qianxun plan-add-friend-v3 --v3 <value> --content "..." --scene <n> [--json]
  pa-cli connection wechat qianxun plan-add-friend-group --group <group-wxid> --member <member-wxid> --content "..." [--json]
  pa-cli connection wechat qianxun plan-invite-group --group <group-wxid> --member <member-wxid> [--json]
  pa-cli connection wechat qianxun plan-remove-contact --wxid <wxid> [--json]
  pa-cli connection wechat qianxun execute --operation <op-id> --digest <digest> [--json]
  pa-cli connection wechat-personal conversations [--limit <n>] [--before <seq>] [--json]
  pa-cli connection wechat-personal history --conversation <opaque-id> [--limit <n>] [--before <seq>] [--json]
  pa-cli connection xiaohongshu open [--json]
  pa-cli connection xiaohongshu search --keyword "..." [--json]
  pa-cli connection xiaohongshu read --url <signed-url> [--json]
  pa-cli connection xiaohongshu read --feed-id <id> --xsec-token <token> [--json]
  pa-cli connection twitter open [--json]
  pa-cli connection twitter search --query "..." [--json]
  pa-cli connection twitter read --url <status-url> [--json]
  pa-cli connection twitter read --tweet-id <id> [--json]
  pa-cli connection notion connect|poll [--json]
  pa-cli connection mail scan|history [--json]
  pa-cli connection mail use-platform-domain|remove-platform-domain [--json]
  pa-cli connection mail use-custom-domain --domain <domain> [--json]
  pa-cli connection mail verify-custom-domain|remove-custom-domain [--json]
  pa-cli connection sites list|tunnel-status|use-platform-domain|remove-platform-domain [--json]
  pa-cli connection sites use-custom-domain --domain <domain> [--json]
  pa-cli connection sites verify-custom-domain|remove-custom-domain [--json]
  pa-cli channel status xiaohongshu [--json]
  pa-cli channel login xiaohongshu [--execute] [--recipient <wechat-id>] [--json]
  pa-cli channel login-status xiaohongshu --session <login-session> [--json]
  pa-cli wechat status [--json]
  pa-cli wechat login [--json]
  pa-cli wechat send-file --file <path> [--title <name>] [--recipient <wechat-id>]
  pa-cli wechat send-image --file <path> [--caption "..."] [--recipient <wechat-id>]
  pa-cli notify --message "..." [--recipient <wechat-id>]
  pa-cli mail ingest --recipient <address> --sender <address> < message.eml
  pa-cli file link --file <private-file-path> [--expires <seconds>] [--json]
  pa-cli file search [--query <text>] [--source <source>] [--visibility public|private] [--tier hot|cold|all]
  pa-cli file stat --id <object-id> [--json]
  pa-cli file materialize --id <object-id> [--ttl 7d] [--task <task-id>] [--json]
  pa-cli file pin --id <object-id> [--days 30] [--reason <text>] [--json]
  pa-cli file unpin --id <object-id> [--json]
  pa-cli file gc [--dry-run] [--execute] [--json]
  pa-cli file verify-storage [--execute] [--json]
  pa-cli file reconcile --root <allowlisted-dir> --source <source> --visibility public|private [--prefix <path>] [--exclude-manifest <json>] [--execute] [--json]
  pa-cli pages publish --file <index.html> --folder <stable-name> --desktop-thumbnail <desktop.png> --mobile-thumbnail <mobile.png> [--title <text>] [--summary <text>] [--desktop-thumbnail-alt <text>] [--mobile-thumbnail-alt <text>] [--private] [--overwrite] [--json]
  pa-cli pages upload --file <asset.css|asset.js|image> [--folder <name>] [--private] [--json]`);
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
