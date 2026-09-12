/** Invalidate obsolete responses before a newer request or a local mutation. */
export function createLatestRequest() {
  let revision = 0;
  return {
    invalidate() { revision += 1; },
    begin() {
      const current = ++revision;
      return () => current === revision;
    },
  };
}
