import { skillError } from "./user-skill-tree.js";

/** The server supplies the authenticated current-Space service, never request input. */
export async function handleUserSkillRequest({ request, pathname, service, authorized, readJsonBody }) {
  if (!authorized) throw skillError("技能管理仅支持当前空间的本机桌面端", 403, "USER_SKILL_FORBIDDEN");
  if (request.method === "POST" && pathname === "/api/skills/user/import") {
    return { statusCode: 201, result: service.import(await readJsonBody(request, 13 * 1024 * 1024)) };
  }
  if (request.method === "POST" && pathname === "/api/skills/user/restore") {
    return { statusCode: 200, result: service.restore(await readJsonBody(request, 2048)) };
  }
  const target = /^\/api\/skills\/user\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(pathname);
  if (request.method === "DELETE" && target) {
    return { statusCode: 200, result: service.remove(target[1], await readJsonBody(request, 2048)) };
  }
  throw skillError("不支持的技能管理操作", 405);
}
