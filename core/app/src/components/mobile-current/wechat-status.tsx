"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { useWechatLogin } from "@/components/wechat-login";
import { downloadWechatQrPng } from "@/components/wechat-qr";
import { useRemote } from "./data";
import type { Channel } from "./types";

export function MobileWechatStatus() {
  const channels = useRemote<{ channels: Channel[] }>("/api/channels");
  const wechat = channels.value?.channels?.find((channel) => channel.provider === "wechat");
  const connected = wechat?.state === "connected";
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState("");
  const onConnected = useCallback(async () => { channels.refresh(); }, [channels.refresh]);
  const login = useWechatLogin({ connected, onConnected });

  useEffect(() => { if (connected) setOpen(false); }, [connected]);

  if (channels.loading) return <WechatStatusState label="正在检查微信状态" />;
  if (channels.error) return <WechatStatusState label="暂时无法读取微信状态" action="重新检查" onAction={channels.refresh} />;

  return <section className={`mobile-about-section about-wechat${connected ? " is-connected" : " is-offline"}`}>
    <header><div><MessageCircle aria-hidden="true" /><h2>微信</h2></div><span className="mobile-about-live">{connected ? "已连接" : "已掉线"}</span></header>
    <p>{connected ? "消息连接正常，最近检查：刚刚。" : "微信连接已断开，重新连接后可以继续与 PA 沟通。"}</p>
    {!connected ? <button className="about-wechat-retry" type="button" onClick={() => { setOpen(true); setSaved(""); void login.startLogin(); }}>重新连接</button> : null}
    {!connected && open ? <WechatRecovery login={login} saved={saved} setSaved={setSaved} /> : null}
  </section>;
}

function WechatRecovery({ login, saved, setSaved }: {
  login: ReturnType<typeof useWechatLogin>;
  saved: string;
  setSaved: (value: string) => void;
}) {
  if (login.phase === "generating") return <div className="about-wechat-login"><div className="about-wechat-generating" aria-live="polite"><span className="mobile-load-spinner" /><strong>正在生成登录二维码</strong><p>通常只需要几秒。</p></div></div>;
  if (login.phase === "error" || login.phase === "expired") return <div className="about-wechat-login"><div className="about-wechat-error"><span>!</span><strong>{login.phase === "expired" ? "二维码已过期" : "暂时无法生成二维码"}</strong><p>{login.message}</p><button type="button" onClick={() => void login.startLogin()}>重新生成</button></div></div>;
  if (!login.login?.qrSvg) return null;

  const image = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(login.login.qrSvg)}`;
  return <div className="about-wechat-login">
    <div className="about-wechat-ready">
      <strong>重新连接微信</strong><p>二维码只用于本次登录，请勿转发。</p>
      <div className="about-wechat-qr-box"><img src={image} alt="微信登录二维码" /></div>
      <p className="about-wechat-other-device">也可以使用另一台设备上的微信直接扫描。</p>
      <ol><li>同一部手机：先保存二维码。</li><li>打开微信“扫一扫”，从相册选择二维码。</li><li>在微信中确认，页面会自动恢复连接。</li></ol>
      <div className="about-wechat-actions">
        <button className="primary" type="button" onClick={() => { void downloadWechatQrPng(login.login?.qrSvg || "").then(() => setSaved("二维码已保存。现在从微信扫一扫的相册中选择它。")).catch(() => setSaved("如果没有自动保存，请长按上方二维码保存图片。")); }}>{saved ? "已保存" : "保存二维码"}</button>
        <a href="weixin://scanqrcode">打开微信扫一扫</a>
      </div>
      <small role="status">{saved || login.message}</small>
    </div>
  </div>;
}

function WechatStatusState({ label, action, onAction }: { label: string; action?: string; onAction?: () => void }) {
  return <section className="mobile-about-section about-wechat"><header><div><MessageCircle aria-hidden="true" /><h2>微信</h2></div><span>{label}</span></header>{action ? <button className="about-wechat-retry" type="button" onClick={onAction}>{action}</button> : null}</section>;
}
