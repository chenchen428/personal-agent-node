import { startConnectionPolling, type ConnectionSyncResult } from "../connection-polling";

/** Transport errors are observations, not a failed domain verification. */
export function waitForConnectionResult<T extends ConnectionSyncResult>({ signal, deadline, probe, onResult, onError, timeoutMessage, intervalMs }: {
  signal: AbortSignal;
  deadline: number;
  probe: (signal: AbortSignal) => Promise<T>;
  onResult?: (result: T) => void;
  onError?: () => void;
  timeoutMessage: string;
  intervalMs?: number;
}): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("已取消", "AbortError")); return; }
    const finish = (action: () => void) => { stop(); signal.removeEventListener("abort", abort); action(); };
    const abort = () => finish(() => reject(new DOMException("已取消", "AbortError")));
    const stop = startConnectionPolling({
      deadline, initialDelayMs: 0, intervalMs,
      probe,
      onResult: (result) => {
        onResult?.(result);
        if (result.state !== "pending") finish(() => resolve(result));
      },
      onError: () => onError?.(),
      onTimeout: () => finish(() => reject(new Error(timeoutMessage))),
    });
    signal.addEventListener("abort", abort, { once: true });
  });
}
