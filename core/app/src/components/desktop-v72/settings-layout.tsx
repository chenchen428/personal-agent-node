import Link from "next/link";
import { Settings, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

export function SettingsLayout({ active, children }: { active: "settings" | "skills"; children: ReactNode }) {
  return <main className="page flush settings-layout"><nav className="settings-nav" aria-label="设置导航"><Link className={active === "settings" ? "active" : ""} href="/app/settings"><Settings aria-hidden="true" />设置</Link><Link className={active === "skills" ? "active" : ""} href="/app/skills"><Sparkles aria-hidden="true" />技能</Link></nav><section className="settings-content">{children}</section></main>;
}
