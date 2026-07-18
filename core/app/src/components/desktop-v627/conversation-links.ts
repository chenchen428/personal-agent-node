const MANAGED_DOMAIN_SUFFIX = ".personal-agent.cn";
const TASK_PROGRESS_PATH = /^\/app\/(?:chat\/session\/([^/]+)\/live|mobile\/(?:workers|conversations)\/([^/]+))\/?$/;

export function localTaskDetailHref(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" || !url.hostname.endsWith(MANAGED_DOMAIN_SUFFIX)) return null;
    const match = TASK_PROGRESS_PATH.exec(url.pathname);
    if (!match) return null;
    const sessionId = decodeURIComponent(match[1] || match[2]);
    if (!/^[A-Za-z0-9._:-]{3,128}$/.test(sessionId)) return null;
    return `/app/workers?task=${encodeURIComponent(sessionId)}`;
  } catch {
    return null;
  }
}
