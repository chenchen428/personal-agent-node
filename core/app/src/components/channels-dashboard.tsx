"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { WechatConnectPanel } from "@/components/wechat-connect-panel";
import { RefreshCw } from "lucide-react";

type Channel = {
  provider: string;
  label: string;
  state: string;
  statusLabel: string;
  description?: string;
  capabilities?: string[] | Record<string, string[]>;
  readOnly?: boolean;
};

const capabilityLabels: Record<string, string> = {
  conversation: "对话", online_pages: "Online Pages", desktop: "Web", mobile: "Mobile",
  image: "图片", file: "文件", qr_login: "扫码登录", verification_code_runtime_gated: "验证码保护",
  logout: "退出登录", search: "搜索", note_detail: "笔记详情",
};

function toneFor(state: string): "ready" | "warning" | "error" {
  if (["ready", "connected", "logged_in"].includes(state)) return "ready";
  if (["offline", "error", "blocked"].includes(state)) return "error";
  return "warning";
}

function capabilitiesOf(channel: Channel) {
  if (Array.isArray(channel.capabilities)) return channel.capabilities;
  return Object.values(channel.capabilities || {}).flat();
}

export function ChannelsDashboard() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/channels", { cache: "no-store" });
      const payload = await response.json() as { ok?: boolean; channels?: Channel[]; error?: string };
      if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`);
      setChannels(payload.channels || []);
    } catch {
      setError("渠道服务暂时不可用，请确认本机 Agent 正在运行。");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <section className="channel-workspace" aria-live="polite">
      <div className="workspace-toolbar">
        <div><span className="toolbar-kicker">CHANNEL REGISTRY</span><strong>{loading ? "正在检测" : `${channels.length} 个渠道`}</strong></div>
        <Button variant="outline" type="button" onClick={() => void refresh()} disabled={loading}><RefreshCw className="size-3.5" />刷新状态</Button>
      </div>
      {error ? <div className="surface-notice notice-error"><span className="semantic-dot" />{error}</div> : null}
      <div className="channel-grid">
        {channels.map((channel, index) => {
          const tone = toneFor(channel.state);
          return (
            <Card className={`channel-card tone-${tone}`} id={channel.provider} key={channel.provider}>
              <CardHeader><div className="channel-card-meta"><span className="channel-index">0{index + 1}</span><Badge variant={tone}><i className="semantic-dot" />{channel.statusLabel}</Badge></div></CardHeader>
              <CardContent>
                <div className="channel-symbol" aria-hidden="true">{channel.label.slice(0, 1)}</div>
                <CardTitle>{channel.label}</CardTitle>
                <CardDescription>{channel.description || "该渠道已注册到本机 Agent。"}</CardDescription>
                <div className="capability-list">{capabilitiesOf(channel).map((capability) => <Badge key={capability}>{capabilityLabels[capability] || capability.replaceAll("_", " ")}</Badge>)}</div>
                {channel.provider === "wechat" ? <WechatConnectPanel connected={channel.state === "connected"} onConnected={refresh} /> : null}
              </CardContent>
              <CardFooter><code>{channel.provider}</code><span>{channel.readOnly ? "只读" : "双向"}</span></CardFooter>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
