import { fetchJson } from "./client-json";
import { createLatestRequest } from "./latest-request";

/** Explicit refreshes must not reuse a GET begun before a completed mutation. */
export function createLatestJsonRequest() {
  const requests = createLatestRequest();
  let pending: AbortController | null = null;
  return {
    cancel() { requests.invalidate(); pending?.abort(); },
    async refresh<T>(url: string, callbacks: { value: (value: T) => void; error: (error: unknown) => void; settled: () => void }) {
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      const current = requests.begin();
      try {
        const value = await fetchJson<T>(url, { signal: controller.signal });
        if (current()) callbacks.value(value);
      } catch (error) { if (current()) callbacks.error(error); }
      finally { if (current()) callbacks.settled(); }
    },
  };
}
