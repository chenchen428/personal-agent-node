import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import httpProxy from "http-proxy";
import mime from "mime-types";
import { resolveNodeConfig, workspaceRoot } from "./config.mjs";
import { listExtensions } from "./extensions.mjs";

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

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
      const url = new URL(request.url || "/", `http://${host || "localhost"}`);
      if (url.pathname === "/__private-site/health") {
        sendJson(response, 200, { ok: true, service: "private-site-gateway", site: config.domain, tls: gatewayUsesTls(config) }, request.method === "HEAD");
        return;
      }
      if (url.pathname === "/login" || url.pathname === "/logout") {
        proxyHttp(proxy, routeForBridge(config), request, response, config, false, url);
        return;
      }
      const route = matchRoute(routes, host, url.pathname, config);
      if (!route) {
        sendText(response, 404, "Unknown Site route\n", request.method === "HEAD");
        return;
      }
      if (route.kind === "static") {
        await serveStatic(route, request, response, url);
        return;
      }
      const authorized = await authorizeRoute(request, route, config);
      if (!authorized) {
        response.writeHead(302, { Location: `/login?return_to=${encodeURIComponent(`${url.pathname}${url.search}`)}`, "Cache-Control": "no-store" });
        response.end();
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
      const url = new URL(request.url || "/", `http://${host || "localhost"}`);
      const route = matchRoute(routes, host, url.pathname, config);
      if (!route?.target || !route.websocket) return rejectUpgrade(socket, 404);
      if (!await authorizeRoute(request, route, config)) return rejectUpgrade(socket, 401);
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
  const access = route.access || "public";
  if (access === "public") return true;
  if (access === "internal") return false;
  if (!await authorizeRequest(request, config)) return false;
  if (access === "authenticated") return true;
  if (access === "local-admin") return isLoopbackAddress(request.socket.remoteAddress);
  return false;
}

function isLoopbackAddress(value) {
  const address = normalizeRemoteAddress(value);
  return address === "127.0.0.1" || address === "::1";
}

function proxyHttp(proxy, route, request, response, config, authenticated, url) {
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

function normalizeRoute(entry, config) {
  const toolsRoot = path.join(workspaceRoot, "projects", "personal", "lmt_tools");
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
    access: entry.access || "public",
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
