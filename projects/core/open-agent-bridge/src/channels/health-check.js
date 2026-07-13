export const CHANNEL_MANAGEMENT_URL = "/agent/channels";

export async function runChannelHealthCheck({
  fetchImpl = fetch,
  baseUrl = "http://127.0.0.1:8788",
  apiToken = "",
  notify = true,
} = {}) {
  const request = (pathname, options = {}) => requestJson(fetchImpl, baseUrl, apiToken, pathname, options);
  const response = await request("/api/channels");
  const channels = Array.isArray(response.channels) ? response.channels.map(normalizeChannel) : [];
  const unhealthy = channels.filter((channel) => channel.state !== "logged_in");

  if (!unhealthy.length && channels.length) {
    return { ok: true, healthy: true, notified: false, channels };
  }

  const message = buildChannelRecoveryMessage(unhealthy.length ? unhealthy : [{
    provider: "unknown",
    label: "渠道服务",
    state: "missing",
    statusLabel: "未发现已配置渠道",
    error: "",
  }]);
  if (notify) {
    await request("/api/channels/wechat/notify", {
      method: "POST",
      body: JSON.stringify({ message }),
    });
  }
  return { ok: true, healthy: false, notified: notify, channels, unhealthy, message };
}

export function buildChannelRecoveryMessage(channels) {
  const lines = ["【Agent 渠道协作请求】"];
  for (const channel of channels) {
    lines.push(`${channel.label || channel.provider || "未知渠道"}：${channel.statusLabel || stateLabel(channel.state)}`);
    if (channel.error) lines.push(`原因：${String(channel.error).slice(0, 160)}`);
  }
  lines.push(
    "",
    "我不会自动生成二维码。",
    "需要现在登录时，请在微信回复：登录小红书",
    "Agent 会再次说明当前状态；只有你回复“确认开始”后，才会发送二维码图片。",
    "扫码后由 Agent 自动监听登录结果，无需回复“已完成”。",
    "如果手机收到短信验证码，请直接在微信回复验证码，Agent 会把它提交到当前登录窗口并继续监听。",
    "",
    `只读状态页：${CHANNEL_MANAGEMENT_URL}`,
    "验证码仅在当前登录会话中一次性使用，不进入普通 Agent 会话、记忆或日志。",
  );
  return lines.join("\n");
}

function normalizeChannel(channel) {
  return {
    provider: String(channel?.provider || "unknown"),
    label: String(channel?.label || channel?.provider || "未知渠道"),
    state: String(channel?.state || "unknown"),
    statusLabel: String(channel?.statusLabel || ""),
    error: String(channel?.error || ""),
    readOnly: channel?.readOnly === true,
    egress: String(channel?.egress || ""),
  };
}

function stateLabel(state) {
  if (state === "needs_login") return "需要扫码登录";
  if (state === "offline") return "渠道运行时离线";
  if (state === "error") return "登录状态检测失败";
  if (state === "missing") return "渠道未配置";
  return "渠道状态异常";
}

async function requestJson(fetchImpl, baseUrl, apiToken, pathname, options) {
  const response = await fetchImpl(`${String(baseUrl).replace(/\/+$/, "")}${pathname}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
      ...(options.headers || {}),
    },
    signal: options.signal || AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${pathname} returned invalid JSON`);
  }
  if (!response.ok || body.ok === false) {
    throw new Error(`${pathname} failed: ${body.error || `HTTP ${response.status}`}`);
  }
  return body;
}
