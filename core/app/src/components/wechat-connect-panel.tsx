"use client";

import { Button } from "@/components/ui/button";
import { CheckCircle2, QrCode } from "lucide-react";
import { useWechatLogin } from "@/components/wechat-login";

export function WechatConnectPanel({ connected, onConnected, autoStart = false, compact = false }: {
  connected: boolean;
  onConnected: () => Promise<void>;
  autoStart?: boolean;
  compact?: boolean;
}) {
  const { login, message, working, startLogin } = useWechatLogin({ connected, onConnected, autoStart });

  if (connected) return <div className="mt-5 flex items-start gap-3 rounded-lg border border-[color-mix(in_srgb,var(--success)_35%,var(--hairline))] bg-[color-mix(in_srgb,var(--success)_8%,transparent)] p-4 text-sm leading-6"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[var(--success)]" /><div><strong className="block text-[var(--ink)]">微信已连接</strong><span className="text-[var(--muted)]">你可以关闭此页，直接在微信中发送文字、图片或文件。</span></div></div>;

  if (compact && !login?.qrSvg) return <div className="wechat-connect-compact"><button className="pa-button primary" type="button" onClick={() => void startLogin()} disabled={working}>{working ? "正在生成" : "开始扫码"}</button><small role="status">{working ? message : ""}</small></div>;

  return <div className="wechat-connect-panel mt-5 grid gap-4 rounded-lg border border-[var(--hairline)] bg-[var(--surface-soft)] p-4">
    <div className="grid gap-2 text-sm leading-6 text-[var(--body)]">
      <strong className="text-[var(--ink)]">连接方法</strong>
      <ol className="ml-5 list-decimal space-y-1"><li>使用手机微信扫描本页二维码。</li><li>在手机上确认连接。</li><li>保持本页打开，等待状态自动变为“微信已连接”。</li></ol>
    </div>
    {login?.qrSvg ? <div className="grid justify-items-center gap-3 rounded-lg border border-[var(--hairline)] bg-white p-4"><img className="size-[min(280px,72vw)]" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(login.qrSvg)}`} alt="微信连接二维码" /><small className="text-center text-xs text-[var(--muted)]">二维码将在几分钟后失效，请勿转发给其他人。</small></div> : <div className="grid min-h-56 place-items-center rounded-lg border border-dashed border-[var(--hairline)] bg-white p-5 text-center text-sm text-[var(--muted)]"><span>{working ? "正在生成微信二维码…" : message}</span></div>}
    <div className="flex flex-wrap items-center gap-3"><Button type="button" onClick={() => void startLogin()} disabled={working}><QrCode className="size-4" />{working ? "生成中" : login?.qrSvg ? "重新生成二维码" : "生成微信二维码"}</Button><small className="min-w-0 flex-1 text-xs leading-5 text-[var(--muted)]" role="status">{message}</small></div>
  </div>;
}
