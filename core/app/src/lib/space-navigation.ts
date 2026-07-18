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
  }: {
    fetchImpl?: FetchLike;
    sleep?: (milliseconds: number) => Promise<void>;
    timeoutMs?: number;
    pollIntervalMs?: number;
  } = {},
) {
  if (target.state === "running") return target;

  if (target.desiredState !== "running") {
    await readJsonResponse(await fetchImpl("/api/system/spaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "start", spaceId: target.id }),
    }));
  }

  const attempts = Math.max(1, Math.ceil(timeoutMs / pollIntervalMs));
  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    const snapshot = await readJsonResponse<SpacesSnapshot>(await fetchImpl("/api/system/spaces", { cache: "no-store" }));
    const current = snapshot.spaces.find((space) => space.id === target.id);
    if (!current) throw new Error("隔离空间不存在");
    if (current.state === "running") return current;
    if (["deleting", "deleted"].includes(current.state)) throw new Error("隔离空间已被删除");
    if (attempt < attempts) await sleep(pollIntervalMs);
  }

  throw new Error("隔离空间启动超时，请稍后重试");
}

export function buildSpaceNavigationUrl(
  space: Pick<SpaceRuntimeTarget, "localUrl" | "managedHost">,
  currentHref: string,
) {
  const current = new URL(currentHref);
  const local = ["127.0.0.1", "localhost", "::1"].includes(current.hostname);
  const origin = local || !space.managedHost ? new URL(space.localUrl).origin : `https://${space.managedHost}`;
  return `${origin}${current.pathname}${current.search}${current.hash}`;
}

async function readJsonResponse<T>(response: FetchResponse) {
  const body = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body?.error?.message || `隔离空间请求失败（${response.status}）`);
  return body;
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
