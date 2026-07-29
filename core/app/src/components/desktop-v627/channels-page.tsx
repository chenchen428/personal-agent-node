"use client";

import Link from "next/link";
import { Globe2, Mail, MessageCircle, Sparkles } from "lucide-react";
import { useState } from "react";
import type { Channel, Overview } from "./types";
import { useJson } from "./shared";
import { Badge, Button, DetailHeader, KeyValueGrid } from "../desktop-v72/primitives";
import { CollectionDetail } from "../desktop-v72/collection-detail";
import { WechatConnectPanel } from "@/components/wechat-connect-panel";

const iconFor = (provider: string) => provider === "wechat" ? <MessageCircle /> : provider === "xiaohongshu" ? <Sparkles /> : provider.includes("mail") ? <Mail /> : <Globe2 />;

export function ChannelsPage() {
  const { value, loading, refresh } = useJson<{ channels: Channel[] }>("/api/channels");
  const overview = useJson<Overview>("/api/node/v1/client/overview");
  const channels = (value?.channels || []).filter((item) => !["web", "mobile", "public-domain"].includes(item.provider));
  const publicReady = ["available", "ready", "connected"].includes(overview.value?.machine.mobileAccess || "") && Boolean(overview.value?.machine.mobileAddress);
  channels.push({ provider: "public-domain", label: "公网域名访问", state: publicReady ? "connected" : "pending", statusLabel: publicReady ? "已连接" : "尚未启用", description: overview.value?.machine.mobileAddress || "登录 Cloud 后获得专属公网域名，手机可安全访问这台电脑。" });
  const [selectedId, setSelectedId] = useState("");
  const activeId = channels.some((item) => item.provider === selectedId) ? selectedId : channels[0]?.provider || "";
  const selected = channels.find((item) => item.provider === activeId);
  const values = channelValues(selected, overview.value);
  return <CollectionDetail title="渠道" items={channels.map((item) => ({ id: item.provider, title: item.label, summary: item.description || item.statusLabel, time: item.statusLabel, tone: channelTone(item.state), leading: <span className="row-icon">{iconFor(item.provider)}</span> }))} selectedId={activeId} onSelect={setSelectedId} listLabel={loading ? "正在检测" : `已配置 · ${channels.length}`} toolbarContent={<div className="notice">颜色表示当前状态：绿色可用，橙色等待，红色异常。</div>} detail={selected ? <div className="detail-wrap"><DetailHeader title={selected.label} meta={selected.description || selected.statusLabel} trailing={<Badge tone={channelTone(selected.state)}>{selected.statusLabel}</Badge>} /><section className="detail-section"><h2>当前连接</h2><KeyValueGrid items={values} /></section><section className="detail-section"><h2>可用操作</h2><ChannelActions channel={selected} address={overview.value?.machine.mobileAddress} refresh={refresh} /></section></div> : <div className="empty-state"><div><h2>暂时没有渠道</h2></div></div>} loading={loading && !value} />;
}

function channelTone(state = ""): "success" | "warning" | "danger" | "info" {
  if (["connected", "ready", "available", "healthy"].includes(state)) return "success";
  if (["error", "failed", "offline", "disconnected"].includes(state)) return "danger";
  if (["pending", "waiting", "authorizing", "needs_login", "missing", "not_configured"].includes(state)) return "warning";
  return "info";
}

function channelValues(selected: Channel | undefined, overview: Overview | null) {
  if (selected?.provider === "wechat") return [{ label: "连接状态", value: selected.statusLabel }, { label: "用途", value: "唯一主会话" }, { label: "内容保存", value: "本机工作区" }, { label: "授权位置", value: "微信手机端" }];
  if (selected?.provider === "xiaohongshu") return [{ label: "能力入口", value: "浏览器只读操作" }, { label: "账号会话", value: "由用户浏览器持有" }, { label: "登录检测", value: "不读取" }, { label: "历史渠道", value: "仅兼容保留" }];
  if (selected?.provider.includes("mail")) return [{ label: "处理状态", value: selected.statusLabel }, { label: "附件", value: "仅保存在本机" }, { label: "接收方式", value: "PA 邮箱" }, { label: "内容保存", value: "本机工作区" }];
  const address = overview?.machine.mobileAddress;
  return [{ label: "公网地址", value: address ? <a className="v72-inline-link" href={address} target="_blank" rel="noreferrer">{address}</a> : "尚未启用" }, { label: "连接", value: "Personal Agent Cloud" }, { label: "内容", value: "仍保存在本机" }, { label: "状态", value: selected?.statusLabel || "等待连接" }];
}

function ChannelActions({ channel, address, refresh }: { channel: Channel; address?: string; refresh: () => void }) {
  if (channel.provider === "wechat") return <WechatConnectPanel connected={channel.state === "connected"} onConnected={async () => refresh()} compact />;
  if (channel.provider === "xiaohongshu") return <div className="page-actions"><Button onClick={refresh}>重新检测</Button><Link className="button primary" href="/app/connections?connection=xiaohongshu">查看浏览器能力</Link></div>;
  if (channel.provider === "public-domain") return <div className="page-actions"><Button onClick={refresh}>重新检测</Button>{address ? <a className="button primary" href={address} target="_blank" rel="noreferrer">打开公网域名</a> : <Link className="button primary" href="/app/setup">启用公网域名</Link>}</div>;
  return <div className="page-actions"><Button onClick={refresh}>重新检测</Button><Link className="button primary" href="/app/setup">管理连接</Link></div>;
}
