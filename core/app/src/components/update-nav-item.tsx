"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Download } from "lucide-react";

type UpdateSummary = { updateAvailable?: boolean; available?: { version?: string } | null; job?: { active?: boolean; status?: string } | null };

export function UpdateNavItem({ active }: { active: boolean }) {
  const [summary, setSummary] = useState<UpdateSummary>({});
  useEffect(() => {
    let mounted = true;
    const refresh = () => fetch("/api/system/update", { cache: "no-store" }).then((response) => response.ok ? response.json() : Promise.reject()).then((value) => { if (mounted) setSummary(value); }).catch(() => {});
    refresh();
    const firstFollowUp = window.setTimeout(refresh, 10_000);
    const timer = window.setInterval(refresh, 30 * 60_000);
    return () => { mounted = false; window.clearTimeout(firstFollowUp); window.clearInterval(timer); };
  }, []);
  const label = summary.job?.active ? "更新中" : summary.updateAvailable ? "新版本" : "";
  return <Link className={`v72-nav-link nav-link${active ? " active" : ""}`} aria-current={active ? "page" : undefined} href="/app/update"><Download /><span>软件更新</span>{label ? <em className="v72-update-badge nav-pill">{label}</em> : null}</Link>;
}
