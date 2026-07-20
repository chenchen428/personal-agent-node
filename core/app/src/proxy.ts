import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isMobileRequest } from "./lib/request-device";

export function proxy(request: NextRequest) {
  if (isMobileRequest(request.headers)) {
    return NextResponse.redirect(new URL("/app/mobile", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: "/app" };
