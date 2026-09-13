import type { CalendarEntry, CalendarResult } from "../calendar/data";

export type Recurrence = { frequency: "daily" | "weekly" | "monthly" | "yearly" | "cron"; interval?: number; weekdays?: number[]; until?: string | null; count?: number | null; cron?: string; expression?: string };
export type ExecutionMode = "record" | "remind" | "execute";
export type PlanRun = { id: string; planId: string; occurrenceAt: string; status: string; sessionId?: string | null; createdAt: string; updatedAt: string; finishedAt?: string | null; error?: string | null; result?: string | null; snapshot?: { title?: string } };
export type Plan = CalendarEntry & { recurrence: Recurrence | null; executionMode: ExecutionMode; executionPrompt: string; enabled: boolean; missedRunPolicy: "skip" | "latest"; nextOccurrenceAt: string | null; latestRun: PlanRun | null; legacy?: { migrationWarning?: string; runCount?: number } };
export type PlansResult = CalendarResult<Plan>;
