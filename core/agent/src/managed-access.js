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
    linkNotice: origin ? "" : domainAccessNotice(access, "任务进度") || taskLinkNotice(access?.reason),
  };
}

export function taskLinkNotice(reason) {
  return reason === "tunnel-offline" ? TASK_ACCESS_OFFLINE : TASK_ACCESS_UNAVAILABLE;
}

export function domainAccessNotice(access, target = "内容") {
  if (access?.inherited && access.reason === "space-offline") return `当前空间尚未运行，启动后将自动启用${target}链接，无需重复配置域名。`;
  if (access?.reason === "space-domain-verifying") return `当前空间的子域名正在自动验证，完成后即可在线查看${target}，无需重复配置。`;
  if (access?.reason === "parent-domain-unverified") return `主空间域名正在自动验证，验证通过后将自动启用当前空间的${target}链接，无需重复配置。`;
  if (access?.inherited && access.reason === "tunnel-offline") return `主空间的远程连接暂时离线，恢复后将自动启用当前空间的${target}链接，无需重复配置。`;
  if (access?.configured && access.reason === "space-offline") return `当前空间尚未运行，启动后即可在线查看${target}，无需重新配置域名。`;
  if (access?.configured && access.reason === "domain-unverified") return `域名已配置，但访问验证尚未通过，暂时无法在线查看${target}。`;
  if (access?.configured && access.reason === "reauth_required") return `远程连接需要恢复授权，当前暂时无法在线查看${target}，无需重新绑定域名。`;
  if (access?.configured && ["tunnel-offline", "degraded", "refreshing", "authorizing"].includes(access.reason)) return `远程连接暂时不可用，恢复后即可在线查看${target}，无需重新绑定域名。`;
  return "";
}
export const inheritedAccessNotice = domainAccessNotice;

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
