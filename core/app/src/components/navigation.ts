import type { ComponentType } from "react";
import {
  Activity, AppWindow, Boxes, BriefcaseBusiness, CircleGauge, Clock3,
  FileText, Info, LayoutGrid, Mail, MessageCircle, Radio, Sparkles, Workflow, Wrench,
} from "lucide-react";

export type NavigationItem = {
  label: string;
  href: string;
  symbol: string;
  icon: ComponentType<{ className?: string }>;
};

export const desktopNavigation: NavigationItem[] = [
  { label: "总览", href: "/app", symbol: "◈", icon: CircleGauge },
  { label: "对话", href: "/app/conversations", symbol: "✦", icon: MessageCircle },
  { label: "任务", href: "/app/workers", symbol: "↻", icon: BriefcaseBusiness },
  { label: "收到的邮件", href: "/app/mail", symbol: "@", icon: Mail },
  { label: "发布页", href: "/app/pages", symbol: "▧", icon: LayoutGrid },
  { label: "数据", href: "/app/data", symbol: "▦", icon: Boxes },
  { label: "自动化", href: "/app/automations", symbol: "⌁", icon: Workflow },
  { label: "渠道连接", href: "/app/channels", symbol: "↗", icon: Radio },
  { label: "技能", href: "/app/skills", symbol: "⌘", icon: Sparkles },
  { label: "初始化", href: "/app/setup", symbol: "✓", icon: Wrench },
  { label: "运行设置", href: "/app/runtime", symbol: "◌", icon: Clock3 },
];

export const mobileNavigation: NavigationItem[] = [
  { label: "最近动态", href: "/app/mobile", symbol: "动", icon: Activity },
  { label: "发布页", href: "/app/mobile/pages", symbol: "页", icon: FileText },
  { label: "任务", href: "/app/mobile/workers", symbol: "任", icon: BriefcaseBusiness },
  { label: "应用", href: "/app/mobile/apps", symbol: "应", icon: AppWindow },
  { label: "关于", href: "/app/mobile/about", symbol: "关", icon: Info },
];
