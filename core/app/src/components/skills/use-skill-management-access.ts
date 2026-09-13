"use client";
import { useEffect, useState } from "react";

export function canManageSkillsOnClient(hostname: string, userAgent: string, mobileHint = false) {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname)
    && !mobileHint && !/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
}

/** Presentation only; the gateway and Agent separately authorize every mutation. */
export function useSkillManagementAccess() {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    const mobile = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile === true
      || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    setAllowed(canManageSkillsOnClient(window.location.hostname, navigator.userAgent, mobile));
  }, []);
  return allowed;
}
