import type { ComponentType } from "react";
import {
  Activity, AppWindow, BarChart3, Bot, Cable, Database, FileText,
  Gauge, Info, LayoutDashboard, Mail, MessageCircle, Settings,
} from "lucide-react";

export type NavigationItem = {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
};

export type NavigationGroup = { label: string; items: NavigationItem[] };

export const desktopNavigationGroups: NavigationGroup[] = [
  { label: "核心功能", items: [
    { label: "总览", href: "/app", icon: LayoutDashboard },
    { label: "对话", href: "/app/conversations", icon: MessageCircle },
    { label: "连接", href: "/app/connections", icon: Cable },
  ] },
  { label: "Agent 组件", items: [
    { label: "任务", href: "/app/workers", icon: Bot },
    { label: "邮件", href: "/app/mail", icon: Mail },
    { label: "数据", href: "/app/data", icon: Database },
    { label: "发布页", href: "/app/pages", icon: FileText },
  ] },
  { label: "统计目录", items: [
    { label: "Token 统计", href: "/app/statistics/token-usage", icon: BarChart3 },
  ] },
];

export const desktopUtilityNavigation: NavigationItem[] = [
  { label: "运行设置", href: "/app/runtime", icon: Gauge },
  { label: "系统设置", href: "/app/settings", icon: Settings },
];

export const desktopNavigation = desktopNavigationGroups.flatMap((group) => group.items);

export const mobileNavigation: NavigationItem[] = [
  { label: "最近动态", href: "/app/mobile", icon: Activity },
  { label: "发布页", href: "/app/mobile/pages", icon: FileText },
  { label: "任务", href: "/app/mobile/workers", icon: Bot },
  { label: "全部应用", href: "/app/mobile/apps", icon: AppWindow },
  { label: "关于", href: "/app/mobile/about", icon: Info },
];
