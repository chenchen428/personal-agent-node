"use client";

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
    <select aria-label="按状态筛选任务" value={value} onChange={(event) => onChange(event.target.value as WorkerStatusFilter)}>
      {workerStatusOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
    </select>
  </div>;
}
