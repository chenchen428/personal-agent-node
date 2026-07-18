"use client";

import { useEffect, useState } from "react";

export type ConnectionSyncResult = { state: "pending" | "completed" | "failed"; message?: string };

export function useConnectionStatusSync({ active, complete, probe, refresh, onComplete, onFailure, timeoutMs = 2 * 60_000 }: {
  active: boolean;
  complete: boolean;
  probe: () => Promise<ConnectionSyncResult>;
  refresh: () => Promise<void>;
  onComplete: () => void;
  onFailure: (message: string) => void;
  timeoutMs?: number;
}) {
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  useEffect(() => {
    if (!active) { setRemainingSeconds(0); return; }
    if (complete) { onComplete(); return; }
    let cancelled = false;
    let timer = 0;
    let countdownTimer = 0;
    const startedAt = Date.now();
    const updateCountdown = () => setRemainingSeconds(Math.max(0, Math.ceil((timeoutMs - (Date.now() - startedAt)) / 1000)));
    updateCountdown();
    countdownTimer = window.setInterval(updateCountdown, 1000);
    const poll = async () => {
      let terminal = false;
      try {
        const result = await probe();
        if (cancelled) return;
        if (result.state === "completed") {
          terminal = true;
          await refresh();
          if (!cancelled) onComplete();
        } else if (result.state === "failed") {
          terminal = true;
          onFailure(result.message || "连接授权未完成，请重试。");
        } else if (Date.now() - startedAt >= timeoutMs) {
          terminal = true;
          onFailure("连接授权等待已超时，请重新发起。");
        }
      } catch {
        if (Date.now() - startedAt >= timeoutMs) {
          terminal = true;
          if (!cancelled) onFailure("连接状态暂时无法读取，请重新发起或检查本机服务。");
        }
      } finally {
        if (!cancelled && !terminal) timer = window.setTimeout(() => void poll(), 1800);
      }
    };
    timer = window.setTimeout(() => void poll(), 1200);
    return () => { cancelled = true; window.clearTimeout(timer); window.clearInterval(countdownTimer); };
  }, [active, complete, onComplete, onFailure, probe, refresh, timeoutMs]);

  return remainingSeconds;
}

export function formatConnectionCountdown(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}
