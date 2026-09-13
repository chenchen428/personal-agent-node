export type SpaceRuntimeTarget = {
  id: string;
  state: string;
  desiredState: "running" | "stopped";
  localUrl: string;
  managedHost: string | null;
};

type SpacesSnapshot = { spaces: SpaceRuntimeTarget[] };
type FetchResponse = Pick<Response, "ok" | "status" | "json">;
type FetchLike = (input: string, init?: RequestInit) => Promise<FetchResponse>;

export async function waitForSpaceRuntime(
  target: SpaceRuntimeTarget,
  {
    fetchImpl = fetch,
    sleep = defaultSleep,
    timeoutMs = 30_000,
    pollIntervalMs = 300,
    signal,
  }: {
    fetchImpl?: FetchLike;
    sleep?: (milliseconds: number) => Promise<void>;
    timeoutMs?: number;
    pollIntervalMs?: number;
    signal?: AbortSignal;
  } = {},
) {
  signal?.throwIfAborted();
  if (target.state === "running") return target;
  const deadline = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;

  try {
    if (target.desiredState !== "running") {
      await readJsonResponse(await fetchImpl("/api/system/spaces", {
        method: "POST",
        headers: { "content-type": "application/json", "x-personal-agent-surface": "desktop" },
        body: JSON.stringify({ action: "start", spaceId: target.id }),
        signal: requestSignal,
      }));
    }

    const attempts = Math.max(1, Math.ceil(timeoutMs / pollIntervalMs));
    for (let attempt = 0; attempt <= attempts; attempt += 1) {
      requestSignal.throwIfAborted();
      const snapshot = await readJsonResponse<SpacesSnapshot>(await fetchImpl("/api/system/spaces", { cache: "no-store", signal: requestSignal, headers: { "x-personal-agent-surface": "desktop" } }));
      requestSignal.throwIfAborted();
      const current = snapshot.spaces.find((space) => space.id === target.id);
      if (!current) throw new Error("隔离空间不存在");
      if (current.state === "running") return current;
      if (["deleting", "deleted"].includes(current.state)) throw new Error("隔离空间已被删除");
      if (attempt < attempts) await sleep(pollIntervalMs);
    }

    throw new Error("隔离空间启动超时，请稍后重试");
  } catch (cause) {
    if (deadline.aborted && !signal?.aborted) throw new Error("隔离空间启动超时，请稍后重试");
    throw cause;
  }
}

export function buildSpaceNavigationUrl(
  space: Pick<SpaceRuntimeTarget, "localUrl" | "managedHost">,
  currentHref: string,
) {
  const current = new URL(currentHref);
  const local = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(current.hostname);
  const origin = local || !space.managedHost ? new URL(space.localUrl).origin : `https://${space.managedHost}`;
  return `${origin}${spaceNavigationPath(current.pathname)}`;
}

/** Only fixed module destinations can cross Spaces, never object IDs or search text. */
export function spaceNavigationPath(pathname: string) {
  const aliases: Record<string, string> = {
    "/app/mobile/workers/plans": "/app/mobile/workers/calendar", "/app/mobile/calendar": "/app/mobile/workers/calendar",
    "/app/chat": "/app/conversations", "/app/calendar": "/app/workers/calendar",
    "/app/workers/plans": "/app/workers/calendar", "/app/workers/schedules": "/app/workers/calendar",
    "/app/automations": "/app/workers/calendar", "/app/schedules": "/app/workers/calendar",
  };
  const destinations = [
    "/app/mobile/workers/calendar", "/app/mobile/workers/plans", "/app/mobile/calendar", "/app/mobile/conversations",
    "/app/mobile/workers", "/app/mobile/pages", "/app/mobile/mail", "/app/mobile/about",
    "/app/workers/calendar", "/app/settings/memory", "/app/connections/wechat-personal", "/app/statistics/token-usage",
    ...Object.keys(aliases), "/app/conversations", "/app/connections", "/app/workers", "/app/mail",
    "/app/data", "/app/pages", "/app/runtime", "/app/settings", "/app/skills", "/app/update", "/app/setup",
  ];
  const destination = destinations.find((route) => pathname === route || pathname.startsWith(`${route}/`));
  return destination ? aliases[destination] || destination : pathname.startsWith("/app/mobile") ? "/app/mobile" : "/app";
}

async function readJsonResponse<T>(response: FetchResponse) {
  const body = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body?.error?.message || `隔离空间请求失败（${response.status}）`);
  return body;
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
