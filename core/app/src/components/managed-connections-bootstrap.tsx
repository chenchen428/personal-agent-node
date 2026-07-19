"use client";

import { useEffect } from "react";
import { fetchJson } from "@/lib/client-json";

type SetupSnapshot = {
  checks?: Array<{ id?: string; state?: string }>;
  actions?: { managedCloud?: { state?: string; phase?: string } };
};

type Verification = { phase?: string };

export function ManagedConnectionsBootstrap({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let setupAttempted = false;
    let timer = 0;
    const schedule = (delay = 1500) => { if (active) timer = window.setTimeout(() => void reconcile(), delay); };
    const reconcile = async () => {
      try {
        const snapshot = await fetchJson<SetupSnapshot>("/api/system/setup");
        if (!active) return;
        const action = snapshot.actions?.managedCloud;
        if (["failed", "cancelled"].includes(action?.state || "")) return;
        const resourcesReady = ["connectivity.enrollment", "mail.identity"].every((id) => snapshot.checks?.find((check) => check.id === id)?.state === "ready");
        if (!resourcesReady && !setupAttempted && !["starting", "running"].includes(action?.state || "")) {
          setupAttempted = true;
          await fetchJson("/api/system/setup/managed-bootstrap", { method: "POST" });
          schedule();
          return;
        }
        if (!resourcesReady || ["starting", "running"].includes(action?.state || "")) {
          schedule();
          return;
        }
        await Promise.all([startVerification("sites"), startVerification("mail")]);
      } catch {
        // The persisted setup action exposes recovery only after the silent attempt fails.
      }
    };
    void reconcile();
    return () => { active = false; window.clearTimeout(timer); };
  }, [enabled]);
  return null;
}

async function startVerification(kind: "mail" | "sites") {
  const current = await fetchJson<{ verification: Verification }>(`/api/connections/${kind}/domain-binding`);
  if (current.verification?.phase !== "idle") return;
  await fetchJson(`/api/connections/${kind}/domain-binding`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deadlineAt: new Date(Date.now() + 3 * 60_000).toISOString() }),
  });
}
