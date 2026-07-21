import Link from "next/link";
import { Brain, Settings, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

export function SettingsLayout({ active, children }: { active: "general" | "memory" | "skills"; children: ReactNode }) {
  return <main className="page flush settings-layout"><nav className="settings-nav" aria-label="空间设置导航"><Link className={active === "general" ? "active" : ""} href="/app/settings"><Settings aria-hidden="true" />通用</Link><Link className={active === "memory" ? "active" : ""} href="/app/settings/memory"><Brain aria-hidden="true" />记忆</Link><Link className={active === "skills" ? "active" : ""} href="/app/skills"><Sparkles aria-hidden="true" />技能</Link></nav><section className={`settings-content${active === "general" ? "" : " collection"}`}>{children}</section></main>;
}
