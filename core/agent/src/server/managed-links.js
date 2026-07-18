import {
  buildManagedTaskAccess,
  TASK_ACCESS_OFFLINE,
  TASK_ACCESS_UNAVAILABLE,
} from "../managed-access.js";

export const PAGE_ACCESS_UNAVAILABLE = "暂未配置可访问的域名链接，无法直接访问页面";
export { TASK_ACCESS_OFFLINE, TASK_ACCESS_UNAVAILABLE };

const LOCAL_REFERENCE_BLOCKED = "本机路径已拦截，请先通过 Personal Agent 发布该交付物";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "0.0.0.0"]);
const MARKDOWN_LINK = /\[([^\]\r\n]+)\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/g;
const BARE_HTTP_URL = /https?:\/\/[^\s<>()\[\]{}"'`，。！？、；：]+/gi;
const BARE_SYSTEM_PATH = /(?<![A-Za-z0-9:/])\/(?:app\/chat\/session\/[^\s<>()\[\]{}"'`，。！？、；：]+|app\/mobile(?:\/[^\s<>()\[\]{}"'`，。！？、；：]*)?|publications\/[^\s<>()\[\]{}"'`，。！？、；：]+|public\/[^\s<>()\[\]{}"'`，。！？、；：]+|pages\/[^\s<>()\[\]{}"'`，。！？、；：]+|uploads\/[^\s<>()\[\]{}"'`，。！？、；：]+)/g;
const FILE_URL = /file:\/\/[^\s<>()\[\]{}"'`，。！？、；：]+/gi;
const WINDOWS_PATH = /(^|[^A-Za-z0-9])([A-Za-z]:[\\/][^\r\n<>"'`，。！？；：)\]}]*)/gm;
const UNC_PATH = /(^|[^A-Za-z0-9])(\\\\[^\s\\/]+[\\/][^\r\n<>"'`，。！？；：)\]}]*)/gm;

export function buildManagedPageAccess(internalUrl, externalAccess) {
  const normalizedInternalUrl = normalizeSystemPath(internalUrl);
  const origin = managedOrigin(externalAccess);
  if (!normalizedInternalUrl || !origin) {
    return {
      internalUrl: normalizedInternalUrl,
      url: "",
      linkNotice: PAGE_ACCESS_UNAVAILABLE,
    };
  }
  return {
    internalUrl: normalizedInternalUrl,
    url: new URL(normalizedInternalUrl, `${origin}/`).href,
    linkNotice: "",
  };
}

export function prepareRemoteChannelText(content, { externalAccess } = {}) {
  const access = resolveAccess(externalAccess);
  const origin = managedOrigin(access);
  let blockedLocalReferences = false;
  let unavailableManagedLinks = false;
  const replaceTarget = (target, label = "") => {
    const result = transformTarget(target, origin, access);
    blockedLocalReferences ||= result.blocked;
    unavailableManagedLinks ||= result.unavailable;
    if (result.blocked) return label ? `${label}（${LOCAL_REFERENCE_BLOCKED}）` : LOCAL_REFERENCE_BLOCKED;
    if (result.unavailable) return label ? `${label}（${result.notice}）` : result.notice;
    return result.value;
  };

  let text = String(content || "");
  text = text.replace(MARKDOWN_LINK, (match, label, target) => {
    const result = transformTarget(target, origin, access);
    blockedLocalReferences ||= result.blocked;
    unavailableManagedLinks ||= result.unavailable;
    if (result.blocked) return `${label}（${LOCAL_REFERENCE_BLOCKED}）`;
    if (result.unavailable) return `${label}（${result.notice}）`;
    return `[${label}](${result.value})`;
  });
  text = text.replace(BARE_HTTP_URL, (target) => replaceTarget(target));
  text = text.replace(FILE_URL, (target) => replaceTarget(target));
  text = text.replace(WINDOWS_PATH, (_match, prefix, target) => `${prefix}${replaceTarget(target)}`);
  text = text.replace(UNC_PATH, (_match, prefix, target) => `${prefix}${replaceTarget(target)}`);
  text = text.replace(BARE_SYSTEM_PATH, (target) => replaceTarget(target));

  return {
    content: text.trim(),
    blockedLocalReferences,
    unavailableManagedLinks,
  };
}

function transformTarget(target, origin, access) {
  const value = String(target || "").trim();
  if (!value) return { value, blocked: false, unavailable: false };
  if (/^file:/i.test(value) || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value)) {
    return { value: "", blocked: true, unavailable: false };
  }
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
        return { value, blocked: false, unavailable: false };
      }
      const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
      if (!isSystemPath(path) || looksLikeLocalFilePath(parsed.pathname)) {
        return { value: "", blocked: true, unavailable: false };
      }
      return materializeSystemPath(path, origin, access);
    } catch {
      return { value: "", blocked: true, unavailable: false };
    }
  }
  if (isSystemPath(value)) return materializeSystemPath(value, origin, access);
  return { value, blocked: false, unavailable: false };
}

function materializeSystemPath(value, origin, access) {
  const internalUrl = normalizeSystemPath(value);
  const taskMatch = /^\/app\/chat\/session\/([^/]+)\/live\/?(?:[?#].*)?$/.exec(internalUrl);
  if (taskMatch) {
    let sessionId;
    try { sessionId = decodeURIComponent(taskMatch[1]); }
    catch { return { value: "", blocked: true, unavailable: false }; }
    const taskAccess = buildManagedTaskAccess(sessionId, access);
    return taskAccess.url
      ? { value: taskAccess.url, blocked: false, unavailable: false }
      : { value: "", blocked: false, unavailable: true, notice: taskAccess.linkNotice };
  }
  if (!origin) {
    return {
      value: "",
      blocked: false,
      unavailable: true,
      notice: isPagePath(internalUrl)
        ? PAGE_ACCESS_UNAVAILABLE
        : "暂未配置可访问的域名链接，无法直接访问该内容",
    };
  }
  return {
    value: new URL(internalUrl, `${origin}/`).href,
    blocked: false,
    unavailable: false,
  };
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

function resolveAccess(value) {
  try { return typeof value === "function" ? value() : value; }
  catch { return null; }
}

function normalizeSystemPath(value) {
  const path = String(value || "").trim();
  return path.startsWith("/") ? path : "";
}

function isSystemPath(value) {
  const pathname = String(value || "").split(/[?#]/, 1)[0];
  return /^\/app\/chat\/session\/[^/]+\/live\/?$/.test(pathname)
    || pathname === "/app/mobile"
    || pathname.startsWith("/app/mobile/")
    || pathname.startsWith("/publications/")
    || pathname.startsWith("/public/")
    || pathname.startsWith("/pages/")
    || pathname.startsWith("/uploads/");
}

function isPagePath(value) {
  const pathname = String(value || "").split(/[?#]/, 1)[0];
  return pathname.startsWith("/publications/")
    || pathname.startsWith("/public/")
    || pathname.startsWith("/pages/")
    || pathname.startsWith("/uploads/");
}

function looksLikeLocalFilePath(pathname) {
  let decoded = String(pathname || "");
  try { decoded = decodeURIComponent(decoded); } catch {}
  return /^\/[A-Za-z]:[\\/]/.test(decoded) || /^\/(?:Users|home|private|var|tmp)\//i.test(decoded);
}
