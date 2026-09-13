import { buildSpaceNavigationUrl, waitForSpaceRuntime, type SpaceRuntimeTarget } from "./space-navigation";

export type SpaceTransitionTarget = SpaceRuntimeTarget & { displayName: string };
export type SpaceTransitionState = {
  target: SpaceTransitionTarget;
  phase: "connecting" | "opening" | "error";
  error?: string;
} | null;

/** A document-local operation. No Space content or transition state is persisted. */
export function createSpaceTransition({
  onChange, navigate, currentHref, wait = waitForSpaceRuntime,
}: {
  onChange: (state: SpaceTransitionState) => void;
  navigate: (url: string) => void;
  currentHref: () => string;
  wait?: typeof waitForSpaceRuntime;
}) {
  let pending: AbortController | null = null;
  let opening = false;
  return {
    async start(target: SpaceTransitionTarget) {
      if (pending || opening) return;
      const controller = new AbortController(); pending = controller;
      onChange({ target, phase: "connecting" });
      try {
        const ready = await wait(target, { signal: controller.signal });
        if (controller.signal.aborted || pending !== controller) return;
        opening = true;
        onChange({ target, phase: "opening" });
        navigate(buildSpaceNavigationUrl(ready, currentHref()));
      } catch (cause) {
        if (controller.signal.aborted || pending !== controller) return;
        opening = false;
        onChange({ target, phase: "error", error: cause instanceof Error ? cause.message : "暂时无法连接此空间，请重试。" });
      } finally { if (pending === controller) pending = null; }
    },
    dismiss() {
      if (opening) return;
      pending?.abort(); pending = null;
      onChange(null);
    },
    dispose() { pending?.abort(); pending = null; },
    restore() { pending?.abort(); pending = null; opening = false; onChange(null); },
  };
}
