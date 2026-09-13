import type { ComponentType } from "react";
import { OverviewPage } from "../desktop-v627/overview-page";
import { ConversationPage } from "../desktop-v627/conversation-page";
import { ConnectionsPage } from "../desktop-v627/connections-page";
import { WorkersPage } from "../desktop-v627/workers-page";
import { PlansPage } from "../desktop-v627/plans-page";
import { ScheduledTasksPage } from "../desktop-v627/scheduled-tasks-page";
import { MailPage } from "../desktop-v627/mail-page";
import { DataPage } from "../desktop-v627/data-page";
import { PagesPage } from "../desktop-v627/pages-page";
import { CalendarPage } from "../desktop-v627/calendar-page";
import { TokenUsagePage } from "../desktop-v627/token-usage-page";
import { RuntimePage } from "../desktop-v627/runtime-page";
import { SettingsPage } from "../desktop-v627/settings-page";
import { MemoryPage } from "../desktop-v627/memory-page";
import { SkillsPage } from "../desktop-v627/skills-page";
import { UpdatePage } from "../desktop-v627/update-page";
import { SetupPage } from "../desktop-v627/setup-page";

// The finite desktop menu is loaded with the application, never on a menu click.
export const desktopPages: Record<string, ComponentType> = {
  "/app": OverviewPage,
  "/app/conversations": ConversationPage,
  "/app/connections": ConnectionsPage,
  "/app/workers": WorkersPage,
  "/app/workers/plans": PlansPage,
  "/app/workers/calendar": CalendarPage,
  "/app/workers/schedules": ScheduledTasksPage,
  "/app/mail": MailPage,
  "/app/data": DataPage,
  "/app/pages": PagesPage,
  "/app/calendar": CalendarPage,
  "/app/statistics/token-usage": TokenUsagePage,
  "/app/runtime": RuntimePage,
  "/app/settings": SettingsPage,
  "/app/settings/memory": MemoryPage,
  "/app/skills": SkillsPage,
  "/app/update": UpdatePage,
  "/app/setup": SetupPage,
};

export function isCachedDesktopPath(pathname: string) { return Object.hasOwn(desktopPages, pathname); }
