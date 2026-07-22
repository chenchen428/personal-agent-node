import type { NextRequest } from "next/server";
import { isLocalDesktopSpaceManagementRequest } from "@/lib/request-device";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const hopByHopHeaders = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length",
  "expect",
]);

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (isSpaceManagementPath(path) && !isLocalDesktopSpaceManagementRequest(request.headers)) {
    return Response.json({ ok: false, error: { code: "DESKTOP_LOCAL_ONLY", message: "隔离空间管理仅支持本机桌面端" } }, { status: 403 });
  }
  const upstream = resolveUpstream(path);
  const upstreamOrigin = upstream.target === "control"
    ? process.env.PERSONAL_AGENT_CONTROL_URL || "http://127.0.0.1:8792"
    : process.env.OPEN_AGENT_BRIDGE_INTERNAL_URL || "http://127.0.0.1:8788";
  const target = new URL(`/api/${upstream.path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`, upstreamOrigin);
  const headers = new Headers(request.headers);
  for (const name of hopByHopHeaders) headers.delete(name);
  headers.set("x-personal-agent-internal", "next-bff");
  headers.set("x-personal-agent-authenticated", "1");
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
  try {
    const upstreamResponse = await fetch(target, { method: request.method, headers, body, redirect: "manual", cache: "no-store" });
    const responseHeaders = new Headers(upstreamResponse.headers);
    for (const name of hopByHopHeaders) responseHeaders.delete(name);
    responseHeaders.set("cache-control", "private, no-store");
    return new Response(upstreamResponse.body, { status: upstreamResponse.status, headers: responseHeaders });
  } catch (cause) {
    console.error("[personal-agent-bff] loopback upstream failed", {
      target: upstream.target,
      url: target.href,
      error: cause instanceof Error ? cause.message : String(cause),
      detail: cause instanceof Error && cause.cause instanceof Error ? cause.cause.message : "",
    });
    return Response.json({ ok: false, error: {
      code: upstream.target === "control" ? "CONTROL_UNAVAILABLE" : "AGENT_UNAVAILABLE",
      message: upstream.target === "control" ? "本机控制服务尚未就绪" : "本机 Agent 服务尚未就绪",
    } }, { status: 503 });
  }
}

function isSpaceManagementPath(path: string[]) {
  const normalized = path[0] === "system" ? path.slice(1) : path;
  return normalized.length === 1 && normalized[0] === "spaces";
}

function resolveUpstream(path: string[]): { target: "control" | "agent"; path: string[] } {
  if (path[0] === "system") return { target: "control", path: path.slice(1) };
  const controlRoots = new Set(["apps", "authorization", "data-export", "extensions", "mail", "onboarding", "plugins", "projects", "server-status", "setup", "spaces", "update", "wechat"]);
  if (controlRoots.has(path[0])) return { target: "control", path };
  if (path[0] === "app") {
    const appRoutes: Record<string, string> = { data: "agent-data", schedules: "agent-corn", mail: "mail" };
    const mapped = appRoutes[path[1]];
    return mapped
      ? { target: "agent", path: [mapped, ...path.slice(2)] }
      : { target: "control", path };
  }
  if (path[0] === "chat") {
    return path[1] === "bridge"
      ? { target: "agent", path: ["agent-bridge", ...path.slice(2)] }
      : { target: "agent", path: path.slice(1) };
  }
  if (path[0] === "publications") return { target: "agent", path: ["pages", ...path.slice(1)] };
  return { target: "agent", path };
}

export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
