import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isMobileRequest } from "./lib/request-device";

export function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-personal-agent-responsive-surface", isMobileRequest(request.headers) ? "mobile" : "desktop");
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = { matcher: "/app" };
