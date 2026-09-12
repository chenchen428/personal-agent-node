import { OpenCliError } from "./runner.js";

const DEFINITIONS = {
  xiaohongshu: { label: "小红书", loginUrl: "https://www.xiaohongshu.com/", reads: ["search", "note_detail"] },
  twitter: { label: "Twitter / X", loginUrl: "https://x.com/i/flow/login", reads: ["search", "thread_read"] },
};

export class SocialBrowserProvider {
  constructor({ runner, platform, now = () => Date.now(), wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
    if (!runner) throw new TypeError("runner is required");
    this.runner = runner; this.platform = platform; this.now = now; this.wait = wait;
    this.definition = DEFINITIONS[platform]; this.lastStatus = null; this.statusPromise = null;
    this.lastReadAt = 0; this.readQueue = Promise.resolve(); this.observationRevision = 0;
  }

  catalogStatus() { return this.lastStatus || this.payload("degraded", "连接状态待检测"); }

  async environment() {
    await this.runner.probe();
    const bridge = await this.runner.browserBridgeStatus();
    if (bridge.needsSetup) throw new OpenCliError("OPENCLI_BROWSER_UNAVAILABLE", "浏览器连接待修复", 503);
    return bridge;
  }

  status() {
    if (!this.statusPromise) {
      const revision = this.observationRevision;
      this.statusPromise = this.checkStatus().then((status) => {
        if (revision === this.observationRevision) this.lastStatus = status;
        return this.catalogStatus();
      }).finally(() => { this.statusPromise = null; });
    }
    return this.statusPromise;
  }

  async checkStatus() {
    let browserReady = false;
    try {
      browserReady = (await this.environment()).ready === true;
      return this.fromObservation(await this.runner.platformOperation(this.platform, "status"));
    } catch (error) { return this.fromError(error, browserReady); }
  }

  fromObservation(observation) {
    const loginState = ["logged_in", "logged_out", "unknown"].includes(observation?.loginState) ? observation.loginState : "unknown";
    const details = { browserReady: true, loginState, searchReady: loginState === "logged_in" && observation?.searchReady === true, readReady: loginState === "logged_in" && observation?.readReady === true };
    if (loginState === "logged_out") return this.payload("needs_login", "请登录平台账号", details);
    if (loginState === "logged_in" && details.searchReady && details.readReady) return this.payload("connected", "已连接", details);
    return this.payload("degraded", loginState === "logged_in" ? "读取能力待确认" : "登录状态待确认", details);
  }

  fromError(error, browserReady = this.lastStatus?.details?.browserReady === true) {
    if (["CONNECTION_LOGIN_REQUIRED", "OPENCLI_AUTH_REQUIRED"].includes(error?.code)) return this.payload("needs_login", "请登录平台账号", { browserReady: true, loginState: "logged_out" }, error);
    if (["OPENCLI_BROWSER_UNAVAILABLE", "OPENCLI_CONFIG_INVALID"].includes(error?.code)) return this.payload("needs_setup", "浏览器连接待修复", undefined, error);
    if (["OPENCLI_NOT_INSTALLED", "OPENCLI_VERSION_UNSUPPORTED", "OPENCLI_INVALID_VERSION"].includes(error?.code)) return this.payload("error", "浏览器运行环境不可用", undefined, error);
    return this.payload("degraded", error?.code === "OPENCLI_SECURITY_BLOCK" ? "请完成人工安全验证" : "连接状态暂时无法确认", { browserReady, loginState: "unknown" }, error);
  }

  payload(state, statusLabel, details = {}, error) {
    const setup = state === "needs_setup" ? { runtimeBundled: true, browserBridge: "OpenCLI Browser Bridge", browserBridgeInstallUrl: "https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk", userConfirmationRequired: true, customExtensionRequired: false } : undefined;
    const observed = { browserReady: false, loginState: "unknown", searchReady: false, readReady: false, ...details, checkedAt: new Date(this.now()).toISOString(), loginUrl: this.definition.loginUrl };
    return {
      ok: true, provider: this.platform, backend: "opencli", availableBackends: ["opencli"], label: this.definition.label,
      state, statusLabel, details: observed, setup,
      error: error ? String(error.code || "OPENCLI_EXECUTION_FAILED").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) : undefined,
      runtime: [{ label: "浏览器环境", value: observed.browserReady ? "可用" : "待检测" }, { label: "平台登录", value: observed.loginState === "logged_in" ? "已登录" : observed.loginState === "logged_out" ? "未登录" : "待确认" }, { label: "搜索与读取", value: observed.searchReady && observed.readReady ? "可用" : "待确认" }],
      loginUrl: this.definition.loginUrl, browserOwnedSession: true, loginStateInspected: true, egress: "direct-required", readOnly: true,
      capabilities: ["browser_open", "platform_login_check", ...this.definition.reads], primaryAction: `打开${this.definition.label}登录页`,
    };
  }

  async open() {
    await this.environment();
    const result = await this.runner.platformOperation(this.platform, "open");
    return { ok: true, provider: this.platform, backend: "opencli", ...result, interaction: "browser", connectionCreated: false };
  }

  async readRows(operation, input) {
    ++this.observationRevision;
    let browserReady = false;
    try {
      browserReady = (await this.environment()).ready === true;
      const result = await this.runner.platformOperation(this.platform, operation, input);
      this.lastStatus = this.fromObservation(result.observation);
      if (!Array.isArray(result.rows)) throw new OpenCliError("OPENCLI_INVALID_OUTPUT", "平台读取响应格式无效。", 502);
      return result.rows;
    } catch (error) {
      this.lastStatus = this.fromError(error, browserReady);
      if (error?.code === "CONNECTION_LOGIN_REQUIRED") error.loginUrl = this.definition.loginUrl;
      throw error;
    }
  }

  withReadSpacing(action) {
    const operation = this.readQueue.then(async () => {
      const waitMs = Math.max(0, 2500 - (this.now() - this.lastReadAt));
      if (waitMs) await this.wait(waitMs);
      try { return await action(); } finally { this.lastReadAt = this.now(); }
    });
    this.readQueue = operation.catch(() => {});
    return operation;
  }
}
