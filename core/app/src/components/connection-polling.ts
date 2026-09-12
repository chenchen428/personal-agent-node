export type ConnectionSyncResult = { state: "pending" | "completed" | "failed"; message?: string };

/** One authorization attempt owns one timer and one abortable request. */
export function startConnectionPolling<T extends ConnectionSyncResult>(options: {
  probe: (signal: AbortSignal) => Promise<T>;
  onResult: (result: T) => void;
  onError: (error: unknown) => void;
  onTimeout: () => void;
  deadline: number;
  initialDelayMs?: number;
  intervalMs?: number;
}) {
  const controller = new AbortController();
  let settled = false;
  let timer: ReturnType<typeof setTimeout>;
  let deadlineTimer: ReturnType<typeof setTimeout>;
  const stop = () => { settled = true; clearTimeout(timer); clearTimeout(deadlineTimer); controller.abort(); };
  const poll = async () => {
    if (settled) return;
    if (Date.now() >= options.deadline) { stop(); options.onTimeout(); return; }
    try {
      const result = await options.probe(controller.signal);
      if (settled) return;
      if (result.state !== "pending") stop();
      options.onResult(result);
    } catch (error) {
      if (!settled) options.onError(error);
    }
    if (!settled) timer = setTimeout(() => void poll(), Math.min(options.intervalMs ?? 1800, Math.max(0, options.deadline - Date.now())));
  };
  deadlineTimer = setTimeout(() => { if (!settled) { stop(); options.onTimeout(); } }, Math.max(0, options.deadline - Date.now()));
  timer = setTimeout(() => void poll(), Math.min(options.initialDelayMs ?? 1200, Math.max(0, options.deadline - Date.now())));
  return stop;
}
