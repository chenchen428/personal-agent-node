import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import httpProxy from "http-proxy";
import mime from "mime-types";
import { resolveNodeConfig, workspaceRoot } from "./config.ts";
import { listExtensions } from "./extensions.ts";
import { resolveDefaultPersonalApp, resolvePersonalAppAsset } from "./apps.ts";
import { getSpace } from "./space-registry.ts";

const isEntrypoint = ["gateway.mjs", "gateway.ts"].includes(path.basename(process.argv[1] || ""));

export function createPrivateSiteGateway(options = {}) {
  const config = options.config || resolveNodeConfig();
  const routes = buildRoutes(config);
  const proxy = httpProxy.createProxyServer({ ws: true, xfwd: false, changeOrigin: false, ignorePath: false });
  proxy.on("error", (error, _request, responseOrSocket) => {
    if (typeof responseOrSocket?.writeHead === "function") {
      if (!responseOrSocket.headersSent) responseOrSocket.writeHead(502, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      responseOrSocket.end("Origin unavailable\n");
      return;
    }
    responseOrSocket?.destroy?.();
    if (options.logger) options.logger(`proxy error: ${error.message}`);
  });
  proxy.on("proxyRes", (proxyResponse, request) => {
    const gatewayRequest = request as typeof request & {
      __personalAgentPublic?: boolean;
      __personalAgentAllowResponseCookies?: boolean;
    };
    if (gatewayRequest.__personalAgentPublic === true && gatewayRequest.__personalAgentAllowResponseCookies !== true) {
      delete proxyResponse.headers["set-cookie"];
    }
  });

  const handler = async (request, response) => {
    try {
      if (!edgeClientAuthorized(request, config)) {
        sendText(response, 403, "Unrecognized Edge identity\n", request.method === "HEAD");
        return;
      }
      const host = normalizeRequestHost(request.headers.host);
      if (!hostAllowed(host, config)) {
        sendText(response, 404, "Unknown Site hostname\n", request.method === "HEAD");
        return;
      }
      if (!requestPathAllowed(request.url)) {
        sendText(response, 400, "Unsafe request path\n", request.method === "HEAD");
        return;
      }
      const spaceProxy = resolveRelaySpaceProxyTarget(request, config);
      if (spaceProxy?.statusCode) {
        sendText(response, spaceProxy.statusCode, `${spaceProxy.message}\n`, request.method === "HEAD");
        return;
      }
      if (spaceProxy) {
        request.headers.host = spaceProxy.host;
        proxy.web(request, response, { target: spaceProxy.target });
        return;
      }
      const url = new URL(request.url || "/", `http://${host || "localhost"}`);
      const mailIngest = resolveRelayMailIngestTarget(request, url, config);
      if (mailIngest) {
        if (mailIngest.statusCode) {
          sendText(response, mailIngest.statusCode, `${mailIngest.message}\n`, request.method === "HEAD");
          return;
        }
        prepareRelayMailIngestProxy(request, config, mailIngest);
        proxy.web(request, response, { target: mailIngest.target });
        return;
      }
      if (url.pathname === "/__private-site/health") {
        sendJson(response, 200, { ok: true, service: "private-site-gateway", site: config.domain, tls: gatewayUsesTls(config) }, request.method === "HEAD");
        return;
      }
      const personalWechatCallback = resolvePersonalWechatCallbackTarget(request, url, config, options.personalWechatSpaceResolver);
      if (personalWechatCallback) {
        if (personalWechatCallback.statusCode) {
          sendText(response, personalWechatCallback.statusCode, `${personalWechatCallback.message}\n`, request.method === "HEAD");
          return;
        }
        preparePersonalWechatCallbackProxyHeaders(request);
        request.url = personalWechatCallback.upstreamPath;
        proxy.web(request, response, { target: personalWechatCallback.target });
        return;
      }
      if (url.pathname === "/login" || url.pathname === "/logout") {
        proxyHttp(proxy, routeForBridge(config), request, response, config, false, url, { allowResponseCookies: true });
        return;
      }
      const route = matchRoute(routes, host, url.pathname, config);
      if (route?.access === "public" && request.method !== "GET" && request.method !== "HEAD") {
        sendText(response, 405, "Method Not Allowed\n", request.method === "HEAD");
        return;
      }
      const authorized = await authorizeRoute(request, route, config);
      if (!authorized) {
        response.writeHead(302, { Location: `/login?return_to=${encodeURIComponent(`${url.pathname}${url.search}`)}`, "Cache-Control": "no-store" });
        response.end();
        return;
      }
      if (!route) {
        sendText(response, 404, "Unknown Site route\n", request.method === "HEAD");
        return;
      }
      if (url.pathname === "/") {
        const resolved = resolveDefaultPersonalApp(config);
        response.writeHead(302, {
          Location: resolved.app ? `/apps/${encodeURIComponent(resolved.app.id)}/` : "/app",
          "Cache-Control": "no-store",
        });
        response.end();
        return;
      }
      if (route.kind === "personal-app") {
        await servePersonalApp(config, request, response, url);
        return;
      }
      if (route.kind === "static") {
        await serveStatic(route, request, response, url);
        return;
      }
      proxyHttp(proxy, route, request, response, config, route.access !== "public", url);
    } catch (error) {
      if (!response.headersSent) sendText(response, 500, "Gateway request failed\n", request.method === "HEAD");
      else response.end();
      options.logger?.(`gateway request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const server = gatewayUsesTls(config)
    ? https.createServer({
        cert: fs.readFileSync(config.gateway.tlsCert),
        key: fs.readFileSync(config.gateway.tlsKey),
        ca: fs.readFileSync(config.gateway.tlsCa),
        requestCert: true,
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
      }, handler)
    : http.createServer(handler);

  server.on("upgrade", async (request, socket, head) => {
    try {
      if (!edgeClientAuthorized(request, config)) return rejectUpgrade(socket, 403);
      const host = normalizeRequestHost(request.headers.host);
      if (!hostAllowed(host, config) || !requestPathAllowed(request.url)) return rejectUpgrade(socket, 404);
      const spaceProxy = resolveRelaySpaceProxyTarget(request, config);
      if (spaceProxy?.statusCode) return rejectUpgrade(socket, spaceProxy.statusCode);
      if (spaceProxy) {
        request.headers.host = spaceProxy.host;
        proxy.ws(request, socket, head, { target: spaceProxy.target });
        return;
      }
      const url = new URL(request.url || "/", `http://${host || "localhost"}`);
      const route = matchRoute(routes, host, url.pathname, config);
      if (!await authorizeRoute(request, route, config)) return rejectUpgrade(socket, 401);
      if (!route?.target || !route.websocket) return rejectUpgrade(socket, 404);
      prepareProxyHeaders(request, config, route.access !== "public");
      rewriteProxyUrl(request, route, url);
      proxy.ws(request, socket, head, { target: route.target });
    } catch {
      rejectUpgrade(socket, 500);
    }
  });

  return { server, config, routes, proxy };
}

export function buildRoutes(config) {
  const routes = new Map();
  const extensions = new Map(listExtensions(config).filter((extension) => extension.enabled !== false && extension.hostKey && extension.port).map((extension) => [extension.hostKey, extension]));
  if (config.routingMode === "path") {
    for (const entry of config.distribution.routing?.paths || []) {
      const extension = extensions.get(entry.targetKey || entry.key);
      routes.set(entry.prefix, extension
        ? { ...entry, kind: "proxy", target: `http://127.0.0.1:${extension.port}`, websocket: extension.websocket === true }
        : normalizePathRoute(entry, config));
    }
    return routes;
  }
  const entries = [...config.distribution.domain.standardHosts, ...config.distribution.domain.legacyHosts.map((entry) => ({ ...entry, access: "public" }))];
  for (const entry of entries) {
    const host = entry.prefix ? `${entry.prefix}.${config.domain}` : config.domain;
    const extension = extensions.get(entry.key);
    routes.set(host, extension
      ? { kind: "proxy", access: entry.access || "private", target: `http://127.0.0.1:${extension.port}`, websocket: extension.websocket === true }
      : normalizeRoute(entry, config));
  }
  return routes;
}

function matchRoute(routes, host, pathname, config) {
  if (config.routingMode === "host") return routes.get(toCanonicalHost(host, config));
  for (const route of [...routes.values()].sort((left, right) => right.prefix.length - left.prefix.length)) {
    if (route.exact ? pathname === route.prefix : pathname === route.prefix || pathname.startsWith(`${route.prefix}/`)) return route;
  }
  return null;
}

async function authorizeRequest(request, config) {
  const headers = {
    Host: request.headers.host || config.domain,
    "X-Forwarded-Host": request.headers.host || config.domain,
    "X-Forwarded-Proto": forwardedProtocol(request, config),
    Cookie: request.headers.cookie || "",
    Authorization: request.headers.authorization || "",
  };
  return await new Promise((resolve) => {
    const auth = http.request({ host: "127.0.0.1", port: config.ports.bridge, path: "/_auth/check", method: "GET", headers, timeout: 3000 }, (response) => {
      response.resume();
      resolve(response.statusCode === 204);
    });
    auth.on("timeout", () => { auth.destroy(); resolve(false); });
    auth.on("error", () => resolve(false));
    auth.end();
  });
}

export async function authorizeRoute(request, route, config) {
  if (isDirectLoopbackConsoleRequest(request)) return true;
  if (route?.access === "public") return true;
  return await authorizeRequest(request, config);
}

export function isDirectLoopbackConsoleRequest(request) {
  const host = normalizeRequestHost(request.headers.host);
  return isLoopbackAddress(request.socket.remoteAddress)
    && ["127.0.0.1", "localhost", "::1"].includes(host);
}

export function resolvePersonalWechatCallbackTarget(request, url, config, resolver = null) {
  const callbackPath = "/api/internal/channels/wechat-personal/callback";
  const userSpaceMatch = new RegExp(`^${callbackPath.replaceAll("/", "\\/")}\\/([a-z0-9](?:[a-z0-9-]{1,26}[a-z0-9])?)$`).exec(url.pathname);
  if (url.pathname !== callbackPath && !userSpaceMatch) return null;
  if (request.method !== "POST") return { statusCode: 405, message: "Method Not Allowed" };
  if (config.space?.kind !== "personal" || !isDirectLoopbackConsoleRequest(request)) {
    return { statusCode: 403, message: "Personal WeChat callbacks require the fixed local gateway" };
  }
  if (url.search) return { statusCode: 400, message: "Personal WeChat callback URL must not contain a query" };
  const spaceCode = userSpaceMatch?.[1] || "";
  const lookup = resolver || ((selector) => getSpace(config.installationDataRoot, selector));
  const space = lookup(spaceCode || undefined);
  if (!space || (spaceCode ? space.slug !== spaceCode || space.kind === "personal" : space.kind !== "personal")) {
    return { statusCode: 404, message: "Personal WeChat callback space was not found" };
  }
  if (space.state !== "running" || space.desiredState !== "running") return { statusCode: 503, message: "Personal WeChat callback space is not running" };
  const bridgePort = Number(space.ports?.bridge || 0);
  if (!Number.isInteger(bridgePort) || bridgePort < 1 || bridgePort > 65_535) return { statusCode: 503, message: "Personal WeChat callback target is unavailable" };
  return { target: `http://127.0.0.1:${bridgePort}`, upstreamPath: callbackPath, spaceCode: space.slug };
}

export function resolveRelaySpaceProxyTarget(request, config, resolver = null) {
  const header = request.headers["x-personal-agent-space-route"];
  delete request.headers["x-personal-agent-space-route"];
  if (header === undefined) return null;
  const slug = String(Array.isArray(header) ? header[0] : header || "").trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) return { statusCode: 400, message: "Invalid Space route" };
  const lookup = resolver || ((selector) => getSpace(config.installationDataRoot, selector));
  const space = lookup(slug);
  if (!space || space.slug !== slug || space.kind === "personal" || space.id === config.space?.id) return { statusCode: 404, message: "Space route was not found" };
  if (space.state !== "running" || space.desiredState !== "running") return { statusCode: 503, message: "Space is not running" };
  const gatewayPort = Number(space.ports?.gateway || 0);
  if (!Number.isInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65_535) return { statusCode: 503, message: "Space gateway is unavailable" };
  const site = readJson(path.join(space.root, "config", "site.json"));
  const targetHost = String(site?.asciiDomain || space.managedHost || "").trim().toLowerCase();
  if (!targetHost) return { statusCode: 503, message: "Space hostname is unavailable" };
  return { target: `http://127.0.0.1:${gatewayPort}`, host: targetHost, spaceId: space.id, slug: space.slug };
}

export function resolveRelayMailIngestTarget(request, url, config) {
  if (url.pathname !== "/__personal_agent_internal/mail-ingest") return null;
  const marker = singleHeader(request.headers["x-personal-agent-mail-ingest"]);
  const recipient = singleHeader(request.headers["x-personal-agent-envelope-recipient"]).trim().toLowerCase();
  const sender = singleHeader(request.headers["x-personal-agent-envelope-sender"]).trim().toLowerCase();
  if (marker !== "relay-v1") return { statusCode: 403, message: "Unrecognized mail Relay" };
  if (request.method !== "POST") return { statusCode: 405, message: "Method Not Allowed" };
  if (url.search) return { statusCode: 400, message: "Mail Relay URL must not contain a query" };
  if (!/^message\/rfc822(?:\s*;|$)/i.test(String(request.headers["content-type"] || ""))) return { statusCode: 415, message: "Expected message/rfc822" };
  if (!validEnvelopeAddress(recipient) || (sender && !validEnvelopeAddress(sender))) return { statusCode: 400, message: "Invalid mail envelope" };
  const recipientDomain = recipient.slice(recipient.lastIndexOf("@") + 1);
  const expectedDomain = String(config.domain || "").trim().toLowerCase();
  if (!expectedDomain || recipientDomain !== expectedDomain) return { statusCode: 404, message: "Mail recipient does not belong to this Space" };
  const token = String(config.env?.OPEN_AGENT_BRIDGE_API_TOKEN || "");
  if (!token) return { statusCode: 503, message: "Local mail ingest is unavailable" };
  return { target: `http://127.0.0.1:${config.ports.bridge}`, recipient, sender };
}

function prepareRelayMailIngestProxy(request, config, target) {
  for (const header of Object.keys(request.headers)) {
    if (header === "authorization" || header === "cookie" || header.startsWith("x-personal-agent-") || header.startsWith("x-forwarded-")) delete request.headers[header];
  }
  request.headers.authorization = `Bearer ${config.env.OPEN_AGENT_BRIDGE_API_TOKEN}`;
  request.headers["content-type"] = "message/rfc822";
  request.headers.host = `127.0.0.1:${config.ports.bridge}`;
  const query = new URLSearchParams({ recipient: target.recipient });
  if (target.sender) query.set("sender", target.sender);
  request.url = `/api/mail/import?${query}`;
}

function singleHeader(value) {
  return String(Array.isArray(value) ? value[0] : value || "");
}

function validEnvelopeAddress(address) {
  if (!address || address.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+$/.test(address)) return false;
  const [local, domain, ...extra] = address.split("@");
  return !extra.length && Boolean(local) && local.length <= 64 && /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(domain);
}

function preparePersonalWechatCallbackProxyHeaders(request) {
  for (const header of [
    "authorization",
    "cookie",
    "x-personal-agent-authenticated",
    "x-real-ip",
    "x-forwarded-for",
    "x-forwarded-proto",
    "x-forwarded-host",
  ]) delete request.headers[header];
}

function isLoopbackAddress(value) {
  const address = normalizeRemoteAddress(value);
  return address === "127.0.0.1" || address === "::1";
}

function proxyHttp(proxy, route, request, response, config, authenticated, url, { allowResponseCookies = false } = {}) {
  request.__personalAgentPublic = !authenticated;
  request.__personalAgentAllowResponseCookies = allowResponseCookies;
  prepareProxyHeaders(request, config, authenticated);
  if (url) rewriteProxyUrl(request, route, url);
  proxy.web(request, response, { target: route.target });
}

function rewriteProxyUrl(request, route, url) {
  if (!route.upstreamPath || !route.prefix) return;
  const suffix = url.pathname.slice(route.prefix.length);
  const base = route.upstreamPath === "/" ? "" : route.upstreamPath.replace(/\/$/, "");
  const pathname = `${base}${suffix || (base ? "" : "/")}` || "/";
  request.url = `${pathname}${url.search}`;
}

function prepareProxyHeaders(request, config, authenticated) {
  const protocol = forwardedProtocol(request, config);
  for (const header of ["x-personal-agent-authenticated", "x-real-ip", "x-forwarded-for", "x-forwarded-proto", "x-forwarded-host"]) delete request.headers[header];
  const remote = normalizeRemoteAddress(request.socket.remoteAddress);
  request.headers["x-real-ip"] = remote;
  request.headers["x-forwarded-for"] = remote;
  request.headers["x-forwarded-proto"] = protocol;
  request.headers["x-forwarded-host"] = request.headers.host || config.domain;
  if (authenticated) request.headers["x-personal-agent-authenticated"] = "1";
  else {
    delete request.headers.cookie;
    delete request.headers.authorization;
  }
}

async function serveStatic(route, request, response, url) {
  if (request.method !== "GET" && request.method !== "HEAD") return sendText(response, 405, "Method Not Allowed\n", request.method === "HEAD");
  const root = path.resolve(workspaceRoot, route.source);
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return sendText(response, 400, "Bad Request\n", request.method === "HEAD"); }
  const relativePath = route.prefix && route.prefix !== "/" ? pathname.slice(route.prefix.length) || "/" : pathname;
  const requested = path.resolve(root, `.${relativePath}`);
  if (requested !== root && !requested.startsWith(`${root}${path.sep}`)) return sendText(response, 403, "Forbidden\n", request.method === "HEAD");
  let filePath = requested;
  let stat = statFile(filePath);
  if (stat?.isDirectory()) {
    filePath = path.join(filePath, "index.html");
    stat = statFile(filePath);
  }
  if (!stat?.isFile()) {
    filePath = path.join(root, "index.html");
    stat = statFile(filePath);
  }
  if (!stat?.isFile()) return sendText(response, 404, "Not Found\n", request.method === "HEAD");
  response.writeHead(200, {
    "Content-Type": mime.contentType(path.extname(filePath)) || "application/octet-stream",
    "Content-Length": stat.size,
    "Cache-Control": path.extname(filePath) === ".html" ? "no-cache" : "public, max-age=86400",
    "X-Content-Type-Options": "nosniff",
  });
  if (request.method === "HEAD") return response.end();
  fs.createReadStream(filePath).on("error", () => response.destroy()).pipe(response);
}

async function servePersonalApp(config, request, response, url) {
  if (request.method !== "GET" && request.method !== "HEAD") return sendText(response, 405, "Method Not Allowed\n", request.method === "HEAD");
  if (/^\/apps\/[^/]+$/.test(url.pathname)) {
    response.writeHead(308, { Location: `${url.pathname}/${url.search}`, "Cache-Control": "no-store" });
    return response.end();
  }
  const asset = resolvePersonalAppAsset(config, url.pathname);
  if (!asset) return sendText(response, 404, "Not Found\n", request.method === "HEAD");
  const stat = statFile(asset.filePath);
  if (!stat?.isFile()) return sendText(response, 404, "Not Found\n", request.method === "HEAD");
  const contentType = mime.contentType(path.extname(asset.filePath));
  if (!contentType) return sendText(response, 404, "Not Found\n", request.method === "HEAD");
  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": stat.size,
    "Cache-Control": asset.cacheControl,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
  });
  if (request.method === "HEAD") return response.end();
  fs.createReadStream(asset.filePath).on("error", () => response.destroy()).pipe(response);
}

function normalizeRoute(entry, config) {
  const toolsRoot = path.join(workspaceRoot, "core", "tools");
  const toolsInstalled = fs.existsSync(path.join(toolsRoot, "server.js"));
  const localTargets = {
    console: `http://127.0.0.1:${config.ports.admin}`,
    admin: `http://127.0.0.1:${config.ports.admin}`,
    agent: `http://127.0.0.1:${config.ports.bridge}`,
    tools: `http://127.0.0.1:${toolsInstalled ? config.ports.tools : config.ports.admin}`,
    pages: `http://127.0.0.1:${config.ports.bridge}`,
    mail: `http://127.0.0.1:${config.ports.bridge}`,
  };
  const publicationSources = {
    home: path.join(config.dataRoot, "publications", "blog"),
    blog: path.join(config.dataRoot, "publications", "blog"),
    docs: path.join(config.dataRoot, "publications", "docs"),
    resources: path.join(config.dataRoot, "publications", "resources"),
  };
  const legacySource = entry.kind === "static"
    ? path.join(config.dataRoot, "publications", "legacy", path.basename(entry.source || entry.prefix || "site"))
    : "";
  return {
    ...entry,
    target: localTargets[entry.key] || entry.target || "",
    source: publicationSources[entry.key] || legacySource || entry.source,
    websocket: entry.websocket === true,
    access: entry.access || "authenticated",
  };
}

function normalizePathRoute(entry, config) {
  const targetKey = entry.targetKey || entry.key;
  const extension = listExtensions(config).find((candidate) => candidate.enabled !== false && candidate.hostKey === targetKey && candidate.port);
  const localTargets = {
    console: `http://127.0.0.1:${config.ports.admin}`,
    admin: `http://127.0.0.1:${config.ports.admin}`,
    agent: `http://127.0.0.1:${config.ports.bridge}`,
    mail: `http://127.0.0.1:${config.ports.bridge}`,
    files: `http://127.0.0.1:${config.ports.bridge}`,
    pages: `http://127.0.0.1:${config.ports.bridge}`,
    tools: `http://127.0.0.1:${config.ports.admin}`,
  };
  const publicationSources = {
    home: path.join(config.dataRoot, "publications", "blog"),
    blog: path.join(config.dataRoot, "publications", "blog"),
    docs: path.join(config.dataRoot, "publications", "docs"),
    resources: path.join(config.dataRoot, "publications", "resources"),
  };
  return {
    ...entry,
    target: extension ? `http://127.0.0.1:${extension.port}` : localTargets[targetKey] || "",
    source: publicationSources[targetKey] || "",
  };
}

function routeForBridge(config) {
  return { target: `http://127.0.0.1:${config.ports.bridge}`, access: "public" };
}

function toCanonicalHost(host, config) {
  if (!host) return "";
  if (host === config.localDomain) return config.domain;
  if (host.endsWith(`.${config.localDomain}`)) return `${host.slice(0, -config.localDomain.length)}${config.domain}`;
  return host;
}

function normalizeRequestHost(value) {
  const host = String(value || "").split(",")[0].trim().toLowerCase();
  if (host.startsWith("[")) return host.slice(1, host.indexOf("]"));
  return host.split(":")[0];
}

function hostAllowed(host, config) {
  if (config.routingMode === "host") return Boolean(toCanonicalHost(host, config));
  return config.allowedHosts.includes(host);
}

function requestPathAllowed(value) {
  const rawPath = String(value || "/").split("?", 1)[0];
  if (rawPath.includes("\\") || /%(?:2e|2f|5c)/i.test(rawPath)) return false;
  try {
    const decoded = decodeURIComponent(rawPath);
    return !decoded.split("/").some((segment) => segment === "." || segment === "..");
  } catch {
    return false;
  }
}

function normalizeRemoteAddress(value) {
  return String(value || "").replace(/^::ffff:/, "") || "127.0.0.1";
}

function forwardedProtocol(request, config) {
  if (config.gateway.trustEdgeHeaders) {
    const value = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    if (value === "http" || value === "https") return value;
  }
  return gatewayUsesTls(config) ? "https" : "http";
}

function gatewayUsesTls(config) {
  return Boolean(config.gateway.tlsCert && config.gateway.tlsKey && config.gateway.tlsCa);
}

function edgeClientAuthorized(request, config) {
  if (!gatewayUsesTls(config)) return true;
  const certificate = request.socket.getPeerCertificate?.();
  if (!certificate || !request.socket.authorized) return false;
  const fingerprint = String(certificate.fingerprint256 || "").replaceAll(":", "").toUpperCase();
  return Boolean(config.gateway.edgeClientFingerprint) && fingerprint === config.gateway.edgeClientFingerprint;
}

function statFile(filePath) {
  try { return fs.statSync(filePath); } catch { return null; }
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}

function sendJson(response, statusCode, value, head = false) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" });
  response.end(head ? undefined : body);
}

function sendText(response, statusCode, body, head = false) {
  response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" });
  response.end(head ? undefined : body);
}

function rejectUpgrade(socket, statusCode) {
  socket.write(`HTTP/1.1 ${statusCode} ${statusCode === 401 ? "Unauthorized" : "Not Found"}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

if (isEntrypoint) {
  const { server, config } = createPrivateSiteGateway({ logger: (message) => console.error(`[private-site-gateway] ${message}`) });
  server.listen(config.gateway.port, config.gateway.host, () => {
    console.log(`private-site-gateway listening on ${gatewayUsesTls(config) ? "https" : "http"}://${config.gateway.host}:${config.gateway.port}`);
  });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
}
