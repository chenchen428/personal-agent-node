import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readCodexRuntimeSettings } from "../agent/codex-runtime-settings.ts";
import { ENGINES, normalizeProfile, runtimeError, sameCredentialOrigin, validateEngine } from "./validation.ts";
import { runtimeSettingsScope } from "./scope.ts";
import type { ProfileDraft, RuntimeEngine, RuntimeEnvironmentView, RuntimeExecution, RuntimeProfile } from "./types.ts";

export type StoreOptions = {
  workspaceRoot: string;
  spaceId: string;
  legacyFile?: string;
  legacyFallback?: { model?: string; reasoningEffort?: string };
};
type StoredProfile = RuntimeProfile & { credentialId?: string };
type StoredState = Omit<RuntimeEnvironmentView, "profiles" | "readOnly" | "inherited" | "sourceSpace"> & { profiles: Record<RuntimeEngine, StoredProfile> };
export type RuntimeSaveInput = { revision: number; engine: RuntimeEngine; profiles?: Partial<Record<RuntimeEngine, ProfileDraft>> };

function atomicJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}
export function createRuntimeEnvironmentStore(options: StoreOptions) {
  if (!options.spaceId || typeof options.spaceId !== "string") throw runtimeError("运行环境缺少 Space 标识。");
  const scope = runtimeSettingsScope(options.workspaceRoot, options.spaceId);
  const root = scope.root;
  const ownerSpaceId = scope.sourceSpace.id;
  const file = path.join(root, "config", "runtime-environments.json");
  const secretPath = (engine: RuntimeEngine, id: string) => {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw runtimeError("凭据索引无效。", "RUNTIME_CONFIG_CORRUPT", 500);
    return path.join(root, "secrets", "runtime-environments", engine, `${id}.json`);
  };
  function defaults(): StoredState {
    const legacy = readCodexRuntimeSettings(scope.inherited ? path.join(root, "config", "codex-runtime-settings.json") : options.legacyFile || path.join(root, "config", "codex-runtime-settings.json"), scope.inherited ? {} : options.legacyFallback);
    const blank: RuntimeProfile = { mode: "account", model: "", reasoningEffort: "", baseUrl: "", authType: "api-key", credentialConfigured: false };
    return { schemaVersion: 1, spaceId: ownerSpaceId, revision: 0, engine: "codex", profiles: {
      codex: { ...blank, ...legacy }, "claude-code": { ...blank },
    } };
  }
  function load(): StoredState {
    let stored: StoredState;
    try { stored = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (error) {
      if (error?.code === "ENOENT") return defaults();
      throw runtimeError("运行环境配置无法读取，请恢复配置备份。", "RUNTIME_CONFIG_CORRUPT", 500);
    }
    if (stored.spaceId !== ownerSpaceId) throw runtimeError("运行环境不属于授权的主空间。", "RUNTIME_SPACE_MISMATCH", 403);
    if (stored.schemaVersion !== 1 || !Number.isSafeInteger(stored.revision) || stored.revision < 1) {
      throw runtimeError("运行环境配置版本无效。", "RUNTIME_CONFIG_CORRUPT", 500);
    }
    validateEngine(stored.engine);
    for (const engine of ENGINES) {
      const source = stored.profiles?.[engine];
      if (!source) throw runtimeError("运行环境配置不完整。", "RUNTIME_CONFIG_CORRUPT", 500);
      const profile = normalizeProfile(source, defaults().profiles[engine], engine);
      stored.profiles[engine] = { ...profile, credentialId: source.credentialId, credentialConfigured: Boolean(source.credentialId) };
    }
    return stored;
  }
  function publicView(stored: StoredState): RuntimeEnvironmentView {
    const safe = (profile: StoredProfile): RuntimeProfile => ({
      mode: profile.mode, model: profile.model, reasoningEffort: profile.reasoningEffort,
      baseUrl: profile.baseUrl, authType: profile.authType, credentialConfigured: Boolean(profile.credentialId),
    });
    return { schemaVersion: 1, spaceId: options.spaceId, revision: stored.revision, engine: stored.engine,
      readOnly: scope.inherited, inherited: scope.inherited, sourceSpace: scope.sourceSpace,
      profiles: { codex: safe(stored.profiles.codex), "claude-code": safe(stored.profiles["claude-code"]) } };
  }
  function credential(stored: StoredState, engine: RuntimeEngine) {
    const id = stored.profiles[engine].credentialId;
    if (!id) return "";
    try {
      const value = JSON.parse(fs.readFileSync(secretPath(engine, id), "utf8"));
      if (value.spaceId !== ownerSpaceId || value.engine !== engine || typeof value.credential !== "string") throw new Error();
      return value.credential;
    } catch { throw runtimeError("当前运行环境的凭据不可用，请重新填写。", "RUNTIME_CREDENTIAL_UNAVAILABLE", 409); }
  }
  function readExecution(): RuntimeExecution {
    const stored = load();
    return { engine: stored.engine, revision: stored.revision, profile: publicView(stored).profiles[stored.engine],
      credential: stored.profiles[stored.engine].mode === "custom" ? credential(stored, stored.engine) : "", sourceSpaceId: ownerSpaceId };
  }
  function resolveDraft(engineInput: RuntimeEngine, draft: ProfileDraft = {}): RuntimeExecution {
    assertWritable();
    const engine = validateEngine(engineInput);
    const stored = load();
    const previous = stored.profiles[engine];
    const profile = normalizeProfile(draft, previous, engine);
    const supplied = draft.credential?.trim() || "";
    // Never send a saved secret to a different origin selected in an unsaved form.
    const resolved = supplied || (draft.clearCredential || !sameCredentialOrigin(previous, profile) ? "" : credential(stored, engine));
    return { engine, revision: stored.revision, profile: { ...profile, credentialConfigured: Boolean(resolved) }, credential: resolved };
  }
  function save(input: RuntimeSaveInput) {
    assertWritable();
    validateEngine(input?.engine);
    if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw runtimeError("保存时必须提供当前配置版本。");
    if (input.profiles !== undefined && (!input.profiles || typeof input.profiles !== "object" || Array.isArray(input.profiles))) throw runtimeError("运行配置格式无效。");
    for (const engine of Object.keys(input.profiles || {})) validateEngine(engine);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const lock = `${file}.lock`;
    let fd: number;
    try { fd = fs.openSync(lock, "wx", 0o600); }
    catch { throw runtimeError("运行环境正在保存，请刷新后重试。", "RUNTIME_REVISION_CONFLICT", 409); }
    const created: string[] = [];
    const retired: string[] = [];
    let committed = false;
    try {
      const stored = load();
      if (stored.revision !== input.revision) throw runtimeError("运行环境已被修改，请刷新后重试。", "RUNTIME_REVISION_CONFLICT", 409);
      for (const engine of ENGINES) {
        const draft = input.profiles?.[engine];
        if (draft === undefined) continue;
        const previous = stored.profiles[engine];
        const profile: StoredProfile = normalizeProfile(draft, previous, engine);
        const supplied = draft.credential?.trim() || "";
        profile.credentialId = previous.credentialId;
        if (previous.credentialId && !sameCredentialOrigin(previous, profile) && !supplied && !draft.clearCredential) {
          throw runtimeError("更换服务地址时，请重新填写或清除授权凭据。");
        }
        if (supplied) {
          profile.credentialId = randomUUID();
          const target = secretPath(engine, profile.credentialId);
          atomicJson(target, { schemaVersion: 1, spaceId: ownerSpaceId, engine, credential: supplied });
          created.push(target);
        } else if (draft.clearCredential) { delete profile.credentialId; }
        if (previous.credentialId && previous.credentialId !== profile.credentialId) retired.push(secretPath(engine, previous.credentialId));
        profile.credentialConfigured = Boolean(profile.credentialId);
        stored.profiles[engine] = profile;
      }
      stored.engine = input.engine;
      stored.revision++;
      atomicJson(file, stored);
      committed = true;
      return publicView(stored);
    } finally {
      fs.closeSync(fd);
      fs.rmSync(lock, { force: true });
      for (const target of committed ? retired : created) { try { fs.rmSync(target, { force: true }); } catch { /* immutable orphan secrets are never referenced */ } }
    }
  }
  function assertWritable() {
    if (scope.inherited) throw runtimeError("运行设置继承自主空间，请前往主空间修改或测试。", "RUNTIME_SETTINGS_READ_ONLY", 403);
  }
  return { read: () => publicView(load()), view: () => publicView(load()), readExecution, resolveDraft, save, assertWritable };
}
