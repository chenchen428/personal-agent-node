import { operationError } from "./operations.ts";

const FAILURES = {
  timeout: ["Git 操作超时。", "确认 GitHub 网络可用后重新运行 personal-agent development ensure --json。", true],
  network: ["GitHub 网络连接中断或无法解析。", "检查当前网络和已配置代理；网络恢复后重新运行 personal-agent development ensure --json。", true],
  authentication: ["GitHub 身份或仓库访问权限不足。", "运行 gh auth status --hostname github.com，恢复有私有仓库写权限的身份后再执行 development ensure。", false],
  certificate: ["Git HTTPS 证书校验失败。", "修复系统或代理证书信任后重试；不要关闭 SSL 校验。", false],
  long_path: ["Git 检出路径超过系统限制。", "使用已启用 Git 长路径支持的版本，或用 development ensure --checkout-source 指向较短路径的完整研发仓库。", false],
  disk: ["研发目录所在磁盘空间不足。", "释放研发目录所在磁盘空间后重试，不删除用户数据或已有研发仓库。", false],
  filesystem: ["Git 无法写入研发目录。", "确认当前用户对研发目录有写权限并关闭占用文件的程序，不改动无关目录权限。", false],
  unknown: ["Git 操作未成功，未识别为可自动恢复的失败。", "检查 personal-agent development status --json；可通过 development ensure --checkout-source 复用已验证的完整私有根仓库。", false],
};

export function classifyDevelopmentFailure(result = {}) {
  // Inspect only in memory. Never return stderr, command arguments, URLs or tokens.
  const message = `${result.error?.code || ""} ${result.error?.message || ""} ${result.stderr || ""}`;
  if (/ETIMEDOUT|timed?\s*out|timeout/i.test(message)) return "timeout";
  if (/certificate|SSL peer|schannel.*trust/i.test(message)) return "certificate";
  if (/authentication failed|could not read (?:Username|Password)|permission denied \(publickey\)|repository not found|HTTP.*\b(?:401|403)\b/i.test(message)) return "authentication";
  if (/filename too long|file name too long|path too long|ENAMETOOLONG/i.test(message)) return "long_path";
  if (/no space left|disk full|ENOSPC/i.test(message)) return "disk";
  if (/access is denied|permission denied|EACCES|EPERM/i.test(message)) return "filesystem";
  if (/could not resolve|failed to connect|connection (?:reset|closed|refused|aborted)|network.*unreachable|RPC failed|early EOF|HTTP\/2.*(?:error|closed)|TLS connection.*terminated|remote end hung up/i.test(message)) return "network";
  return "unknown";
}

export function developmentCommandError(code, result, attempts = 1) {
  const category = classifyDevelopmentFailure(result);
  const [message, nextAction, recoverable] = FAILURES[category];
  const error = operationError(code, message, category === "authentication" ? 5 : 7);
  error.diagnostic = { category, attempts, automaticRecoveryExhausted: attempts > 1 };
  error.retryable = recoverable;
  error.nextActions = [nextAction];
  return error;
}

export function developmentCommandOptions({ transfer = false, retry = false } = {}) {
  const configuredCount = Number(process.env.GIT_CONFIG_COUNT || 0);
  const count = Number.isInteger(configuredCount) && configuredCount >= 0 && configuredCount <= 100 ? configuredCount : 0;
  return { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    timeout: transfer ? 600_000 : 120_000,
    // Command-scoped Git settings propagate to gh's Git children and submodules.
    // No global user config or certificate verification is changed.
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_COUNT: String(count + (retry ? 2 : 1)),
      [`GIT_CONFIG_KEY_${count}`]: "core.longpaths", [`GIT_CONFIG_VALUE_${count}`]: "true",
      ...(retry ? { [`GIT_CONFIG_KEY_${count + 1}`]: "http.version", [`GIT_CONFIG_VALUE_${count + 1}`]: "HTTP/1.1" } : {}),
    },
  };
}
