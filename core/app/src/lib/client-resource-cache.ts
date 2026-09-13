export type ResourceSnapshot<T = unknown> = { value: T; updatedAt: number; bytes: number; route?: string };

/** A document-owned cache. No browser storage and no server-side singleton data. */
export class ClientResourceCache {
  private entries = new Map<string, ResourceSnapshot>();
  private pending = new Set<AbortController>();
  private version = 0;
  private requestVersion = 0;
  private latestReads = new Map<string, number>();
  private scope = "";
  private bytes = 0;
  constructor(private maximumEntries = 64, private maximumBytes = 8 * 1024 * 1024) {}

  bind(scope: string) {
    if (this.scope === scope) return;
    this.clear(); this.scope = scope;
  }
  clear() {
    this.version += 1;
    this.pending.forEach((controller) => controller.abort()); this.pending.clear();
    this.entries.clear(); this.latestReads.clear(); this.bytes = 0;
  }
  get generation() { return this.version; }
  get size() { return this.entries.size; }
  get byteSize() { return this.bytes; }
  get scopeKey() { return this.scope; }
  track(controller: AbortController) { this.pending.add(controller); return () => { this.pending.delete(controller); }; }
  beginRead(key: string) {
    const version = ++this.requestVersion, scopeVersion = this.version;
    this.latestReads.delete(key); this.latestReads.set(key, version);
    while (this.latestReads.size > 128) this.latestReads.delete(this.latestReads.keys().next().value!);
    return () => this.version === scopeVersion && this.latestReads.get(key) === version;
  }
  get<T>(key: string): ResourceSnapshot<T> | undefined {
    const item = this.entries.get(key);
    if (item) { this.entries.delete(key); this.entries.set(key, item); }
    return item as ResourceSnapshot<T> | undefined;
  }
  forgetRoute(route: string) {
    for (const [key, entry] of this.entries) if (entry.route === route) { this.entries.delete(key); this.bytes -= entry.bytes; }
  }
  set(key: string, value: unknown, generation = this.version, route?: string) {
    if (!this.scope || generation !== this.version) return false;
    const bytes = JSON.stringify(value)?.length * 2 || 0;
    if (bytes > this.maximumBytes) return false;
    const previous = this.entries.get(key);
    if (previous) this.bytes -= previous.bytes;
    this.entries.delete(key); this.entries.set(key, { value, updatedAt: Date.now(), bytes, route }); this.bytes += bytes;
    while (this.entries.size > this.maximumEntries || this.bytes > this.maximumBytes) {
      const first = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(first)!.bytes; this.entries.delete(first);
    }
    return true;
  }
}

export const clientResourceCache = new ClientResourceCache();
export const PAGE_REFRESH_EVENT = "cove-page-refresh";
export const CACHE_STATUS_EVENT = "cove-cache-status";
export const CACHE_RESET_EVENT = "cove-cache-reset";
const failures = new Map<string, { route: string; message: string }>();
const inFlight = new Map<string, string>();

function notify() { if (typeof window !== "undefined") window.dispatchEvent(new Event(CACHE_STATUS_EVENT)); }
export function bindClientCache(scope: string) { clientResourceCache.bind(scope); }
export function clearClientCache(reason = "reset") {
  clientResourceCache.clear(); failures.clear(); inFlight.clear();
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CACHE_RESET_EVENT, { detail: reason }));
  notify();
}
export function requestCacheStatus(key: string, state: "pending" | "success" | "error" | "cancel", message = "", resource = key) {
  if (typeof window === "undefined") return;
  if (state === "pending") inFlight.set(key, window.location.pathname);
  else {
    const route = inFlight.get(key) || window.location.pathname;
    inFlight.delete(key);
    if (state === "error") failures.set(resource, { route, message });
    if (state === "success") failures.delete(resource);
  }
  while (failures.size > 64) failures.delete(failures.keys().next().value!);
  notify();
}
export function cacheStatusForRoute(route: string) {
  return { refreshing: [...inFlight.values()].includes(route), stale: [...failures.values()].some((item) => item.route === route) };
}
export function refreshVisiblePage() { if (typeof window !== "undefined") window.dispatchEvent(new Event(PAGE_REFRESH_EVENT)); }
