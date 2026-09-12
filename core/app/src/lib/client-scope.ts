export const CLIENT_SCOPE_ENDPOINT = "/api/system/client-scope";
export type ClientScope = { schemaVersion: 1; installationId: string; spaceId: string };

export function clientScopeKey(value: unknown, origin: string) {
  const scope = value as Partial<ClientScope> | null;
  if (!scope || scope.schemaVersion !== 1 || typeof scope.installationId !== "string" || !scope.installationId
    || typeof scope.spaceId !== "string" || !scope.spaceId) throw new Error("Missing verified client scope");
  return JSON.stringify([origin, scope.installationId, scope.spaceId]);
}

export function startupSurface(pathname: string) {
  if (pathname === "/app/setup") return { eyebrow: "首次设置", title: "完成 Cove 初始化", setup: true };
  if (pathname === "/app/runtime") return { eyebrow: "本机设置", title: "运行设置", setup: false };
  if (pathname === "/app/settings" || pathname.startsWith("/app/settings/")) return { eyebrow: "本机设置", title: "空间设置", setup: false };
  return { eyebrow: "Cove", title: "连接本机工作区", setup: false };
}
