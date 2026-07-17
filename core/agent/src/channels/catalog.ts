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
      provider: "wechat",
      label: "微信",
      state: wechat.connected ? "connected" : "needs_login",
      statusLabel: wechat.connected ? "已连接" : "尚未连接",
      description: wechat.connected ? "消息轮询与双向收发已启用。" : "必选移动渠道，在客户端生成二维码并使用微信扫码连接。",
      capabilities: ["conversation", "image", "file"],
      healthCheck: false,
    },
    {
      ...managedPlatform,
      provider: managedPlatform.provider || "managed-platform",
      label: managedPlatform.label || "托管平台",
      description: managedPlatform.loggedIn ? "账号已就绪，可执行受控的只读任务。" : "可选平台，可在客户端直接扫码，也可交给主 Agent 托管连接。",
      healthCheck: true,
    },
  ];
}
