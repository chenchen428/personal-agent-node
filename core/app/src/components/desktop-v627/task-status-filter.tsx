"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WorkerStatusFilter } from "./worker-status";
import { workerStatusOptions } from "./worker-status";

export function TaskStatusFilter({ value, count, onChange }: {
  value: WorkerStatusFilter;
  count: number;
  onChange: (value: WorkerStatusFilter) => void;
}) {
  const label = workerStatusOptions.find((option) => option.value === value)?.label || "全部";
  return <div className="v72-list-controls">
    <span>{label} · {count}</span>
    <Select value={value} onValueChange={(next) => onChange(next as WorkerStatusFilter)}>
      <SelectTrigger className="h-7 min-h-7 w-[92px] rounded-md border-[var(--v72-border)] bg-[var(--v72-canvas)] px-2 text-[10px] font-semibold" aria-label="按状态筛选任务">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {workerStatusOptions.map((option) => <SelectItem value={option.value} key={option.value}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
  </div>;
}
