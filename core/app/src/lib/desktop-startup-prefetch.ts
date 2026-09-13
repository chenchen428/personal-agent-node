import { desktopPrefetchUrls, prefetchDesktopData } from "./desktop-prefetch";

const calendar = ["/api/calendar?limit=50&offset=0&view=upcoming", "/api/calendar?view=upcoming&limit=1"];
const pageRequests: Record<string, string[]> = {
  "/app": ["/api/node/v1/client/overview"],
  "/app/conversations": ["/api/chat/desktop/conversation?limit=40"],
  "/app/connections": ["/api/connections"],
  "/app/workers": ["/api/chat/sessions?limit=50", "/api/calendar?view=upcoming&limit=1"],
  "/app/workers/calendar": calendar, "/app/calendar": calendar,
  "/app/workers/plans": calendar, "/app/workers/schedules": calendar,
  "/app/mail": ["/api/app/mail/messages"],
  "/app/data": ["/api/app/data/schema?counts=0&preview=1"],
  "/app/pages": ["/api/node/v1/client/pages"],
  "/app/statistics/token-usage": ["/api/token-usage?range=7d"],
  "/app/runtime": ["/api/node/v1/client/runtime", "/api/system/agent-runtime"],
  "/app/settings": ["/api/system/authorization", "/api/system/token-limit", "/api/system/mail/status"],
  "/app/settings/memory": ["/api/memories?status=active&query=&limit=200"],
  "/app/skills": ["/api/skills"], "/app/update": ["/api/system/update"], "/app/setup": ["/api/system/setup"],
};

/** Only verified current-Space data participates; slow unrelated menus stay in the background. */
export async function prepareDesktopStartup(pathname: string, signal: AbortSignal, {
  prefetch = prefetchDesktopData, onReady,
}: { prefetch?: typeof prefetchDesktopData; onReady: () => void }) {
  const foreground = pageRequests[pathname] || [];
  await prefetch({ urls: foreground, signal });
  if (signal.aborted) return;
  onReady();
  const remaining = desktopPrefetchUrls().filter((url) => !foreground.includes(url));
  await prefetch({ urls: remaining, signal });
}
