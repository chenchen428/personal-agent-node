type WeChatStatus = {
  connected?: boolean;
};

type ManagedPlatformStatus = {
  provider?: string;
  label?: string;
  state?: string;
  statusLabel?: string;
  loggedIn?: boolean;
  capabilities?: string[];
  [key: string]: unknown;
};

export function buildChannelCatalog({ wechat, managedPlatform }: { wechat: WeChatStatus; managedPlatform: ManagedPlatformStatus }) {
  return [
    {
      provider: "web",
      label: "Web 控制台",
      state: "ready",
      statusLabel: "本机可用",
      description: "浏览器中的主渠道，支持对话、页面和本机管理。",
      capabilities: ["conversation", "online_pages", "desktop", "mobile"],
      healthCheck: false,
    },
    {
      provider: "wechat",
      label: "微信",
      state: wechat.connected ? "connected" : "needs_login",
      statusLabel: wechat.connected ? "已连接" : "尚未连接",
      description: wechat.connected ? "消息轮询与双向收发已启用。" : "可选渠道，需要扫码后使用。",
      capabilities: ["conversation", "image", "file"],
      healthCheck: false,
    },
    {
      ...managedPlatform,
      provider: managedPlatform.provider || "managed-platform",
      label: managedPlatform.label || "托管平台",
      description: managedPlatform.loggedIn ? "账号已就绪，可执行受控的只读任务。" : "可选平台，通过 Agent 协作完成扫码登录。",
      healthCheck: true,
    },
  ];
}
