"use client";

import { useEffect, useState } from "react";

export function useConnectionCountdown(expiresAt: string | undefined, active: boolean) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!active || !expiresAt) { setRemaining(0); return; }
    const update = () => setRemaining(Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [active, expiresAt]);
  return remaining;
}
