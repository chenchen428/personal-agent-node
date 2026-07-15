import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const hopByHopHeaders = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length",
]);

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const controlOrigin = process.env.PERSONAL_AGENT_CONTROL_URL || "http://127.0.0.1:8792";
  const controlPath = path[0] === "system" ? path.slice(1) : path;
  const target = new URL(`/api/${controlPath.map(encodeURIComponent).join("/")}${request.nextUrl.search}`, controlOrigin);
  const headers = new Headers(request.headers);
  for (const name of hopByHopHeaders) headers.delete(name);
  headers.set("x-personal-agent-internal", "next-bff");
  headers.set("x-personal-agent-authenticated", "1");
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
  try {
    const upstream = await fetch(target, { method: request.method, headers, body, redirect: "manual", cache: "no-store" });
    const responseHeaders = new Headers(upstream.headers);
    for (const name of hopByHopHeaders) responseHeaders.delete(name);
    responseHeaders.set("cache-control", "private, no-store");
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return Response.json({ ok: false, error: { code: "CONTROL_UNAVAILABLE", message: "本机控制服务尚未就绪" } }, { status: 503 });
  }
}

export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
