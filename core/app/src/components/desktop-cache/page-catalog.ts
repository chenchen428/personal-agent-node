import type { ComponentType } from "react";

// Only product-owned client pages belong here. Server detail routes remain owned by Next.
export const desktopPageLoaders: Record<string, () => Promise<{ default: ComponentType }>> = {
  "/app": () => import("../desktop-v627/overview-page").then((module) => ({ default: module.OverviewPage })),
  "/app/conversations": () => import("../desktop-v627/conversation-page").then((module) => ({ default: module.ConversationPage })),
  "/app/connections": () => import("../desktop-v627/connections-page").then((module) => ({ default: module.ConnectionsPage })),
  "/app/workers": () => import("../desktop-v627/workers-page").then((module) => ({ default: module.WorkersPage })),
  "/app/mail": () => import("../desktop-v627/mail-page").then((module) => ({ default: module.MailPage })),
  "/app/data": () => import("../desktop-v627/data-page").then((module) => ({ default: module.DataPage })),
  "/app/pages": () => import("../desktop-v627/pages-page").then((module) => ({ default: module.PagesPage })),
  "/app/calendar": () => import("../desktop-v627/calendar-page").then((module) => ({ default: module.CalendarPage })),
  "/app/statistics/token-usage": () => import("../desktop-v627/token-usage-page").then((module) => ({ default: module.TokenUsagePage })),
  "/app/runtime": () => import("../desktop-v627/runtime-page").then((module) => ({ default: module.RuntimePage })),
  "/app/settings": () => import("../desktop-v627/settings-page").then((module) => ({ default: module.SettingsPage })),
  "/app/skills": () => import("../desktop-v627/skills-page").then((module) => ({ default: module.SkillsPage })),
  "/app/update": () => import("../desktop-v627/update-page").then((module) => ({ default: module.UpdatePage })),
};

export function isCachedDesktopPath(pathname: string) { return Object.hasOwn(desktopPageLoaders, pathname); }
