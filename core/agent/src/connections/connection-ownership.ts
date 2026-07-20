import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type ConnectionKind = "wechat-claw" | "wechat-personal" | "dingtalk-bot";
type Binding = { kind: ConnectionKind; resourceDigest: string; spaceId: string; boundAt: string; updatedAt: string };
type OwnershipState = { schemaVersion: 1; bindings: Binding[] };

const LOCK_STALE_MS = 30_000;
const LOCK_RETRIES = 40;
const LOCK_RETRY_MS = 25;

export class InstallationConnectionOwnership {
  private readonly installationDataRoot: string;
  private readonly stateFile: string;
  private readonly lockDir: string;

  constructor({ installationDataRoot }: { installationDataRoot: string }) {
    if (!path.isAbsolute(installationDataRoot || "")) throw new Error("Installation data root must be absolute");
    this.installationDataRoot = path.resolve(installationDataRoot);
    const configDir = path.join(installationDataRoot, "installation", "config");
    this.stateFile = path.join(configDir, "connection-ownership.json");
    this.lockDir = path.join(configDir, ".connection-ownership.lock");
  }

  assertOrClaim(kind: ConnectionKind, resourceIds: unknown[], spaceId: string) {
    return this.update(kind, resourceIds, spaceId, false);
  }

  replace(kind: ConnectionKind, resourceIds: unknown[], spaceId: string) {
    return this.update(kind, resourceIds, spaceId, true);
  }

  release(kind: ConnectionKind, spaceId: string) {
    const owner = normalizeSpaceId(spaceId);
    if (!owner) return { released: 0, standalone: true };
    return this.withLock(() => {
      const state = this.read();
      const retained = state.bindings.filter((binding) => binding.kind !== kind || binding.spaceId !== owner);
      const released = state.bindings.length - retained.length;
      if (released) this.write({ schemaVersion: 1, bindings: retained });
      return { released, standalone: false };
    });
  }

  private update(kind: ConnectionKind, resourceIds: unknown[], spaceId: string, replace: boolean) {
    const owner = normalizeSpaceId(spaceId);
    if (!owner) return { owned: true, standalone: true };
    const digests = normalizedResourceDigests(kind, resourceIds);
    if (!digests.length) throw ownershipError(kind === "dingtalk-bot" ? "CONNECTION_RESOURCE_ID_REQUIRED" : "WECHAT_ACCOUNT_ID_REQUIRED", kind === "dingtalk-bot" ? "连接没有返回可绑定的账号标识" : "微信连接没有返回可绑定的账号标识");
    return this.withLock(() => {
      const state = this.read();
      const conflict = state.bindings.find((binding) => digests.includes(binding.resourceDigest) && binding.spaceId !== owner);
      if (conflict) throw ownershipError(kind === "dingtalk-bot" ? "CONNECTION_SPACE_CONFLICT" : "WECHAT_SPACE_CONFLICT", kind === "dingtalk-bot" ? "该连接已被另一个隔离空间占用，不能在当前 Space 共同引用" : "该微信连接已被另一个隔离空间占用，不能在当前 Space 共同引用");
      const legacyOwner = kind === "wechat-claw" ? this.resolveLegacyWechatOwner(digests) : "";
      if (legacyOwner && legacyOwner !== owner) {
        throw ownershipError("WECHAT_SPACE_CONFLICT", "该微信连接已被另一个隔离空间占用，不能在当前 Space 共同引用");
      }
      const now = new Date().toISOString();
      const retained = replace
        ? state.bindings.filter((binding) => binding.kind !== kind || binding.spaceId !== owner)
        : [...state.bindings];
      for (const resourceDigest of digests) {
        const existing = retained.find((binding) => binding.kind === kind && binding.resourceDigest === resourceDigest && binding.spaceId === owner);
        if (existing) existing.updatedAt = now;
        else retained.push({ kind, resourceDigest, spaceId: owner, boundAt: now, updatedAt: now });
      }
      this.write({ schemaVersion: 1, bindings: retained });
      return { owned: true, standalone: false };
    });
  }

  private resolveLegacyWechatOwner(resourceDigests: string[]) {
    const spacesRoot = path.join(this.installationDataRoot, "spaces");
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(spacesRoot, { withFileTypes: true }); }
    catch { return ""; }
    const candidates = entries.filter((entry) => entry.isDirectory() && /^sp_[A-Za-z0-9_-]{8,128}$/.test(entry.name))
      .flatMap((entry) => {
        const root = path.join(spacesRoot, entry.name);
        const account = readJson(path.join(root, "channels", "wechat", "account.json"));
        if (!account || !normalizedResourceDigests("wechat-claw", [account.accountId, account.userId]).some((digest) => resourceDigests.includes(digest))) return [];
        const identity = readJson(path.join(root, "space.json"));
        if (normalizeSpaceId(identity?.spaceId) !== entry.name) return [];
        return [{
          spaceId: entry.name,
          personal: identity?.kind === "personal" ? 0 : 1,
          createdAt: String(identity?.createdAt || "9999"),
        }];
      })
      .sort((left, right) => left.personal - right.personal || left.createdAt.localeCompare(right.createdAt) || left.spaceId.localeCompare(right.spaceId));
    return candidates[0]?.spaceId || "";
  }

  private read(): OwnershipState {
    try {
      const value = JSON.parse(fs.readFileSync(this.stateFile, "utf8"));
      if (value?.schemaVersion !== 1 || !Array.isArray(value.bindings)) throw new Error("invalid");
      return { schemaVersion: 1, bindings: value.bindings.filter(validBinding) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return { schemaVersion: 1, bindings: [] };
      throw ownershipError("CONNECTION_OWNERSHIP_INVALID", "安装级连接所有权记录无效，已停止加载账号连接");
    }
  }

  private write(state: OwnershipState) {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true, mode: 0o700 });
    const temporary = `${this.stateFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    try { fs.renameSync(temporary, this.stateFile); }
    finally { try { fs.rmSync(temporary, { force: true }); } catch {} }
    try { fs.chmodSync(this.stateFile, 0o600); } catch {}
  }

  private withLock<T>(operation: () => T): T {
    fs.mkdirSync(path.dirname(this.lockDir), { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < LOCK_RETRIES; attempt += 1) {
      try {
        fs.mkdirSync(this.lockDir);
        try { return operation(); }
        finally { fs.rmdirSync(this.lockDir); }
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
        if (lockIsStale(this.lockDir)) {
          try { fs.rmdirSync(this.lockDir); } catch {}
          continue;
        }
        blockFor(LOCK_RETRY_MS);
      }
    }
    throw ownershipError("CONNECTION_OWNERSHIP_BUSY", "连接所有权正在由另一个 Space 更新，请稍后重试");
  }
}

function normalizedResourceDigests(kind: ConnectionKind, values: unknown[]) {
  const namespace = kind === "dingtalk-bot" ? "personal-agent-dingtalk-client-v1" : "personal-agent-wechat-account-v1";
  return [...new Set(values.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
    .map((value) => crypto.createHash("sha256").update(`${namespace}\n${value}`).digest("hex")))];
}

function normalizeSpaceId(value: unknown) {
  const text = String(value || "").trim();
  return /^sp_[A-Za-z0-9_-]{8,128}$/.test(text) ? text : "";
}

function validBinding(value: unknown): value is Binding {
  if (!value || typeof value !== "object") return false;
  const binding = value as Binding;
  return ["wechat-claw", "wechat-personal", "dingtalk-bot"].includes(binding.kind)
    && /^[a-f0-9]{64}$/.test(binding.resourceDigest)
    && Boolean(normalizeSpaceId(binding.spaceId))
    && typeof binding.boundAt === "string"
    && typeof binding.updatedAt === "string";
}

function lockIsStale(lockDir: string) {
  try { return Date.now() - fs.statSync(lockDir).mtimeMs > LOCK_STALE_MS; }
  catch { return false; }
}

function blockFor(milliseconds: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function ownershipError(code: string, message: string) {
  return Object.assign(new Error(message), { code, statusCode: 409 });
}

function readJson(filePath: string): any {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch { return null; }
}
