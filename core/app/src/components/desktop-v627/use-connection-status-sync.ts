"use client";

import { useEffect, useRef, useState } from "react";
import { startConnectionPolling, type ConnectionSyncResult } from "../connection-polling";

export type { ConnectionSyncResult } from "../connection-polling";

export function useConnectionStatusSync({ active, complete, probe, refresh, onComplete, onFailure, timeoutMs = 2 * 60_000 }: {
  active: boolean;
  complete: boolean;
  probe: (signal: AbortSignal) => Promise<ConnectionSyncResult>;
  refresh: () => Promise<void>;
  onComplete: () => void;
  onFailure: (message: string) => void;
  timeoutMs?: number;
}) {
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const callbacks = useRef({ probe, refresh, onComplete, onFailure });
  useEffect(() => { callbacks.current = { probe, refresh, onComplete, onFailure }; });

  useEffect(() => {
    if (!active) { setRemainingSeconds(0); return; }
    if (complete) { callbacks.current.onComplete(); void callbacks.current.refresh().catch(() => {}); return; }
    const deadline = Date.now() + timeoutMs;
    const updateCountdown = () => setRemainingSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    updateCountdown();
    const countdownTimer = window.setInterval(updateCountdown, 1000);
    const stop = startConnectionPolling({
      deadline,
      probe: (signal) => callbacks.current.probe(signal),
      onResult: (result) => {
        if (result.state === "completed") {
          window.clearInterval(countdownTimer);
          setRemainingSeconds(0);
          callbacks.current.onComplete();
          // Catalog synchronization cannot undo successful authorization.
          void callbacks.current.refresh().catch(() => {});
        } else if (result.state === "failed") {
          window.clearInterval(countdownTimer);
          callbacks.current.onFailure(result.message || "连接授权未完成，请重试。");
        }
      },
      onError: () => {},
      onTimeout: () => { window.clearInterval(countdownTimer); callbacks.current.onFailure("连接授权等待已超时，请重新发起或检查本机服务。"); },
    });
    return () => { stop(); window.clearInterval(countdownTimer); };
  }, [active, complete, timeoutMs]);

  return remainingSeconds;
}

export function formatConnectionCountdown(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}
