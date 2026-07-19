import fs from "node:fs";
import path from "node:path";

export type AuthorizationMode = "bypass" | "confirm";

export function readAuthorizationMode(filePath: string): AuthorizationMode {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return value?.mode === "confirm" ? "confirm" : "bypass";
  } catch {
    return "bypass";
  }
}

export function writeAuthorizationMode(filePath: string, mode: AuthorizationMode) {
  if (!['bypass', 'confirm'].includes(mode)) throw new Error("invalid authorization mode");
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ schemaVersion: 1, mode, updatedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
  return authorizationSettings(mode);
}

export function authorizationSettings(mode: AuthorizationMode) {
  const bypass = mode !== "confirm";
  return {
    mode: bypass ? "bypass" as const : "confirm" as const,
    label: bypass ? "无需授权" : "操作前确认",
    approvalPolicy: bypass ? "never" : "on-request",
    sandbox: bypass ? "danger-full-access" : "workspace-write",
    cliFlag: bypass ? "--dangerously-bypass-approvals-and-sandbox" : "",
  };
}

export function withAuthorizationCliFlag(args: string[] | undefined, mode: AuthorizationMode) {
  const source = Array.isArray(args) && args.length ? [...args] : ["app-server"];
  const withoutBypass = source.filter((value) => value !== "--dangerously-bypass-approvals-and-sandbox" && value !== "--yolo");
  if (mode === "confirm") return withoutBypass;
  const subcommand = withoutBypass.lastIndexOf("app-server");
  withoutBypass.splice(subcommand >= 0 ? subcommand : withoutBypass.length, 0, "--dangerously-bypass-approvals-and-sandbox");
  return withoutBypass;
}
