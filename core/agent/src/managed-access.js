export const TASK_ACCESS_UNAVAILABLE = "暂未配置可访问的公网域名，无法在线查看任务进度。";
export const TASK_ACCESS_OFFLINE = "远程连接暂时离线，当前无法在线查看任务进度。";

export function buildManagedTaskAccess(sessionId, externalAccess, { role = "worker" } = {}) {
  const id = String(sessionId || "").trim();
  const internalUrl = id ? `/app/chat/session/${encodeURIComponent(id)}/live` : "";
  const access = resolveAccess(externalAccess);
  const origin = managedOrigin(access);
  const mobileSection = role === "worker" ? "workers" : "conversations";
  return {
    internalUrl,
    url: internalUrl && origin
      ? new URL(`/app/mobile/${mobileSection}/${encodeURIComponent(id)}`, `${origin}/`).href
      : "",
    linkNotice: origin ? "" : taskLinkNotice(access?.reason),
  };
}

export function taskLinkNotice(reason) {
  return reason === "tunnel-offline" ? TASK_ACCESS_OFFLINE : TASK_ACCESS_UNAVAILABLE;
}

function resolveAccess(value) {
  try { return typeof value === "function" ? value() : value; }
  catch { return null; }
}

function managedOrigin(access) {
  if (!access?.ready || !access.origin) return "";
  try {
    const url = new URL(String(access.origin));
    return url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}
