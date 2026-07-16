"use client";

import Link from "next/link";
import { WechatConnectPanel } from "@/components/wechat-connect-panel";
import type { Channel, Overview } from "./types";
import { Heading, SectionHeading, useJson } from "./shared";

export function ChannelsPage() {
  const { value, loading, refresh } = useJson<{ channels: Channel[] }>("/api/channels"); const overview = useJson<Overview>("/api/node/v1/client/overview"); const channels = value?.channels || []; const wechat = channels.find((item) => item.provider === "wechat"); const mail = channels.find((item) => item.provider.includes("mail"));
  return <main><Heading eyebrow="渠道连接" title="渠道连接" copy="连接微信、PA 邮箱以及手机网页与发布页入口。" /><div className="pa-grid"><article className="pa-card"><h2>微信</h2><p>{wechat?.description || "绑定后，可以通过微信与 PA 直接沟通。"}</p><strong className="metric" style={{ fontSize: 18 }}>{loading ? "正在检测" : wechat?.statusLabel || "等待绑定"}</strong><WechatConnectPanel connected={wechat?.state === "connected"} onConnected={async () => { refresh(); }} /></article><article className="pa-card"><h2>PA 邮箱</h2><p>{mail?.description || "邮件正文与附件进入本机工作区。"}</p><strong className="metric" style={{ fontSize: 14, overflowWrap: "anywhere" }}>{mail?.statusLabel || "在初始化中查看地址"}</strong></article><article className="pa-card"><h2>手机网页与发布页</h2><p>托管域名授权在默认浏览器完成，自定义域名使用 TXT 验证。</p><strong className="metric" style={{ fontSize: 14, overflowWrap: "anywhere" }}>{overview.value?.machine.mobileAddress || "等待连接"}</strong><Link className="pa-button" style={{ marginTop: 12 }} href="/app/setup">在默认浏览器管理</Link></article></div><SectionHeading title="自定义域名" note="默认浏览器完成" /><div className="pa-card"><p>1. 输入域名　2. 添加 <code>_personal-agent</code> TXT 记录　3. 云服务查询并验证　4. 返回桌面端重新检测。</p></div></main>;
}
