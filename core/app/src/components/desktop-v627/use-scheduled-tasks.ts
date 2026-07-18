"use client";

import { useJson } from "./shared";
import type { ScheduledTasksResponse } from "./scheduled-task-types";

export function useScheduledTasks() {
  const result = useJson<ScheduledTasksResponse>("/api/app/schedules/tasks");
  return { ...result, tasks: result.value?.tasks || [] };
}
