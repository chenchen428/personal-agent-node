"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type WechatLogin = {
  session: string;
  status: string;
  expiresAt?: string;
  qrSvg?: string;
  connected?: boolean;
};

export type WechatLoginPhase = "idle" | "generating" | "ready" | "scanned" | "expired" | "error" | "connected";

export function useWechatLogin({ connected, onConnected, autoStart = false, reconnectOnMount = false }: {
  connected: boolean;
  onConnected: () => Promise<void>;
  autoStart?: boolean;
  reconnectOnMount?: boolean;
}) {
  const [login, setLogin] = useState<WechatLogin | null>(null);
  const [phase, setPhase] = useState<WechatLoginPhase>(connected ? "connected" : "idle");
  const [message, setMessage] = useState(connected
    ? "微信已经连接，可以直接给 Agent 发消息。"
    : autoStart ? "正在生成一次性二维码…" : "生成一次性二维码后即可重新连接微信。");
  const autoStarted = useRef(false);
  const attempt = useRef(0);

  const startLogin = useCallback(async () => {
    const currentAttempt = ++attempt.current;
    setLogin(null);
    setPhase("generating");
    setMessage("正在向微信申请一次性二维码…");
    try {
      const response = await fetch("/api/channels/wechat/login/start", { method: "POST" });
      const payload = await response.json() as WechatLogin & { ok?: boolean; error?: string };
      if (!response.ok || payload.ok === false || !payload.session || !payload.qrSvg) throw new Error(payload.error || `HTTP ${response.status}`);
      if (attempt.current !== currentAttempt) return;
      setLogin({ ...payload, expiresAt: payload.expiresAt || new Date(Date.now() + 2 * 60_000).toISOString() });
      setPhase("ready");
      setMessage("等待你在微信中确认。这个页面会自动更新连接状态。");
    } catch {
      if (attempt.current !== currentAttempt) return;
      setPhase("error");
      setMessage("暂时无法生成二维码。请检查当前网络后重试。");
    }
  }, []);

  const cancelLogin = useCallback(() => {
    attempt.current += 1;
    setLogin(null);
    setPhase(connected ? "connected" : "idle");
    setMessage(connected ? "已取消本次重新连接，原有微信连接保持不变。" : "已取消本次微信连接。需要时可以重新生成二维码。");
  }, [connected]);

  useEffect(() => {
    if (!autoStart || (connected && !reconnectOnMount) || autoStarted.current) return;
    autoStarted.current = true;
    void startLogin();
  }, [autoStart, connected, reconnectOnMount, startLogin]);

  useEffect(() => {
    if (connected && !login) setPhase("connected");
  }, [connected, login]);

  useEffect(() => {
    const session = login?.session;
    if (!session) return;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      let terminal = false;
      if (login.expiresAt && Date.now() >= new Date(login.expiresAt).getTime()) {
        terminal = true;
        setPhase("expired");
        setMessage("二维码已过期，请重新生成。");
        return;
      }
      try {
        const response = await fetch(`/api/channels/wechat/login/status?session=${encodeURIComponent(session)}`, { cache: "no-store" });
        const payload = await response.json() as Partial<WechatLogin> & { ok?: boolean; error?: string };
        if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`);
        if (cancelled) return;
        setLogin((current) => current?.session === session ? { ...current, ...payload } : current);
        if (payload.connected || payload.status === "confirmed") {
          terminal = true;
          setPhase("connected");
          setMessage("微信连接成功。现在可以继续在微信中与 PA 沟通。");
          await onConnected();
        } else if (payload.status === "scanned") {
          setPhase("scanned");
          setMessage("二维码已扫描，请在微信中确认连接。");
        } else if (["missing", "expired"].includes(payload.status || "")) {
          terminal = true;
          setPhase("expired");
          setMessage("二维码已过期，请重新生成。");
        }
      } catch {
        if (!cancelled) setMessage("正在等待微信确认；如果长时间没有变化，请重新生成二维码。");
      } finally {
        if (!cancelled && !terminal) timer = window.setTimeout(() => void poll(), 1800);
      }
    };
    timer = window.setTimeout(() => void poll(), 1800);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [login?.expiresAt, login?.session, onConnected]);

  return { login, phase, message, active: ["generating", "ready", "scanned"].includes(phase), working: phase === "generating", startLogin, cancelLogin };
}
