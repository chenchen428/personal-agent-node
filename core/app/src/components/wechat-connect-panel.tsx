"use client";

import { Button } from "@/components/ui/button";
import { CheckCircle2, LoaderCircle, QrCode, X } from "lucide-react";
import { useEffect } from "react";
import { useWechatLogin } from "@/components/wechat-login";
import { formatConnectionCountdown } from "@/components/desktop-v627/use-connection-status-sync";
import { useConnectionCountdown } from "@/components/use-connection-countdown";
import { ConnectionOperationSop, type ConnectionOperationStep } from "@/components/desktop-v627/connection-operation-sop";

export function WechatConnectPanel({ connected, onConnected, autoStart = false, reconnectOnMount = false, onActiveChange, onCancel, compact = false }: {
  connected: boolean;
  onConnected: () => Promise<void>;
  autoStart?: boolean;
  reconnectOnMount?: boolean;
  onActiveChange?: (active: boolean) => void;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const { login, phase, message, active, working, startLogin, cancelLogin } = useWechatLogin({ connected, onConnected, autoStart, reconnectOnMount });
  const remaining = useConnectionCountdown(login?.expiresAt, active);
  useEffect(() => onActiveChange?.(active), [active, onActiveChange]);

  if (compact && !autoStart && !login?.qrSvg) return <div className="wechat-connect-compact"><button className="pa-button primary" type="button" onClick={() => void startLogin()} disabled={working}>{working ? "正在生成" : "开始扫码"}</button><small role="status">{working ? message : ""}</small></div>;

  const succeeded = connected && phase === "connected";
  const failed = phase === "error" || phase === "expired";
  const cancel = () => { cancelLogin(); onCancel?.(); };
  const generatePanel = <div className="wechat-connect-panel"><div className="domain-human-guide" role="status"><strong>{failed ? "本次二维码未能继续" : "正在生成一次性二维码"}</strong><p>{failed ? message : "二维码生成后会进入扫码节点；整个过程只用于本次连接。"}</p></div><div className="wechat-connect-controls"><Button type="button" onClick={() => void startLogin()} disabled={working}>{working ? <LoaderCircle className="connection-spinner size-4" /> : <QrCode className="size-4" />}{working ? "生成中" : "重新生成二维码"}</Button>{active ? <Button type="button" variant="outline" onClick={cancel}><X className="size-4" />取消连接</Button> : null}</div></div>;
  const scanPanel = <div className="wechat-connect-panel"><div className="domain-human-guide" role="status"><strong>使用手机微信扫码</strong><p>二维码仅供本次连接，请勿转发；扫码后会自动切换到手机确认节点。</p></div>{login?.qrSvg ? <div className="wechat-qr-stage"><img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(login.qrSvg)}`} alt="微信连接二维码" /><small>剩余 {formatConnectionCountdown(remaining)} · 请勿转发二维码</small></div> : null}<div className="wechat-connect-controls"><Button type="button" onClick={() => void startLogin()} disabled={working}><QrCode className="size-4" />重新生成二维码</Button><Button type="button" variant="outline" onClick={cancel}><X className="size-4" />取消连接</Button></div></div>;
  const confirmPanel = <div className="wechat-connect-panel"><div className="domain-human-guide" role="status"><strong>请在手机上确认连接</strong><p>二维码已经扫描。请回到微信点击确认，并保持此页面打开；PA 会自动检测最终状态。</p></div><div className="wechat-connect-controls"><Button type="button" variant="outline" onClick={cancel}><X className="size-4" />取消连接</Button><small role="status">{message}</small></div></div>;
  const completePanel = <div className="wechat-connection-evidence"><CheckCircle2 /><div><strong>微信已连接</strong><span>现在可以在微信中向 Personal Agent 发送文字、图片或文件；需要时可重新发起连接。</span></div></div>;
  return <ConnectionOperationSop icon={<QrCode />} title="微信扫码连接" summary={message} tone={succeeded ? "success" : failed ? "danger" : active ? "working" : "neutral"} statusLabel={succeeded ? "连接成功" : phase === "expired" ? "二维码过期" : phase === "error" ? "连接失败" : active ? "等待确认" : "准备连接"} steps={wechatSteps(phase)} stepPanels={{ "0": generatePanel, "1": scanPanel, "2": confirmPanel, "3": completePanel }} />;
}

function wechatSteps(phase: string): ConnectionOperationStep[] {
  const labels = ["生成登录二维码", "手机微信扫码", "手机确认连接", "检测连接状态"];
  const statuses: ConnectionOperationStep["status"][] = phase === "connected"
    ? ["passed", "passed", "passed", "passed"]
    : phase === "scanned" ? ["passed", "passed", "active", "pending"]
      : phase === "ready" ? ["passed", "active", "pending", "pending"]
        : phase === "generating" ? ["active", "pending", "pending", "pending"]
          : phase === "expired" ? ["passed", "failed", "pending", "pending"]
            : phase === "error" ? ["failed", "pending", "pending", "pending"]
              : ["pending", "pending", "pending", "pending"];
  return labels.map((label, index) => ({ id: String(index), label, status: statuses[index] }));
}
