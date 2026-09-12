"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { describeWechatLoginError, readWechatLoginPayload, WechatLoginRequestError } from "@/components/wechat-login-error";
import { syncWechatConnectionAfterLogin } from "@/components/wechat-login-sync";
import { startConnectionPolling, type ConnectionSyncResult } from "./connection-polling";

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
  const stopPolling = useRef<(() => void) | null>(null);
  const connectedCallback = useRef(onConnected);
  const wasConnected = useRef(connected);
  useEffect(() => { connectedCallback.current = onConnected; }, [onConnected]);
  useEffect(() => () => { attempt.current += 1; autoStarted.current = false; stopPolling.current?.(); }, []);

  const startLogin = useCallback(async () => {
    const currentAttempt = ++attempt.current;
    stopPolling.current?.();
    setLogin(null);
    setPhase("generating");
    setMessage("正在向微信申请一次性二维码…");
    try {
      const response = await fetch("/api/channels/wechat/login/start", { method: "POST" });
      const payload = await readWechatLoginPayload<WechatLogin & { ok?: boolean; code?: string; error?: string }>(response);
      if (!payload.session || !payload.qrSvg) {
        throw new WechatLoginRequestError(502, "WECHAT_QR_RESPONSE_INVALID", "微信连接服务没有返回有效二维码，请重新生成。");
      }
      if (attempt.current !== currentAttempt) return;
      setLogin({ ...payload, expiresAt: payload.expiresAt || new Date(Date.now() + 2 * 60_000).toISOString() });
      setPhase("ready");
      setMessage("等待你在微信中确认。这个页面会自动更新连接状态。");
    } catch (error) {
      if (attempt.current !== currentAttempt) return;
      setPhase("error");
      setMessage(describeWechatLoginError(error));
    }
  }, []);

  const cancelLogin = useCallback(() => {
    attempt.current += 1;
    stopPolling.current?.();
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
    if (!login) setPhase((current) => ["idle", "connected"].includes(current) ? connected ? "connected" : "idle" : current);
    if (!wasConnected.current && connected) {
      stopPolling.current?.();
      setPhase("connected");
      setMessage("微信连接成功。现在可以继续在微信中与 PA 沟通。");
    }
    if (wasConnected.current && !connected && login?.connected) {
      attempt.current += 1;
      setPhase("error");
      setMessage("微信连接已断开，请重新检测或生成二维码连接。");
    }
    wasConnected.current = connected;
  }, [connected, login]);

  useEffect(() => {
    const session = login?.session;
    if (!session || (phase !== "ready" && phase !== "scanned")) return;
    const currentAttempt = attempt.current;
    const expired = () => { setPhase("expired"); setMessage("二维码已过期，请重新生成。"); };
    const stop = startConnectionPolling<ConnectionSyncResult & { payload: Partial<WechatLogin> }>({
      deadline: new Date(login.expiresAt || "").getTime() || Date.now() + 2 * 60_000,
      initialDelayMs: 1800,
      probe: async (signal) => {
        const response = await fetch(`/api/channels/wechat/login/status?session=${encodeURIComponent(session)}`, { cache: "no-store", signal });
        const payload = await readWechatLoginPayload<Partial<WechatLogin> & { ok?: boolean; code?: string; error?: string }>(response);
        const state = payload.connected || payload.status === "confirmed" ? "completed"
          : ["missing", "expired"].includes(payload.status || "") ? "failed" : "pending";
        return { state, payload };
      },
      onResult: ({ state, payload }) => {
        if (attempt.current !== currentAttempt) return;
        setLogin((current) => current?.session === session ? { ...current, ...payload } : current);
        if (state === "completed") {
          setPhase("connected");
          setMessage("微信连接成功。现在可以继续在微信中与 PA 沟通。");
          void syncWechatConnectionAfterLogin(connectedCallback.current).then((synchronized) => {
            if (attempt.current === currentAttempt && !synchronized) setMessage("微信连接已成功，连接列表正在同步，无需重新扫码。");
          });
        } else if (payload.status === "scanned") {
          setPhase("scanned");
          setMessage("二维码已扫描，请在微信中确认连接。");
        } else if (state === "failed") expired();
      },
      onError: (error) => setMessage(`${describeWechatLoginError(error)} 页面会继续检测，也可以重新生成二维码。`),
      onTimeout: expired,
    });
    stopPolling.current = stop;
    return stop;
  }, [login?.expiresAt, login?.session, phase === "ready" || phase === "scanned"]);

  return { login, phase, message, active: ["generating", "ready", "scanned"].includes(phase), working: phase === "generating", startLogin, cancelLogin };
}
