export type ScheduledTask = {
  id: string;
  name: string;
  cron: string;
  timezone: string;
  prompt: string;
  workspaceName: string;
  recipientId: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastSessionId: string | null;
  runCount: number;
  lastError: string;
  createdAt: string;
  updatedAt: string;
};

export type ScheduledTasksResponse = {
  ok: boolean;
  tasks: ScheduledTask[];
};
