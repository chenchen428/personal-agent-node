import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import mime from "mime-types";
import { WebSocketServer } from "ws";
import { config, ensureRuntimeDirs } from "../config.js";
import { PersonalAuth } from "../auth/personal-auth.js";
import { WeChatConnector } from "../channels/wechat/connector.ts";
import { ChannelInputError, XiaohongshuChannel } from "../channels/xiaohongshu/channel.js";
import { XiaohongshuLoginCoordinator } from "../channels/xiaohongshu/login-coordinator.js";
import { createOnlinePagesMcpServer } from "../online-pages/mcp.js";
import { configureOnlinePagesStorage, listUploadedAssets, uploadStaticAsset } from "../online-pages/upload.js";
import { PrivatePublicationStore } from "../online-pages/private-publications.js";
import { assertInside } from "../online-pages/path-utils.js";
import { ManagedFileCatalog } from "../managed-files/catalog.js";
import { LocalManagedProvider } from "../managed-files/local-provider.js";
import { ManagedFileService } from "../managed-files/service.js";
import { AgentDataStore } from "../data/agent-data.js";
import { AutomationEngine } from "../automation/engine.js";
import { parseMailForDisplay, readMailAttachment } from "../automation/mail-reader.js";
import { TemplateRuntime } from "../automation/template-runtime.js";
import { BridgeStore } from "../store/store.js";
import { AgentBridgeBroker } from "../broker/agent-bridge-broker.js";
import { readWorkspaceSkillCatalog } from "../skills/catalog.js";
import { assertMinimumCronInterval, ScheduledTaskRunner, nextRunAt, normalizeTimezone, parseCronExpression } from "../scheduler/scheduled-tasks.js";
import { BrowserHub } from "./broadcast.js";
import { SessionOrchestrator } from "./orchestrator.js";
import { renderAutomationPage, renderAutomationRunsFragment, renderConsoleSessionsFragment, renderCronPage, renderDashboard, renderDataPage, renderDataRowsFragment, renderMemoryPage, renderMessagesFragment, renderNewSession, renderPagesIndex, renderPrivateFileBatch, renderPrivateFilePreview, renderReleaseNotesPage, renderSessionDetail, renderSkillCatalogPage } from "../web/pages.js";
import { renderMailPage } from "../web/mail-page.js";
import { renderChannelsPage } from "../web/channels-page.js";
import { buildPrivateAttachmentPreviewUrl, decodePrivateAttachmentPath, privateFilePreviewKind, relativeAttachmentPath, storedAttachmentDisplayName } from "../private-files/attachments.js";
import { configurePrivateManagedFiles, headPrivateAttachment, privateStorageConfigured, readPrivateAttachment, signPrivateAttachmentUrl, verifyPrivateStorageAccess } from "../private-files/local-store.js";
import { ReleaseNotesStore } from "../release-notes/store.js";

ensureRuntimeDirs();

const logger = {
  log: (message: string) => console.log(message),
  error: (message: string) => console.error(message),
};
const store = new BridgeStore({ dataDir: config.dataDir, consoleBaseUrl: config.consoleBaseUrl });
const managedFileCatalog = new ManagedFileCatalog({ dataDir: config.dataDir, databasePath: store.databasePath });
const managedStorage = new LocalManagedProvider({ rootDir: path.join(config.dataDir, "managed-objects"), publicBaseUrl: config.pagesBaseUrl });
const managedFiles = new ManagedFileService({
  catalog: managedFileCatalog,
  remote: managedStorage,
  managedRoots: [config.uploadsDir, config.inboundAttachmentsDir, config.materializedFilesDir, config.privatePublicationsDir, config.mailIngressDir, path.join(config.agentDataDir, "snapshots"), ...config.migrationRoots],
  migrationRoots: [config.privatePublicationsDir, config.mailIngressDir, path.join(config.agentDataDir, "snapshots"), ...config.migrationRoots],
  materializedDir: config.materializedFilesDir,
  retentionDays: config.managedFileRetentionDays,
  materializedTtlDays: config.materializedFileTtlDays,
});
configureOnlinePagesStorage({ catalog: managedFileCatalog, remote: managedStorage });
configurePrivateManagedFiles({ catalog: managedFileCatalog });
const initialHistoryCleanup = store.pruneHistory({ retentionDays: config.historyRetentionDays, vacuum: true });
if (initialHistoryCleanup.changed) logger.log(`[history-cleanup] removed or rotated ${initialHistoryCleanup.changed} retained record(s)`);
const historyCleanupTimer = setInterval(() => {
  try {
    const result = store.pruneHistory({ retentionDays: config.historyRetentionDays });
    if (result.changed) logger.log(`[history-cleanup] removed or rotated ${result.changed} retained record(s)`);
  } catch (error) {
    logger.error(`[history-cleanup] ${error instanceof Error ? error.message : String(error)}`);
  }
}, config.historyCleanupIntervalMs);
historyCleanupTimer.unref?.();
const hub = new BrowserHub();
const agentBridgeBroker = new AgentBridgeBroker({ store, hub, logger });
const agentData = new AgentDataStore({
  dataDir: config.agentDataDir,
  databasePath: config.agentDataDatabasePath,
  audit: (operation) => store.recordDataOperation(operation),
  onSnapshot: async (snapshot) => managedFiles.reconcileLocalTree({
        root: path.dirname(snapshot.filePath),
        visibility: "private",
        source: "agent-data-snapshot",
        prefix: "agent-data/snapshots",
        execute: true,
      }),
});
const automation = new AutomationEngine({
  store,
  broker: agentBridgeBroker,
  workspaceRoot: config.workspaceRoot,
  logger,
  maxConcurrency: config.automationAgentConcurrency,
  queueLimit: config.automationQueueLimit,
  mailProtection: config.mailProtection,
});
const templateRuntime = new TemplateRuntime({ dataDir: config.automationDataDir });
const privatePublications = new PrivatePublicationStore({ rootDir: config.privatePublicationsDir, baseUrl: config.consoleBaseUrl });
const releaseNotes = new ReleaseNotesStore({ rootDir: config.releaseNotesDir });
automation.ensureDefaults();
automation.start();
const wechat = new WeChatConnector(logger);
const xiaohongshu = new XiaohongshuChannel({
  baseUrl: config.xiaohongshuBaseUrl,
  logger,
});
const xiaohongshuLogin = new XiaohongshuLoginCoordinator({ channel: xiaohongshu, wechat, logger });
const personalAuth = new PersonalAuth({ ...config.personalAuth, apiToken: config.apiToken });
const orchestrator = new SessionOrchestrator({ store, hub, channels: { wechat }, managedFiles, channelLoginCoordinator: xiaohongshuLogin });
const scheduledTasks = new ScheduledTaskRunner({ store, broker: agentBridgeBroker, channels: { wechat }, logger });
wechat.attach(orchestrator);
if (config.channelPollEnabled) wechat.start();
if (config.schedulerEnabled) scheduledTasks.start();

const server = http.createServer(async (request, response) => {
  try {
    await handleRequest(request, response);
  } catch (error) {
    console.error(error);
    const statusCode = error instanceof ChannelInputError
      ? 400
      : Number((error as { statusCode?: number } | null)?.statusCode || 500);
    const payload = { ok: false, error: error instanceof Error ? error.message : String(error) };
    if (String(request.url || "").startsWith("/api/channels")) sendChannelJson(response, statusCode, payload);
    else sendJson(response, statusCode, payload, request.method === "HEAD");
  }
});

const wss = new WebSocketServer({ noServer: true });
wss.on("connection", (socket) => {
  hub.add(socket);
  socket.send(JSON.stringify({ type: "broker.ready", serverTime: new Date().toISOString() }));
});

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/agent-bridge/")) {
    if (!isTrustedLocalRequest(request) && !isAuthorized(request)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    if (agentBridgeBroker.handleUpgrade(request, socket, head)) return;
  }
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  if (!isAuthorized(request)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
});

server.listen(config.port, config.host, () => {
  console.log(`open-agent-bridge listening http://${config.host}:${config.port}`);
  console.log(`console: ${config.consoleBaseUrl}`);
  console.log(`pages: ${config.pagesBaseUrl}`);
  console.log(`data: ${config.dataDir}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    clearInterval(historyCleanupTimer);
    scheduledTasks.stop();
    automation.stop();
    xiaohongshuLogin.stop();
    orchestrator.stop();
    wechat.stop();
    server.close(() => {
      managedFileCatalog.close();
      agentData.close();
      store.close();
      process.exit(0);
    });
  });
}

async function handleRequest(request: http.IncomingMessage, response: http.ServerResponse) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const host = String(request.headers.host || "");
  const hostname = host.split(":")[0].toLowerCase();
  const isMailHost = hostname === "mail.personal-agent.local" || hostname === "mail.personal-agent.local";

  if (url.pathname === "/health") {
    sendJson(response, 200, { ok: true, service: "open-agent-bridge" }, request.method === "HEAD");
    return;
  }

  if (await personalAuth.handle(request, response, url)) {
    return;
  }

  if (url.pathname === "/mcp") {
    await handleMcpRequest(request, response);
    return;
  }

  if (url.pathname.startsWith("/api/agent-bridge/") && !isTrustedLocalRequest(request) && !isAuthorized(request)) {
    sendUnauthorized(request, response, url);
    return;
  }

  if (await agentBridgeBroker.handleRequest(request, response, url)) {
    return;
  }

  if (host.startsWith("pages.") && request.method === "GET" && url.pathname === "/") {
    const assets = await listUploadedAssets(200);
    sendHtml(response, 200, renderPagesIndex({ assets }), request.method === "HEAD");
    return;
  }

  if (host.startsWith("pages.") || url.pathname.startsWith("/uploads/") || url.pathname.startsWith("/pages/")) {
    await serveStatic(request, response, url.pathname);
    return;
  }

  const authorizedMailIngress = request.method === "POST"
    && url.pathname === "/api/agent-automations/events"
    && isMailIngestAuthorized(request);
  if (!isAuthorized(request) && !authorizedMailIngress) {
    sendUnauthorized(request, response, url);
    return;
  }

  const privateFileBatchMatch = /^\/private-files\/batches\/([^/]+)$/.exec(url.pathname);
  if (privateFileBatchMatch && (request.method === "GET" || request.method === "HEAD")) {
    const batch = store.getPrivateFileBatch(decodeURIComponent(privateFileBatchMatch[1]));
    if (!batch) {
      sendText(response, 404, "Not Found", request.method === "HEAD");
      return;
    }
    const items = batch.items.map((item) => ({
      ...item,
      previewUrl: buildPrivateAttachmentPreviewUrl({
        rootDir: config.inboundAttachmentsDir,
        filePath: path.join(config.inboundAttachmentsDir, item.relativePath),
        consoleBaseUrl: config.consoleBaseUrl,
      }),
    }));
    sendPrivateHtml(response, 200, renderPrivateFileBatch({ ...batch, items }), request.method === "HEAD");
    return;
  }

  const privateFileMatch = /^\/private-files\/(view|raw)\/(.+)$/.exec(url.pathname);
  if (privateFileMatch && (request.method === "GET" || request.method === "HEAD")) {
    await servePrivateFile(request, response, url, privateFileMatch[1], privateFileMatch[2]);
    return;
  }

  if (((isMailHost && url.pathname === "/") || url.pathname === "/mail") && (request.method === "GET" || request.method === "HEAD")) {
    await serveMailPage(request, response, url, { isMailHost, hostname });
    return;
  }

  const mailRawMatch = /^\/(?:mail\/messages|message)\/([^/]+)\/raw$/.exec(url.pathname);
  if (mailRawMatch && (isMailHost || url.pathname.startsWith("/mail/")) && (request.method === "GET" || request.method === "HEAD")) {
    await serveMailRaw(request, response, decodeURIComponent(mailRawMatch[1]));
    return;
  }

  const mailAttachmentMatch = /^\/(?:mail\/messages|message)\/([^/]+)\/attachments\/(\d+)$/.exec(url.pathname);
  if (mailAttachmentMatch && (isMailHost || url.pathname.startsWith("/mail/")) && (request.method === "GET" || request.method === "HEAD")) {
    await serveMailAttachment(request, response, decodeURIComponent(mailAttachmentMatch[1]), Number(mailAttachmentMatch[2]));
    return;
  }

  if (url.pathname === "/" && (request.method === "GET" || request.method === "HEAD")) {
    sendRedirect(response, "/agent-bridge", request.method === "HEAD");
    return;
  }

  if (url.pathname === "/agent-bridge" && (request.method === "GET" || request.method === "HEAD")) {
    sendHtml(response, 200, renderDashboard({
      pageSize: config.sessionPageSize,
      initialLoading: true,
    }), request.method === "HEAD");
    return;
  }

  if (url.pathname === "/agent-bridge/new" && (request.method === "GET" || request.method === "HEAD")) {
    sendHtml(response, 200, renderNewSession({
      workspaces: store.listWorkspaces(),
      initialWorkspaceName: url.searchParams.get("workspace") || "",
      initialPrompt: url.searchParams.get("prompt") || "",
    }), request.method === "HEAD");
    return;
  }

  if (url.pathname === "/agent-skills" && (request.method === "GET" || request.method === "HEAD")) {
    sendHtml(response, 200, renderSkillCatalogPage(readWorkspaceSkillCatalog(config.workspaceRoot)), request.method === "HEAD");
    return;
  }

  if (url.pathname === "/agent-bridge/memory" && (request.method === "GET" || request.method === "HEAD")) {
    sendRedirect(response, "/agent-memory", request.method === "HEAD");
    return;
  }

  if (url.pathname === "/agent-memory" && (request.method === "GET" || request.method === "HEAD")) {
    const sessions = store.listMemorySessions();
    const requestedSessionId = url.searchParams.get("session") || "";
    const selectedSessionId = sessions.some((session) => session.id === requestedSessionId)
      ? requestedSessionId
      : store.getDefaultMemorySessionId();
    sendHtml(response, 200, renderMemoryPage({
      sessions,
      selectedSessionId,
      memories: store.listMemories({ sessionId: selectedSessionId, limit: 200 }),
      stats: store.getMemoryStats(selectedSessionId),
    }), request.method === "HEAD");
    return;
  }

  if (url.pathname === "/agent-cron" && (request.method === "GET" || request.method === "HEAD")) {
    sendRedirect(response, "/agent-corn", request.method === "HEAD");
    return;
  }

  if (url.pathname === "/agent-corn" && (request.method === "GET" || request.method === "HEAD")) {
    sendHtml(response, 200, renderCronPage({
      tasks: store.listScheduledTasks(),
      workspaces: store.listWorkspaces(),
    }), request.method === "HEAD");
    return;
  }

  if ((url.pathname === "/api/agent-corn/tasks" || url.pathname === "/api/agent-cron/tasks") && request.method === "GET") {
    sendJson(response, 200, { ok: true, tasks: store.listScheduledTasks() });
    return;
  }

  if ((url.pathname === "/api/agent-corn/tasks" || url.pathname === "/api/agent-cron/tasks") && request.method === "POST") {
    const body = await readJsonBody(request);
    const task = store.createScheduledTask(scheduledTaskInput(body));
    const next = task.enabled ? nextRunAt(task.cron, new Date(), task.timezone).toISOString() : null;
    const updated = store.updateScheduledTask(task.id, { nextRunAt: next });
    sendJson(response, 200, { ok: true, task: updated });
    return;
  }

  const scheduledTaskMatch = /^\/api\/agent-(?:corn|cron)\/tasks\/([^/]+)(?:\/(run))?$/.exec(url.pathname);
  if (scheduledTaskMatch) {
    const taskId = decodeURIComponent(scheduledTaskMatch[1]);
    const action = scheduledTaskMatch[2] || "";
    if (!action && request.method === "GET") {
      const task = store.getScheduledTask(taskId);
      if (!task) sendJson(response, 404, { ok: false, error: "scheduled task not found" });
      else sendJson(response, 200, { ok: true, task });
      return;
    }
    if (!action && request.method === "PATCH") {
      const current = store.getScheduledTask(taskId);
      if (!current) {
        sendJson(response, 404, { ok: false, error: "scheduled task not found" });
        return;
      }
      const body = await readJsonBody(request);
      const patch = scheduledTaskPatch(current, body);
      const updated = store.updateScheduledTask(taskId, patch);
      sendJson(response, 200, { ok: true, task: updated });
      return;
    }
    if (!action && request.method === "DELETE") {
      sendJson(response, 200, { ok: true, deleted: store.deleteScheduledTask(taskId) });
      return;
    }
    if (action === "run" && request.method === "POST") {
      const result = await scheduledTasks.trigger(taskId, { manual: true });
      sendJson(response, 200, {
        ok: true,
        skipped: result.skipped,
        reason: result.reason,
        task: result.task,
        delivered: result.delivered,
        notification: result.notification,
        session: result.session ? { id: result.session.id, url: result.session.url, status: result.session.status } : null,
        command: result.command ? { id: result.command.id, status: result.command.status, commandType: result.command.commandType } : null,
      });
      return;
    }
  }

  if (url.pathname === "/channels" && (request.method === "GET" || request.method === "HEAD")) {
    sendRedirect(response, "/agent-channels", request.method === "HEAD");
    return;
  }

  const releaseNotesMatch = /^\/release-notes(?:\/([^/]+))?$/.exec(url.pathname);
  if (releaseNotesMatch && (request.method === "GET" || request.method === "HEAD")) {
    const releases = releaseNotes.list();
    const requestedReleaseId = releaseNotesMatch[1] ? decodeURIComponent(releaseNotesMatch[1]) : releases[0]?.releaseId || "";
    const selectedRelease = requestedReleaseId ? releaseNotes.get(requestedReleaseId) : null;
    if (releaseNotesMatch[1] && !selectedRelease) {
      sendText(response, 404, "Not Found", request.method === "HEAD");
      return;
    }
    sendHtml(response, 200, renderReleaseNotesPage({ releases, selectedRelease }), request.method === "HEAD");
    return;
  }

  if (url.pathname === "/agent-channels" && (request.method === "GET" || request.method === "HEAD")) {
    sendPrivateAppHtml(response, 200, renderChannelsPage(), request.method === "HEAD");
    return;
  }

  if (url.pathname === "/api/channels" && request.method === "GET") {
    sendChannelJson(response, 200, { ok: true, channels: [await xiaohongshu.status()] });
    return;
  }
  if (url.pathname === "/api/channels/xiaohongshu/status" && request.method === "GET") {
    sendChannelJson(response, 200, await xiaohongshu.status());
    return;
  }
  if (url.pathname === "/api/channels/xiaohongshu/login" && request.method === "POST") {
    const body = await readJsonBody(request);
    sendChannelJson(response, 200, await xiaohongshuLogin.start({ recipientId: body.recipientId || body.recipient_id }));
    return;
  }
  if (url.pathname === "/api/channels/xiaohongshu/login/status" && request.method === "GET") {
    sendChannelJson(response, 200, await xiaohongshu.pollLogin(url.searchParams.get("session")));
    return;
  }
  if (url.pathname === "/api/channels/xiaohongshu/logout" && request.method === "POST") {
    sendChannelJson(response, 200, await xiaohongshu.logout());
    return;
  }
  if (url.pathname === "/api/channels/xiaohongshu/search" && request.method === "POST") {
    const body = await readJsonBody(request);
    sendChannelJson(response, 200, await xiaohongshu.search(body.keyword));
    return;
  }
  if (url.pathname === "/api/channels/xiaohongshu/detail" && request.method === "POST") {
    const body = await readJsonBody(request);
    sendChannelJson(response, 200, await xiaohongshu.detail({ feedId: body.feedId, xsecToken: body.xsecToken }));
    return;
  }

  const privatePublicationRootMatch = /^\/publications\/([^/]+)\/?$/.exec(url.pathname);
  if (privatePublicationRootMatch && (request.method === "GET" || request.method === "HEAD")) {
    sendRedirect(response, `/publications/${encodeURIComponent(decodeURIComponent(privatePublicationRootMatch[1]))}/index.html`, request.method === "HEAD");
    return;
  }

  const privatePublicationMatch = /^\/publications\/([^/]+)\/(.+)$/.exec(url.pathname);
  if (privatePublicationMatch && (request.method === "GET" || request.method === "HEAD")) {
    await servePrivatePublication(request, response, decodeURIComponent(privatePublicationMatch[1]), decodeURIComponent(privatePublicationMatch[2]));
    return;
  }

  if (url.pathname === "/agent-data" && (request.method === "GET" || request.method === "HEAD")) {
    const status = agentData.getStatus();
    const selectedObject = url.searchParams.get("object") || status.objects[0]?.name || "";
    const query = dataPageQuery(url.searchParams);
    const result = selectedObject ? agentData.query({ object: selectedObject, ...query.ast }) : null;
    if (url.searchParams.get("fragment") === "rows") {
      const nextPage = result && result.page.number < result.page.totalPages ? result.page.number + 1 : null;
      const nextUrl = new URL(url.pathname + url.search, config.consoleBaseUrl);
      nextUrl.searchParams.delete("fragment");
      if (nextPage) nextUrl.searchParams.set("page", String(nextPage));
      sendJson(response, 200, {
        ok: true,
        rows: result?.rows || [],
        html: renderDataRowsFragment(result?.rows || [], result?.columns || []),
        page: result?.page || null,
        hasMore: Boolean(nextPage),
        nextUrl: nextPage ? `${nextUrl.pathname}${nextUrl.search}` : "",
      }, request.method === "HEAD");
      return;
    }
    sendHtml(response, 200, renderDataPage({
      status,
      selectedObject,
      result,
      operations: store.listDataOperations({ limit: 30 }),
      query: query.display,
    }), request.method === "HEAD");
    return;
  }

  if (url.pathname === "/api/agent-data/status" && request.method === "GET") {
    sendJson(response, 200, { ok: true, status: agentData.getStatus(), operations: store.listDataOperations({ limit: 50 }) });
    return;
  }

  if (url.pathname === "/api/publications" && request.method === "GET") {
    sendJson(response, 200, { ok: true, publications: privatePublications.list() });
    return;
  }

  if (url.pathname === "/api/publications/upload" && request.method === "POST") {
    if (!isAgentWriteAuthorized(request)) return sendForbidden(response);
    const body = await readJsonBody(request);
    const publication = privatePublications.upload({
      publicationId: body.publicationId || body.folder,
      fileName: body.fileName || body.name,
      content: body.content,
      encoding: body.encoding,
      mimeType: body.mimeType,
      overwrite: Boolean(body.overwrite),
    });
    const managed = await managedFiles.reconcileLocalTree({
          root: path.join(config.privatePublicationsDir, publication.publicationId),
          visibility: "private",
          source: "private-publication",
          prefix: `publications/${publication.publicationId}`,
          execute: true,
        });
    sendJson(response, 200, { ok: true, publication, managed });
    return;
  }

  if (url.pathname === "/api/agent-data/schema" && request.method === "GET") {
    sendJson(response, 200, { ok: true, objects: agentData.listObjects(), metadata: store.listDataCatalogMetadata() });
    return;
  }

  const dataObjectMatch = /^\/api\/agent-data\/objects\/([^/]+)$/.exec(url.pathname);
  if (dataObjectMatch && request.method === "GET") {
    const objectName = decodeURIComponent(dataObjectMatch[1]);
    sendJson(response, 200, { ok: true, object: agentData.describeObject(objectName), metadata: store.listDataCatalogMetadata({ objectName }) });
    return;
  }

  if (url.pathname === "/api/agent-data/query" && request.method === "POST") {
    const body = await readJsonBody(request);
    sendJson(response, 200, { ok: true, result: agentData.query(body) });
    return;
  }

  if (url.pathname === "/api/agent-data/distinct" && request.method === "POST") {
    const body = await readJsonBody(request);
    sendJson(response, 200, { ok: true, values: agentData.distinct(body) });
    return;
  }

  if (url.pathname === "/api/agent-data/sql" && request.method === "POST") {
    if (!isAgentWriteAuthorized(request)) {
      sendJson(response, 403, { ok: false, error: "Agent data write permission required" });
      return;
    }
    const body = await readJsonBody(request);
    const result = await agentData.execute(body.sql || body.statement, {
      actor: body.actor || "agent",
      sessionId: body.sessionId || "",
      runId: body.runId || "",
    });
    sendJson(response, 200, { ok: true, result });
    return;
  }

  if (url.pathname === "/api/agent-data/snapshots" && request.method === "GET") {
    sendJson(response, 200, { ok: true, snapshots: agentData.listSnapshots() });
    return;
  }

  if (url.pathname === "/api/agent-data/snapshots" && request.method === "POST") {
    if (!isAgentWriteAuthorized(request)) {
      sendJson(response, 403, { ok: false, error: "Agent data write permission required" });
      return;
    }
    const body = await readJsonBody(request);
    sendJson(response, 200, { ok: true, snapshot: await agentData.createSnapshot({ reason: body.reason || "manual" }) });
    return;
  }

  const dataSnapshotRestoreMatch = /^\/api\/agent-data\/snapshots\/([^/]+)\/restore$/.exec(url.pathname);
  if (dataSnapshotRestoreMatch && request.method === "POST") {
    if (!isAgentWriteAuthorized(request)) {
      sendJson(response, 403, { ok: false, error: "Agent data write permission required" });
      return;
    }
    sendJson(response, 200, { ok: true, result: await agentData.restoreSnapshot(decodeURIComponent(dataSnapshotRestoreMatch[1])) });
    return;
  }

  if (url.pathname === "/api/agent-data/metadata" && request.method === "POST") {
    if (!isAgentWriteAuthorized(request)) {
      sendJson(response, 403, { ok: false, error: "Agent data write permission required" });
      return;
    }
    const body = await readJsonBody(request);
    sendJson(response, 200, { ok: true, metadata: store.upsertDataCatalogMetadata(body) });
    return;
  }

  if (url.pathname === "/agent-automations" && (request.method === "GET" || request.method === "HEAD")) {
    const runs = store.listAutomationRuns({ limit: 20 });
    sendHtml(response, 200, renderAutomationPage({
      sources: store.listAutomationSources(),
      rules: store.listAutomationRules(),
      events: runs.map((run) => run.eventId ? store.getAutomationEvent(run.eventId) : null).filter(Boolean),
      runs,
      templates: store.listAutomationTemplates(),
      policies: store.listAutomationMailPolicies({ limit: 50 }),
      totals: { runs: store.countAutomationRuns(), events: store.countAutomationEvents() },
      protection: automation.protectionStatus(),
    }), request.method === "HEAD");
    return;
  }

  if (url.pathname === "/api/agent-automations/sources" && request.method === "GET") {
    sendJson(response, 200, { ok: true, sources: store.listAutomationSources() });
    return;
  }
  if (url.pathname === "/api/agent-automations/sources" && request.method === "POST") {
    if (!isAgentWriteAuthorized(request)) return sendForbidden(response);
    sendJson(response, 200, { ok: true, source: store.upsertAutomationSource(await readJsonBody(request)) });
    return;
  }
  if (url.pathname === "/api/agent-automations/rules" && request.method === "GET") {
    sendJson(response, 200, { ok: true, rules: store.listAutomationRules() });
    return;
  }
  if (url.pathname === "/api/agent-automations/rules" && request.method === "POST") {
    if (!isAgentWriteAuthorized(request)) return sendForbidden(response);
    const body = await readJsonBody(request);
    sendJson(response, 200, { ok: true, rule: store.createAutomationRule(body, { actor: body.actor || "agent", reason: body.reason || "created" }) });
    return;
  }
  const automationRuleMatch = /^\/api\/agent-automations\/rules\/([^/]+)$/.exec(url.pathname);
  if (automationRuleMatch && request.method === "GET") {
    const rule = store.getAutomationRule(decodeURIComponent(automationRuleMatch[1]));
    sendJson(response, rule ? 200 : 404, rule ? { ok: true, rule } : { ok: false, error: "automation rule not found" });
    return;
  }
  if (automationRuleMatch && request.method === "PATCH") {
    if (!isAgentWriteAuthorized(request)) return sendForbidden(response);
    const body = await readJsonBody(request);
    const rule = store.updateAutomationRule(decodeURIComponent(automationRuleMatch[1]), body, { actor: body.actor || "agent", reason: body.reason || "updated" });
    sendJson(response, rule ? 200 : 404, rule ? { ok: true, rule } : { ok: false, error: "automation rule not found" });
    return;
  }
  if (url.pathname === "/api/agent-automations/events" && request.method === "GET") {
    const sourceId = url.searchParams.get("sourceId") || "";
    const limit = Number(url.searchParams.get("limit") || 100);
    const offset = Number(url.searchParams.get("offset") || 0);
    const events = store.listAutomationEvents({ sourceId, limit, offset });
    const total = store.countAutomationEvents({ sourceId });
    sendJson(response, 200, { ok: true, events, total, offset, hasMore: offset + events.length < total });
    return;
  }
  if (url.pathname === "/api/agent-automations/events" && request.method === "POST") {
    if (!isAgentWriteAuthorized(request) && !isMailIngestAuthorized(request)) return sendForbidden(response);
    const input = await readJsonBody(request);
    const managedMail = await manageMailEvent(input);
    sendJson(response, 200, { ok: true, ...(await automation.ingest(input)), ...(managedMail ? { managedMail } : {}) });
    return;
  }
  const automationEventMatch = /^\/api\/agent-automations\/events\/([^/]+)$/.exec(url.pathname);
  if (automationEventMatch && request.method === "GET") {
    const event = store.getAutomationEvent(decodeURIComponent(automationEventMatch[1]));
    sendJson(response, event ? 200 : 404, event ? { ok: true, event } : { ok: false, error: "automation event not found" });
    return;
  }
  const automationEventReplayMatch = /^\/api\/agent-automations\/events\/([^/]+)\/replay$/.exec(url.pathname);
  if (automationEventReplayMatch && request.method === "POST") {
    if (!isAgentWriteAuthorized(request)) return sendForbidden(response);
    const body = await readJsonBody(request);
    sendJson(response, 200, { ok: true, ...(await automation.replay(decodeURIComponent(automationEventReplayMatch[1]), { ruleId: body.ruleId || "" })) });
    return;
  }
  if (url.pathname === "/api/agent-automations/runs" && request.method === "GET") {
    const limit = Number(url.searchParams.get("limit") || 100);
    const offset = Number(url.searchParams.get("offset") || 0);
    const runs = store.listAutomationRuns({ limit, offset });
    const total = store.countAutomationRuns();
    const events = runs.map((run) => run.eventId ? store.getAutomationEvent(run.eventId) : null).filter(Boolean);
    sendJson(response, 200, {
      ok: true,
      runs,
      total,
      offset,
      hasMore: offset + runs.length < total,
      ...(url.searchParams.get("format") === "html" ? { html: renderAutomationRunsFragment(runs, store.listAutomationRules(), events) } : {}),
    });
    return;
  }
  if (url.pathname === "/api/agent-automations/mail-protection" && request.method === "GET") {
    sendJson(response, 200, { ok: true, protection: automation.protectionStatus(), policies: store.listAutomationMailPolicies({ limit: Number(url.searchParams.get("limit") || 100), offset: Number(url.searchParams.get("offset") || 0) }) });
    return;
  }
  if (url.pathname === "/api/agent-automations/mail-policies" && request.method === "POST") {
    if (!isAgentWriteAuthorized(request)) return sendForbidden(response);
    const body = await readJsonBody(request);
    sendJson(response, 200, { ok: true, policy: store.upsertAutomationMailPolicy({ ...body, origin: "agent" }) });
    return;
  }
  if (url.pathname === "/api/agent-automations/templates" && request.method === "GET") {
    sendJson(response, 200, { ok: true, templates: store.listAutomationTemplates() });
    return;
  }
  if (url.pathname === "/api/agent-automations/templates/resolve" && request.method === "GET") {
    const template = store.resolveAutomationTemplate(url.searchParams.get("sourceFingerprint") || "");
    sendJson(response, template ? 200 : 404, template ? { ok: true, template } : { ok: false, error: "active template not found" });
    return;
  }
  if (url.pathname === "/api/agent-automations/templates" && request.method === "POST") {
    if (!isAgentWriteAuthorized(request)) return sendForbidden(response);
    sendJson(response, 200, { ok: true, template: store.upsertAutomationTemplate(await readJsonBody(request)) });
    return;
  }
  if (url.pathname === "/api/agent-automations/templates/install" && request.method === "POST") {
    if (!isAgentWriteAuthorized(request)) return sendForbidden(response);
    const body = await readJsonBody(request);
    const installed = templateRuntime.install(body);
    const template = store.upsertAutomationTemplate({
      ...installed,
      codeObjectId: installed.sourcePath,
      status: installed.state.status,
      successCount: installed.state.successCount,
      failureCount: installed.state.failureCount,
    });
    sendJson(response, 200, { ok: true, template });
    return;
  }
  const automationTemplateRunMatch = /^\/api\/agent-automations\/templates\/([^/]+)\/run$/.exec(url.pathname);
  if (automationTemplateRunMatch && request.method === "POST") {
    if (!isAgentWriteAuthorized(request)) return sendForbidden(response);
    const body = await readJsonBody(request);
    const templateId = decodeURIComponent(automationTemplateRunMatch[1]);
    try {
      const result = await templateRuntime.run(templateId, body.input, { version: body.version });
      syncTemplateRuntimeState(templateId, result.state);
      sendJson(response, 200, { ok: true, result });
    } catch (error) {
      const state = (error as { templateState?: any } | null)?.templateState;
      if (state) syncTemplateRuntimeState(templateId, state);
      throw error;
    }
    return;
  }
  const automationTemplateLifecycleMatch = /^\/api\/agent-automations\/templates\/([^/]+)\/(activate|rollback|disable)$/.exec(url.pathname);
  if (automationTemplateLifecycleMatch && request.method === "POST") {
    if (!isAgentWriteAuthorized(request)) return sendForbidden(response);
    const templateId = decodeURIComponent(automationTemplateLifecycleMatch[1]);
    const action = automationTemplateLifecycleMatch[2];
    const body = await readJsonBody(request);
    const runtimeTemplate = action === "disable"
      ? { ...templateRuntime.get(templateId, body.version || templateRuntime.status(templateId).version), state: templateRuntime.disable(templateId, { reason: body.reason || "disabled by Agent" }) }
      : action === "rollback"
        ? templateRuntime.rollback(templateId, Number(body.version), { reason: body.reason || "rollback by Agent" })
        : templateRuntime.activate(templateId, body.version ? Number(body.version) : undefined, { reason: body.reason || "activated by Agent" });
    const template = syncTemplateRuntimeState(templateId, runtimeTemplate.state, runtimeTemplate);
    sendJson(response, 200, { ok: true, template });
    return;
  }

  const agentSessionMatch = /^\/agent-bridge\/session\/([^/]+)\/live$/.exec(url.pathname);
  if (agentSessionMatch && (request.method === "GET" || request.method === "HEAD")) {
    const session = store.getSession(decodeURIComponent(agentSessionMatch[1]));
    if (!session) {
      sendText(response, 404, "Not Found", request.method === "HEAD");
      return;
    }
    if (url.searchParams.get("fragment") === "messages") {
      const html = renderMessagesFragment({ session });
      sendHtml(response, 200, html, request.method === "HEAD");
      return;
    }
    sendHtml(response, 200, renderSessionDetail({ session }), request.method === "HEAD");
    return;
  }

  const legacyAgentSpaceMatch = /^\/agent-bridge\/([^/]+)$/.exec(url.pathname);
  if (legacyAgentSpaceMatch && (request.method === "GET" || request.method === "HEAD")) {
    sendRedirect(response, "/agent-bridge", request.method === "HEAD");
    return;
  }

  const sessionMatch = /^\/session\/([^/]+)$/.exec(url.pathname);
  if (sessionMatch && (request.method === "GET" || request.method === "HEAD")) {
    const session = store.getSession(decodeURIComponent(sessionMatch[1]));
    if (!session) {
      sendText(response, 404, "Not Found", request.method === "HEAD");
      return;
    }
    if (url.searchParams.get("fragment") === "messages") {
      const html = renderMessagesFragment({ session });
      sendHtml(response, 200, html, request.method === "HEAD");
      return;
    }
    sendRedirect(response, `/agent-bridge/session/${encodeURIComponent(session.id)}/live`, request.method === "HEAD");
    return;
  }

  if (url.pathname === "/api/status" && request.method === "GET") {
    sendJson(response, 200, {
      ok: true,
      service: "open-agent-bridge",
      instanceId: config.instanceId,
      dataDir: config.dataDir,
      runner: agentBridgeBroker.status(),
      wechat: await wechat.status(),
      privateFiles: { storage: "local-disk", configured: privateStorageConfigured(), localRetentionDays: config.managedFileRetentionDays },
      managedFiles: {
        storage: "local-disk",
        publicConfigured: managedStorage.configured("public"),
        privateConfigured: managedStorage.configured("private"),
        localRetentionDays: config.managedFileRetentionDays,
        materializedTtlDays: config.materializedFileTtlDays,
      },
    });
    return;
  }

  if (url.pathname === "/api/token-usage" && request.method === "GET") {
    sendJson(response, 200, { ok: true, tokenUsage: store.getTokenUsageSummary({ range: url.searchParams.get("range") || "today" }) });
    return;
  }

  if (url.pathname === "/api/files/search" && request.method === "GET") {
    sendJson(response, 200, {
      ok: true,
      files: managedFiles.search({
        query: url.searchParams.get("query") || "",
        visibility: url.searchParams.get("visibility") || "",
        source: url.searchParams.get("source") || "",
        tier: url.searchParams.get("tier") || "all",
        limit: Number(url.searchParams.get("limit") || 50),
      }),
    });
    return;
  }

  if (url.pathname === "/api/files/verify-storage" && request.method === "POST") {
    const body = await readJsonBody(request);
    sendJson(response, 200, await managedStorage.verifyStorage({ execute: body.execute === true }));
    return;
  }

  const managedFileMatch = /^\/api\/files\/([^/]+)(?:\/(materialize|pin|unpin))?$/.exec(url.pathname);
  if (managedFileMatch) {
    const objectId = decodeURIComponent(managedFileMatch[1]);
    const action = managedFileMatch[2] || "stat";
    if (action === "stat" && request.method === "GET") {
      sendJson(response, 200, { ok: true, file: managedFiles.stat(objectId) });
      return;
    }
    if (action === "materialize" && request.method === "POST") {
      const body = await readJsonBody(request);
      sendJson(response, 200, { ok: true, file: await managedFiles.materialize(objectId, {
        ttlDays: Number(body.ttlDays || 7),
        taskId: String(body.taskId || ""),
      }) });
      return;
    }
    if (action === "pin" && request.method === "POST") {
      const body = await readJsonBody(request);
      sendJson(response, 200, { ok: true, file: managedFiles.pin(objectId, {
        days: Number(body.days || 30),
        reason: String(body.reason || ""),
      }) });
      return;
    }
    if (action === "unpin" && request.method === "POST") {
      sendJson(response, 200, { ok: true, file: managedFiles.unpin(objectId) });
      return;
    }
  }

  if (url.pathname === "/api/files/gc" && request.method === "POST") {
    const body = await readJsonBody(request);
    sendJson(response, 200, await managedFiles.gc({ execute: body.execute === true }));
    return;
  }

  if (url.pathname === "/api/files/reconcile" && request.method === "POST") {
    const body = await readJsonBody(request);
    beginJsonStream(response);
    try {
      const result = await managedFiles.reconcileLocalTree({
        root: String(body.root || ""),
        visibility: String(body.visibility || "private"),
        source: String(body.source || "migration"),
        prefix: String(body.prefix || ""),
        excludeRelativePaths: Array.isArray(body.excludeRelativePaths) ? body.excludeRelativePaths : [],
        execute: body.execute === true,
      });
      response.end(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(error);
      response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
    }
    return;
  }

  if (url.pathname === "/api/private-files/link" && request.method === "POST") {
    const body = await readJsonBody(request);
    const relativePath = resolvePrivateFileRelativePath(body.filePath || body.file, body.relativePath);
    await headPrivateAttachment(relativePath);
    const signed = signPrivateAttachmentUrl(relativePath, Number(body.expires || body.expiresSeconds || 3600));
    sendJson(response, 200, {
      ok: true,
      fileName: storedAttachmentDisplayName(relativePath),
      externalUrl: signed.url,
      expiresAt: signed.expiresAt,
      expiresSeconds: signed.expires,
      privatePreviewUrl: buildPrivateAttachmentPreviewUrl({
        rootDir: config.inboundAttachmentsDir,
        filePath: path.join(config.inboundAttachmentsDir, relativePath),
        consoleBaseUrl: config.consoleBaseUrl,
      }),
    });
    return;
  }

  if (url.pathname === "/api/private-files/verify" && request.method === "POST") {
    if (!isTrustedLocalRequest(request)) {
      sendJson(response, 403, { ok: false, error: "Private storage verification is only available locally" });
      return;
    }
    sendJson(response, 200, await verifyPrivateStorageAccess());
    return;
  }

  if (url.pathname === "/api/memory-sessions" && request.method === "GET") {
    sendJson(response, 200, {
      ok: true,
      defaultSessionId: store.getDefaultMemorySessionId(),
      sessions: store.listMemorySessions({ limit: Number(url.searchParams.get("limit") || 200) }),
    });
    return;
  }

  if (url.pathname === "/api/memories" && request.method === "GET") {
    const sessionId = resolveMemorySessionId(url.searchParams.get("sessionId") || url.searchParams.get("session"));
    sendJson(response, 200, {
      ok: true,
      sessionId,
      memories: store.listMemories({
        sessionId,
        query: url.searchParams.get("query") || "",
        type: url.searchParams.get("type") || "",
        limit: Number(url.searchParams.get("limit") || 100),
      }),
      stats: store.getMemoryStats(sessionId),
    });
    return;
  }

  if (url.pathname === "/api/memories" && request.method === "POST") {
    const body = await readJsonBody(request);
    const memory = store.createMemory({
      sessionId: resolveMemorySessionId(body.sessionId || body.session),
      type: body.type,
      content: body.content || body.text,
      metadata: body.metadata,
    });
    sendJson(response, 200, { ok: true, memory, stats: store.getMemoryStats(memory.sessionId) });
    return;
  }

  if (url.pathname === "/api/memories/recall" && request.method === "POST") {
    const body = await readJsonBody(request);
    const sessionId = resolveMemorySessionId(body.sessionId || body.session);
    const memories = store.recallMemories({
      sessionId,
      query: body.query || "",
      type: body.type || "",
      limit: Number(body.limit || 8),
    });
    sendJson(response, 200, { ok: true, sessionId, memories, stats: store.getMemoryStats(sessionId) });
    return;
  }

  const memoryMatch = /^\/api\/memories\/([^/]+)$/.exec(url.pathname);
  if (memoryMatch) {
    const memoryId = decodeURIComponent(memoryMatch[1]);
    if (request.method === "GET") {
      const memory = store.getMemory(memoryId);
      if (!memory) sendJson(response, 404, { ok: false, error: "memory not found" });
      else sendJson(response, 200, { ok: true, memory });
      return;
    }
    if (request.method === "PATCH") {
      const body = await readJsonBody(request);
      const memory = store.updateMemory(memoryId, body);
      if (!memory) sendJson(response, 404, { ok: false, error: "memory not found" });
      else sendJson(response, 200, { ok: true, memory, stats: store.getMemoryStats(memory.sessionId) });
      return;
    }
    if (request.method === "DELETE") {
      const current = store.getMemory(memoryId);
      if (!current) sendJson(response, 404, { ok: false, error: "memory not found" });
      else sendJson(response, 200, { ok: true, deleted: store.deleteMemory(memoryId), stats: store.getMemoryStats(current.sessionId) });
      return;
    }
  }

  if (url.pathname === "/api/sessions" && request.method === "GET") {
    const query = url.searchParams.get("query") || "";
    const page = store.listSessionsPage({
      includeArchived: url.searchParams.get("archived") === "1",
      limit: Number(url.searchParams.get("limit") || config.sessionPageSize),
      cursor: url.searchParams.get("cursor") || "",
      query,
      hydrate: false,
    });
    sendJson(response, 200, {
      ok: true,
      ...page,
      totalSessions: store.countSessions(),
      html: renderConsoleSessionsFragment(page.sessions, { empty: !page.sessions.length, search: Boolean(query) }),
    });
    return;
  }

  if (url.pathname === "/api/sessions" && request.method === "POST") {
    const body = await readJsonBody(request);
    const session = await orchestrator.startWorkerSession({
      task: body.task || body.taskDescription || body.content,
      title: body.title,
      parentSessionId: body.parentSessionId || body.parent,
      workspaceRoot: body.workspaceRoot || body.workspace,
      createdBy: body.createdBy || "api",
    });
    sendJson(response, 200, { ok: true, session });
    return;
  }

  const apiSessionMatch = /^\/api\/sessions\/([^/]+)(?:\/(input|stop|events))?$/.exec(url.pathname);
  if (apiSessionMatch) {
    const sessionId = decodeURIComponent(apiSessionMatch[1]);
    const action = apiSessionMatch[2] || "";
    if (!action && request.method === "GET") {
      const session = store.getSession(sessionId);
      if (!session) sendJson(response, 404, { ok: false, error: "session not found" });
      else sendJson(response, 200, { ok: true, session });
      return;
    }
    if (action === "events" && request.method === "GET") {
      sendJson(response, 200, { ok: true, events: store.listEvents(sessionId, { afterSeq: Number(url.searchParams.get("afterSeq") || 0) }) });
      return;
    }
    if (action === "input" && request.method === "POST") {
      const body = await readJsonBody(request);
      const content = String(body.content || body.text || "").trim();
      if (!content) throw new Error("content is required");
      await orchestrator.resumeSession(sessionId, content, { notifyWechat: body.notifyWechat === true });
      sendJson(response, 202, { ok: true, session: store.getSession(sessionId) });
      return;
    }
    if (action === "stop" && request.method === "POST") {
      sendJson(response, 200, { ok: true, stopped: orchestrator.stopSession(sessionId) });
      return;
    }
  }

  if (url.pathname === "/api/channels/wechat/login/start" && request.method === "POST") {
    sendJson(response, 200, { ok: true, ...(await wechat.startLogin()) });
    return;
  }

  if (url.pathname === "/api/channels/wechat/login/status" && request.method === "GET") {
    sendJson(response, 200, { ok: true, ...(await wechat.pollLoginStatus(url.searchParams.get("session") || "")) });
    return;
  }

  if (url.pathname === "/api/channels/wechat/notify" && request.method === "POST") {
    const body = await readJsonBody(request);
    const recipientId = await wechat.sendText(body.recipientId || body.recipient_id || store.getLastWechatRecipient(), String(body.message || body.text || ""));
    sendJson(response, 200, { ok: true, recipientId });
    return;
  }

  if (url.pathname === "/api/channels/wechat/send-file" && request.method === "POST") {
    const body = await readJsonBody(request);
    const filePath = await resolveLocalMediaFile(body.filePath || body.file);
    const recipientId = await wechat.sendFile(
      body.recipientId || body.recipient_id || store.getLastWechatRecipient(),
      filePath,
      String(body.title || "").trim() || undefined,
    );
    sendJson(response, 200, { ok: true, recipientId, fileName: path.basename(filePath) });
    return;
  }

  if (url.pathname === "/api/channels/wechat/send-image" && request.method === "POST") {
    const body = await readJsonBody(request);
    const filePath = await resolveLocalMediaFile(body.filePath || body.file);
    const recipientId = await wechat.sendImage(
      body.recipientId || body.recipient_id || store.getLastWechatRecipient(),
      filePath,
      String(body.caption || "").trim() || undefined,
    );
    sendJson(response, 200, { ok: true, recipientId, fileName: path.basename(filePath) });
    return;
  }

  if (url.pathname === "/api/pages/upload" && request.method === "POST") {
    const body = await readJsonBody(request);
    sendJson(response, 200, { ok: true, asset: await uploadStaticAsset(body) });
    return;
  }

  sendText(response, 404, "Not Found", request.method === "HEAD");
}

async function handleMcpRequest(request: http.IncomingMessage, response: http.ServerResponse) {
  if (!config.uploadToken) {
    sendJsonRpcError(response, 503, -32000, "MCP upload endpoint is disabled.");
    return;
  }
  if (!isUploadAuthorized(request)) {
    response.setHeader("WWW-Authenticate", 'Bearer realm="open-agent-bridge-online-pages"');
    sendJsonRpcError(response, 401, -32001, "Unauthorized.");
    return;
  }
  if (request.method !== "POST") {
    sendJsonRpcError(response, 405, -32000, "Method not allowed.");
    return;
  }
  const mcpServer = createOnlinePagesMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(request, response);
    response.on("close", () => {
      transport.close();
      mcpServer.close();
    });
  } catch (error) {
    console.error("MCP request failed:", error);
    transport.close();
    mcpServer.close();
    if (!response.headersSent) sendJsonRpcError(response, 500, -32603, "Internal server error.");
  }
}

async function servePrivatePublication(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  publicationId: string,
  fileName: string,
) {
  let file;
  try { file = privatePublications.resolve(publicationId, fileName); }
  catch {
    sendText(response, 400, "Bad Request", request.method === "HEAD");
    return;
  }
  if (!file) {
    sendText(response, 404, "Not Found", request.method === "HEAD");
    return;
  }
  const content = await fs.promises.readFile(file.filePath);
  response.writeHead(200, {
    "Content-Type": file.mimeType,
    "Content-Length": String(content.length),
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  });
  response.end(request.method === "HEAD" ? undefined : content);
}

async function manageMailEvent(input: any) {
  if (String(input?.sourceId || "") !== "src_mail_agent") return null;
  const rawPath = String(input?.payload?.rawPath || "").trim();
  if (!rawPath) throw new Error("mail event is missing its raw archive path");
  const resolvedPath = path.resolve(rawPath);
  assertInside(config.mailIngressDir, resolvedPath);
  const stat = await fs.promises.stat(resolvedPath);
  if (!stat.isFile()) throw new Error("mail archive path is not a regular file");
  const archiveDir = path.dirname(resolvedPath);
  const prefix = path.relative(config.mailIngressDir, archiveDir).split(path.sep).join("/");
  const sync = await managedFiles.reconcileLocalTree({
    root: archiveDir,
    visibility: "private",
    source: "mail-ingress",
    prefix,
    execute: true,
  });
  const managedObject = sync.results.find((item) => item.relativePath === path.basename(resolvedPath));
  if (!managedObject?.objectId) throw new Error("mail archive was not registered as a managed object");
  input.payload.rawObjectId = managedObject.objectId;
  return {
    ok: true,
    objectId: managedObject.objectId,
    action: managedObject.action,
    sha256: managedObject.sha256,
  };
}

async function serveMailPage(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  url: URL,
  { isMailHost, hostname }: { isMailHost: boolean; hostname: string },
) {
  const query = String(url.searchParams.get("q") || "").trim().slice(0, 160);
  const requestedFilter = String(url.searchParams.get("filter") || "all");
  const filter = ["all", "matched", "attachments"].includes(requestedFilter) ? requestedFilter : "all";
  const allEvents = store.listAutomationEvents({ sourceId: "src_mail_agent", limit: 500 });
  const allRuns = store.listAutomationRuns({ limit: 500 });
  const runsByEvent = new Map<string, any[]>();
  for (const run of allRuns) {
    const bucket = runsByEvent.get(run.eventId) || [];
    bucket.push(run);
    runsByEvent.set(run.eventId, bucket);
  }
  const normalizedQuery = query.toLocaleLowerCase("zh-CN");
  const filteredEvents = allEvents.filter((event) => {
    const runs = runsByEvent.get(event.id) || [];
    if (filter === "matched" && !runs.some((run) => run.matched)) return false;
    if (filter === "attachments" && !(Array.isArray(event.payload?.attachments) && event.payload.attachments.length)) return false;
    if (!normalizedQuery) return true;
    return [
      event.title,
      event.sender?.displayName,
      event.sender?.address,
      event.payload?.textPreview,
      ...(Array.isArray(event.payload?.recipients) ? event.payload.recipients : []),
    ].some((value) => String(value || "").toLocaleLowerCase("zh-CN").includes(normalizedQuery));
  });
  const selectedId = String(url.searchParams.get("message") || "");
  const selectedEvent = selectedId ? store.getAutomationEvent(selectedId) : null;
  const safeSelectedEvent = selectedEvent?.sourceId === "src_mail_agent" ? selectedEvent : null;
  const selectedRuns = safeSelectedEvent ? runsByEvent.get(safeSelectedEvent.id) || [] : [];
  let content = null;
  if (safeSelectedEvent) {
    try {
      const raw = await readMailArchive(safeSelectedEvent);
      content = await parseMailForDisplay(raw);
    } catch (error) {
      logger.error(`[mail-view] ${error instanceof Error ? error.message : String(error)}`);
      content = {
        body: String(safeSelectedEvent.payload?.textPreview || ""),
        attachments: Array.isArray(safeSelectedEvent.payload?.attachments)
          ? safeSelectedEvent.payload.attachments.map((attachment, index) => ({ ...attachment, index, sizeBytes: Number(attachment.sizeBytes || 0), contentType: attachment.contentType || "application/octet-stream" }))
          : [],
        error: "完整邮件暂时无法读取，当前显示的是接收时保存的安全预览。",
      };
    }
  }
  const localMode = hostname.endsWith(".local");
  const basePath = isMailHost ? "/" : "/mail";
  const events = filteredEvents.slice(0, 100).map((event) => ({
    ...event,
    matched: (runsByEvent.get(event.id) || []).some((run) => run.matched),
  }));
  sendPrivateHtml(response, 200, renderMailPage({
    events,
    total: filteredEvents.length,
    selectedEvent: safeSelectedEvent,
    selectedRuns,
    content,
    query,
    filter,
    basePath,
    adminUrl: `${localMode ? "http" : "https"}://a.${localMode ? "personal-agent.local" : "personal-agent.local"}`,
    automationUrl: `${localMode ? "http" : "https"}://agent.${localMode ? "personal-agent.local" : "personal-agent.local"}/agent-automations`,
  }), request.method === "HEAD");
}

async function serveMailRaw(request: http.IncomingMessage, response: http.ServerResponse, eventId: string) {
  const event = store.getAutomationEvent(eventId);
  if (!event || event.sourceId !== "src_mail_agent") {
    sendText(response, 404, "Not Found", request.method === "HEAD");
    return;
  }
  const raw = await readMailArchive(event);
  const name = `${safeDownloadName(event.title || "message")}.eml`;
  sendPrivateDownload(response, raw, "message/rfc822", name, request.method === "HEAD");
}

async function serveMailAttachment(request: http.IncomingMessage, response: http.ServerResponse, eventId: string, index: number) {
  const event = store.getAutomationEvent(eventId);
  if (!event || event.sourceId !== "src_mail_agent") {
    sendText(response, 404, "Not Found", request.method === "HEAD");
    return;
  }
  try {
    const raw = await readMailArchive(event);
    const attachment = await readMailAttachment(raw, index);
    sendPrivateDownload(response, attachment.content, safeMimeType(attachment.contentType), safeDownloadName(attachment.name), request.method === "HEAD");
  } catch (error) {
    if ((error as { code?: string })?.code === "ENOENT") {
      sendText(response, 404, "Not Found", request.method === "HEAD");
      return;
    }
    throw error;
  }
}

async function readMailArchive(event: any) {
  const filePath = await resolveMailArchivePath(event);
  const stat = await mailArchiveFileStat(filePath);
  if (!stat) throw Object.assign(new Error("mail archive is unavailable"), { code: "ENOENT" });
  if (stat.size > 30 * 1024 * 1024) throw new Error("mail archive exceeds display limit");
  return await fs.promises.readFile(filePath);
}

async function resolveMailArchivePath(event: any) {
  const rawPath = String(event?.payload?.rawPath || "").trim();
  if (rawPath) {
    const resolved = path.resolve(rawPath);
    assertInside(config.mailIngressDir, resolved);
    if (await mailArchiveFileStat(resolved)) return resolved;
  }
  const objectId = String(event?.payload?.rawObjectId || "").trim();
  if (!objectId) throw Object.assign(new Error("mail archive has no managed object"), { code: "ENOENT" });
  const materialized = await managedFiles.materialize(objectId, { ttlDays: 1, taskId: `mail-view-${event.id}` });
  if (!materialized.localPath) throw Object.assign(new Error("mail archive materialization failed"), { code: "ENOENT" });
  return materialized.localPath;
}

async function mailArchiveFileStat(filePath: string) {
  try {
    const targetRealPath = await fs.promises.realpath(filePath);
    let allowed = false;
    for (const root of [config.mailIngressDir, config.materializedFilesDir]) {
      try {
        const rootRealPath = await fs.promises.realpath(root);
        assertInside(rootRealPath, targetRealPath);
        allowed = true;
        break;
      } catch (error: any) {
        if (error?.code === "ENOENT" || error?.code === "ENOTDIR") continue;
        if (error instanceof Error && error.message === "resolved path escapes the allowed directory") continue;
        throw error;
      }
    }
    if (!allowed) throw new Error("mail archive path escapes managed roots");
    const stat = await fs.promises.stat(targetRealPath);
    return stat.isFile() ? stat : null;
  } catch (error: any) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
}

function sendPrivateDownload(response: http.ServerResponse, content: Buffer, contentType: string, fileName: string, head = false) {
  response.writeHead(200, {
    "Content-Type": safeMimeType(contentType),
    "Content-Length": String(content.length),
    "Content-Disposition": `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  });
  response.end(head ? undefined : content);
}

function safeDownloadName(value: string) {
  const normalized = String(value || "download").replace(/[\\/:*?"<>|\x00-\x1f]+/g, "-").replace(/\s+/g, " ").trim();
  return normalized.slice(0, 160) || "download";
}

function safeMimeType(value: string) {
  const normalized = String(value || "application/octet-stream").toLowerCase();
  return /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(normalized) ? normalized : "application/octet-stream";
}

async function servePrivateFile(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  url: URL,
  mode: string,
  encodedPath: string,
) {
  try {
    const segments = decodePrivateAttachmentPath(encodedPath);
    const relativePath = segments.join("/");
    const targetPath = path.join(config.inboundAttachmentsDir, ...segments);
    assertInside(config.inboundAttachmentsDir, targetPath);
    const localStat = await regularFileStat(targetPath);
    const remoteHead = localStat ? null : await headPrivateAttachment(relativePath);
    if (!localStat && !remoteHead) throw Object.assign(new Error("not found"), { code: "ENOENT" });
    const fileName = storedAttachmentDisplayName(targetPath);
    const mimeType = String(mime.lookup(fileName) || remoteHead?.res?.headers?.["content-type"] || "application/octet-stream");
    const sizeBytes = localStat?.size || Number(remoteHead?.res?.headers?.["content-length"] || 0);
    const kind = privateFilePreviewKind(mimeType);

    if (mode === "view") {
      const rawUrl = `/private-files/raw/${encodedPath}`;
      let textContent = "";
      if (kind === "text" && sizeBytes <= 512 * 1024) {
        const content = localStat
          ? await fs.promises.readFile(targetPath)
          : await readPrivateAttachment(relativePath, 512 * 1024);
        textContent = content?.toString("utf8") || "无法读取文本预览，请下载后查看。";
      }
      const html = renderPrivateFilePreview({ fileName, rawUrl, mimeType, sizeBytes, kind, textContent });
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": Buffer.byteLength(html),
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; media-src 'self'; frame-src 'self'",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      });
      response.end(request.method === "HEAD" ? undefined : html);
      return;
    }

    const download = url.searchParams.get("download") === "1" || kind === "download";
    if (!localStat) {
      const signed = signPrivateAttachmentUrl(relativePath, 300, download ? { downloadName: fileName } : undefined);
      response.writeHead(302, {
        Location: signed.url,
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      });
      response.end();
      return;
    }
    streamPrivateFile(request, response, targetPath, localStat, mimeType, fileName, download);
  } catch (error: any) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR" || error?.status === 404 || error?.code === "NoSuchKey") {
      sendText(response, 404, "Not Found", request.method === "HEAD");
    } else throw error;
  }
}

async function regularFileStat(filePath: string) {
  try {
    const rootRealPath = await fs.promises.realpath(config.inboundAttachmentsDir);
    const targetRealPath = await fs.promises.realpath(filePath);
    assertInside(rootRealPath, targetRealPath);
    const stat = await fs.promises.stat(targetRealPath);
    return stat.isFile() ? stat : null;
  } catch (error: any) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
}

function streamPrivateFile(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  filePath: string,
  stat: fs.Stats,
  mimeType: string,
  fileName: string,
  download: boolean,
) {
  const range = parseByteRange(String(request.headers.range || ""), stat.size);
  if (range === false) {
    response.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
    response.end();
    return;
  }
  const start = range?.start || 0;
  const end = range?.end ?? stat.size - 1;
  const contentLength = Math.max(0, end - start + 1);
  response.writeHead(range ? 206 : 200, {
    "Content-Type": mimeType,
    "Content-Length": contentLength,
    ...(range ? { "Content-Range": `bytes ${start}-${end}/${stat.size}` } : {}),
    "Accept-Ranges": "bytes",
    "Content-Disposition": contentDisposition(download ? "attachment" : "inline", fileName),
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  });
  if (request.method === "HEAD") response.end();
  else fs.createReadStream(filePath, { start, end }).pipe(response);
}

function parseByteRange(value: string, size: number): { start: number; end: number } | false | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) return false;
  let start = match[1] ? Number(match[1]) : Number.NaN;
  let end = match[2] ? Number(match[2]) : Number.NaN;
  if (Number.isNaN(start) && Number.isNaN(end)) return false;
  if (Number.isNaN(start)) {
    const suffix = Math.min(end, size);
    start = size - suffix;
    end = size - 1;
  } else if (Number.isNaN(end)) end = size - 1;
  if (start < 0 || end < start || start >= size) return false;
  return { start, end: Math.min(end, size - 1) };
}

function resolvePrivateFileRelativePath(fileInput: unknown, relativeInput: unknown) {
  const relative = String(relativeInput || "").trim();
  if (relative) return decodePrivateAttachmentPath(relative.split("/").map(encodeURIComponent).join("/")).join("/");
  const filePath = String(fileInput || "").trim();
  const resolved = relativeAttachmentPath(config.inboundAttachmentsDir, filePath);
  if (!resolved) throw new Error("file must be inside the private attachment directory");
  return resolved;
}

function contentDisposition(type: string, fileName: string) {
  const fallback = String(fileName || "file").replace(/[^A-Za-z0-9._-]/g, "_") || "file";
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName || "file")}`;
}

async function serveStatic(request: http.IncomingMessage, response: http.ServerResponse, pathname: string) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendText(response, 405, "Method Not Allowed", request.method === "HEAD");
    return;
  }
  try {
    const { rootDir, relativePath } = staticRootForPath(pathname);
    const decoded = decodeURIComponent(relativePath);
    const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
    const targetPath = path.join(rootDir, normalized);
    assertInside(rootDir, targetPath);
    const stat = await fs.promises.stat(targetPath);
    const finalPath = stat.isDirectory() ? path.join(targetPath, "index.html") : targetPath;
    const finalStat = stat.isDirectory() ? await fs.promises.stat(finalPath) : stat;
    if (!finalStat.isFile()) throw Object.assign(new Error("not found"), { code: "ENOENT" });
    response.writeHead(200, {
      "Content-Type": mime.lookup(finalPath) || "application/octet-stream",
      "Content-Length": finalStat.size,
      "Cache-Control": pathname === "/uploads/releases/index.html"
        ? "no-cache, no-store, must-revalidate"
        : pathname.startsWith("/uploads/") ? "public, max-age=31536000, immutable" : "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    if (request.method === "HEAD") response.end();
    else fs.createReadStream(finalPath).pipe(response);
  } catch (error: any) {
    if ((error?.code === "ENOENT" || error?.code === "ENOTDIR") && pathname.startsWith("/uploads/")) {
      const managed = managedFileCatalog.getByRelativePath("public", pathname.slice(1));
      if (managed?.status === "ready" && managed.remoteVerifiedAt) {
        response.writeHead(302, {
          Location: managedStorage.publicUrl(managed),
          "Cache-Control": "public, max-age=300",
          "X-Content-Type-Options": "nosniff",
        });
        response.end();
        return;
      }
      sendText(response, 404, "Not Found", request.method === "HEAD");
    }
    else if (error?.code === "ENOENT" || error?.code === "ENOTDIR") sendText(response, 404, "Not Found", request.method === "HEAD");
    else throw error;
  }
}

function staticRootForPath(pathname: string) {
  if (pathname.startsWith("/uploads/")) {
    return { rootDir: config.uploadsDir, relativePath: pathname.slice("/uploads/".length) };
  }
  if (pathname.startsWith("/pages/")) {
    return { rootDir: config.pagesDir, relativePath: pathname.slice("/pages/".length) };
  }
  return { rootDir: config.publicDir, relativePath: pathname };
}

async function readJsonBody(request: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function resolveLocalMediaFile(input: unknown) {
  const requested = String(input || "").trim();
  if (!requested) throw new Error("filePath is required");
  const resolved = path.resolve(requested);
  const stat = await fs.promises.stat(resolved);
  if (!stat.isFile()) throw new Error("filePath must point to a regular file");
  return resolved;
}

function resolveMemorySessionId(input: unknown) {
  const sessionId = String(input || store.getDefaultMemorySessionId() || "").trim();
  if (!sessionId || !store.getSessionRecord(sessionId)) throw new Error("valid memory session is required");
  return sessionId;
}

function scheduledTaskInput(body: any) {
  const cron = String(body.cron || body.schedule || "").trim();
  parseCronExpression(cron);
  assertMinimumCronInterval(cron);
  const workspace = findWorkspace(body.workspaceName || body.workspace);
  return {
    name: body.name,
    cron,
    timezone: normalizeTimezone(body.timezone || config.schedulerTimezone),
    prompt: body.prompt || body.taskDescription || body.content,
    workspaceName: String(body.workspaceName || body.workspace || workspace?.name || "").trim(),
    workspaceRoot: String(body.workspaceRoot || workspace?.workspaceRoot || "").trim(),
    recipientId: body.recipientId || body.recipient_id || "",
    enabled: body.enabled !== false && body.enabled !== 0 && body.enabled !== "0",
  };
}

function dataPageQuery(searchParams: URLSearchParams) {
  const search = String(searchParams.get("search") || "").trim();
  const field = String(searchParams.get("field") || "").trim();
  const operator = String(searchParams.get("operator") || "eq").trim();
  const value = searchParams.get("value") || "";
  const groupBy = String(searchParams.get("groupBy") || "").trim();
  const metricFunction = String(searchParams.get("metricFunction") || "count").trim();
  const metricField = String(searchParams.get("metricField") || "").trim();
  const sortField = String(searchParams.get("sortField") || "").trim();
  const sortDirection = String(searchParams.get("sortDirection") || "asc").trim() === "desc" ? "desc" : "asc";
  const page = Math.max(Number.parseInt(searchParams.get("page") || "1", 10) || 1, 1);
  const filters = field ? [{ field, operator, value }] : [];
  const metrics = groupBy || metricField ? [{ function: metricFunction, field: metricFunction === "count" && !metricField ? "" : metricField }] : [];
  return {
    display: { search, field, operator, value, groupBy, metricFunction, metricField, sortField, sortDirection, page },
    ast: {
      search,
      filters,
      groupBy: groupBy ? [groupBy] : [],
      metrics,
      sort: sortField ? [{ field: sortField, direction: sortDirection }] : [],
      page: { number: page, size: 25 },
    },
  };
}

function scheduledTaskPatch(current: any, body: any) {
  const next = {
    name: body.name === undefined ? current.name : body.name,
    cron: body.cron === undefined && body.schedule === undefined ? current.cron : String(body.cron || body.schedule || "").trim(),
    timezone: body.timezone === undefined ? current.timezone : normalizeTimezone(body.timezone),
    prompt: body.prompt === undefined && body.taskDescription === undefined && body.content === undefined
      ? current.prompt
      : body.prompt || body.taskDescription || body.content,
    workspaceName: body.workspaceName === undefined && body.workspace === undefined ? current.workspaceName : String(body.workspaceName || body.workspace || "").trim(),
    workspaceRoot: body.workspaceRoot === undefined ? current.workspaceRoot : String(body.workspaceRoot || "").trim(),
    recipientId: body.recipientId === undefined && body.recipient_id === undefined ? current.recipientId : String(body.recipientId || body.recipient_id || "").trim(),
    enabled: body.enabled === undefined ? current.enabled : body.enabled !== false && body.enabled !== 0 && body.enabled !== "0",
  };
  parseCronExpression(next.cron);
  assertMinimumCronInterval(next.cron);
  const workspace = findWorkspace(next.workspaceName);
  if (!next.workspaceRoot && workspace?.workspaceRoot) next.workspaceRoot = workspace.workspaceRoot;
  return {
    ...next,
    nextRunAt: next.enabled ? nextRunAt(next.cron, new Date(), next.timezone).toISOString() : null,
    lastError: "",
  };
}

function findWorkspace(name: string) {
  const workspaceName = String(name || "").trim();
  const workspaces = store.listWorkspaces();
  if (workspaceName) return workspaces.find((workspace) => workspace.name === workspaceName) || null;
  return workspaces[0] || null;
}

function syncTemplateRuntimeState(templateId: string, state: any, manifest: any = null) {
  const current = store.getAutomationTemplate(templateId);
  if (!current) throw new Error("automation template metadata not found");
  return store.upsertAutomationTemplate({
    ...current,
    ...(manifest ? {
      name: manifest.name || current.name,
      purpose: manifest.purpose || current.purpose,
      sourceFingerprint: manifest.sourceFingerprint || current.sourceFingerprint,
      runtime: manifest.runtime || current.runtime,
      version: manifest.version || state.version,
      sha256: manifest.sha256 || current.sha256,
      codeObjectId: manifest.sourcePath || current.codeObjectId,
    } : { version: state.version }),
    status: state.status,
    successCount: state.successCount,
    failureCount: state.failureCount,
  });
}

function isAuthorized(request: http.IncomingMessage) {
  const authorization = String(request.headers.authorization || "");
  if (config.apiToken && authorization === `Bearer ${config.apiToken}`) return true;
  if (personalAuth.isCookieAuthorized(request)) return true;
  return isTrustedProxyRequest(request) && String(request.headers["x-personal-agent-authenticated"] || "") === "1";
}

function isAgentWriteAuthorized(request: http.IncomingMessage) {
  const authorization = String(request.headers.authorization || "");
  if (config.apiToken && authorization === `Bearer ${config.apiToken}`) return true;
  return process.env.NODE_ENV !== "production" && isTrustedLocalRequest(request);
}

function isMailIngestAuthorized(request: http.IncomingMessage) {
  const authorization = String(request.headers.authorization || "");
  return Boolean(config.mailIngestToken && authorization === `Bearer ${config.mailIngestToken}`);
}

function sendForbidden(response: http.ServerResponse) {
  sendJson(response, 403, { ok: false, error: "Agent write permission required" });
}

function isTrustedLocalRequest(request: http.IncomingMessage) {
  if (request.headers["x-forwarded-for"]) return false;
  const address = request.socket.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function isTrustedProxyRequest(request: http.IncomingMessage) {
  const address = request.socket.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function sendUnauthorized(request: http.IncomingMessage, response: http.ServerResponse, url: URL) {
  if ((request.method === "GET" || request.method === "HEAD") && !url.pathname.startsWith("/api/")) {
    sendRedirect(response, `/login?return_to=${encodeURIComponent(`${url.pathname}${url.search}`)}`, request.method === "HEAD");
    return;
  }
  sendJson(response, 401, {
    ok: false,
    error: "Authentication required",
    login: `/login?return_to=${encodeURIComponent(`${url.pathname}${url.search}`)}`,
  }, request.method === "HEAD");
}

function isUploadAuthorized(request: http.IncomingMessage) {
  return String(request.headers.authorization || "") === `Bearer ${config.uploadToken}`;
}

function sendHtml(response: http.ServerResponse, statusCode: number, html: string, head = false) {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(head ? undefined : html);
}

function sendPrivateHtml(response: http.ServerResponse, statusCode: number, html: string, head = false) {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  });
  response.end(head ? undefined : html);
}

function sendPrivateAppHtml(response: http.ServerResponse, statusCode: number, html: string, head = false) {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  });
  response.end(head ? undefined : html);
}

function sendRedirect(response: http.ServerResponse, location: string, head = false) {
  response.writeHead(302, {
    Location: location,
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(head ? undefined : "");
}

function sendText(response: http.ServerResponse, statusCode: number, text: string, head = false) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(head ? undefined : `${text}\n`);
}

function sendJson(response: http.ServerResponse, statusCode: number, payload: unknown, head = false) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(head ? undefined : JSON.stringify(payload, null, 2));
}

function beginJsonStream(response: http.ServerResponse) {
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  response.flushHeaders();
}

function sendChannelJson(response: http.ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function sendJsonRpcError(response: http.ServerResponse, httpStatus: number, code: number, message: string) {
  response.writeHead(httpStatus, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}
