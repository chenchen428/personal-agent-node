import fs from "node:fs";
import path from "node:path";

export type CodexRuntimeSettings = {
  model: string;
  reasoningEffort: string;
};

export function readCodexRuntimeSettings(
  filePath: string,
  fallback: Partial<CodexRuntimeSettings> = {},
): CodexRuntimeSettings {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return codexRuntimeSettings(value?.model, value?.reasoningEffort);
  } catch {
    return codexRuntimeSettings(fallback.model, fallback.reasoningEffort);
  }
}

export function writeCodexRuntimeSettings(filePath: string, input: Partial<CodexRuntimeSettings>) {
  const settings = codexRuntimeSettings(input?.model, input?.reasoningEffort, { strict: true });
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({
    schemaVersion: 1,
    ...settings,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
  return settings;
}

export function codexRuntimeSettings(
  model: unknown,
  reasoningEffort: unknown,
  { strict = false } = {},
): CodexRuntimeSettings {
  return {
    model: normalizeIdentifier(model, "model", 200, strict),
    reasoningEffort: normalizeIdentifier(reasoningEffort, "reasoning effort", 40, strict),
  };
}

function normalizeIdentifier(value: unknown, field: string, maximumLength: number, strict: boolean) {
  const normalized = typeof value === "string" ? value.trim() : "";
  const valid = !normalized || (
    normalized.length <= maximumLength
    && /^[a-zA-Z0-9][a-zA-Z0-9._:/+-]*$/.test(normalized)
  );
  if (valid) return normalized;
  if (strict) throw Object.assign(new Error(`invalid Codex ${field}`), {
    code: "INVALID_CODEX_RUNTIME_SETTINGS",
    statusCode: 400,
  });
  return "";
}
