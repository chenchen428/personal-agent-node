"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, KeyRound, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";

type Login = { session: string; status: string; expiresAt?: string; qrImage?: string };

export function XiaohongshuConnectPanel({ connected, onConnected }: { connected: boolean; onConnected: () => Promise<void> }) {
  const [login, setLogin] = useState<Login | null>(null);
  const [message, setMessage] = useState(connected ? "小红书已经连接。" : "生成一次性二维码后，使用小红书 App 扫码登录。");
  const [working, setWorking] = useState(false);
  const [code, setCode] = useState("");

  const startLogin = useCallback(async () => {
    setWorking(true); setLogin(null); setCode(""); setMessage("正在生成小红书二维码…");
    try {
      const response = await fetch("/api/channels/xiaohongshu/login/start", { method: "POST" });
      const payload = await response.json() as Login & { ok?: boolean; error?: string };
      if (!response.ok || payload.ok === false || !payload.session) throw new Error(payload.error || `HTTP ${response.status}`);
      setLogin(payload); setMessage(payload.status === "confirmed" ? "小红书已经连接。" : "请使用小红书 App 扫码，并在手机上确认登录。");
      if (payload.status === "confirmed") await onConnected();
    } catch { setMessage("暂时无法生成二维码，请确认小红书运行环境正常后重试。"); }
    finally { setWorking(false); }
  }, [onConnected]);

  useEffect(() => {
    const session = login?.session;
    if (!session || login.status === "confirmed") return;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      let terminal = false;
      try {
        const response = await fetch(`/api/channels/xiaohongshu/login/status?session=${encodeURIComponent(session)}`, { cache: "no-store" });
        const payload = await response.json() as Partial<Login> & { ok?: boolean; error?: string };
        if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`);
        if (cancelled) return;
        setLogin((current) => current?.session === session ? { ...current, ...payload } : current);
        if (payload.status === "confirmed") { terminal = true; setMessage("小红书连接成功。"); await onConnected(); }
        else if (payload.status === "scanned") setMessage("二维码已扫描，请在小红书 App 中确认登录。");
        else if (payload.status === "verification_required") setMessage("登录需要短信验证码，请在下方输入后提交。");
        else if (["missing", "expired", "error"].includes(payload.status || "")) { terminal = true; setMessage("二维码已失效，请重新生成。"); }
      } catch { if (!cancelled) setMessage("正在等待登录结果；长时间没有变化时请重新生成二维码。"); }
      finally { if (!cancelled && !terminal) timer = window.setTimeout(() => void poll(), 1800); }
    };
    timer = window.setTimeout(() => void poll(), 1800);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [login?.session, login?.status, onConnected]);

  const submitCode = async () => {
    if (!login?.session || !/^\d{4,8}$/.test(code)) { setMessage("请输入 4–8 位数字验证码。"); return; }
    setWorking(true); setMessage("正在提交验证码…");
    try {
      const response = await fetch("/api/channels/xiaohongshu/login/code", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: login.session, code }) });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`);
      setCode(""); setMessage("验证码已提交，正在等待登录结果。");
    } catch { setMessage("验证码提交失败，请确认验证码后重试。"); }
    finally { setWorking(false); }
  };

  if (connected) return <div className="v72-channel-connected"><CheckCircle2 /><div><strong>小红书已连接</strong><span>主 Agent 现在可以使用已授权的小红书能力。</span></div></div>;
  return <div className="v72-channel-connect"><div className="v72-channel-connect-copy"><strong>扫码连接</strong><p>二维码只在这台电脑上显示。使用小红书 App 扫码并确认登录。</p></div>{login?.qrImage ? <div className="v72-channel-qr"><img src={login.qrImage} alt="小红书登录二维码" /><small>二维码将在几分钟后失效，请勿转发。</small></div> : null}{login?.status === "verification_required" ? <div className="v72-channel-code"><KeyRound /><input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" autoComplete="one-time-code" placeholder="输入短信验证码" aria-label="小红书短信验证码" /><Button type="button" onClick={() => void submitCode()} disabled={working}>提交验证码</Button></div> : null}<div className="v72-channel-connect-actions"><Button type="button" onClick={() => void startLogin()} disabled={working}><QrCode />{working ? "处理中…" : login?.qrImage ? "重新生成二维码" : "生成二维码"}</Button><small role="status">{message}</small></div></div>;
}
