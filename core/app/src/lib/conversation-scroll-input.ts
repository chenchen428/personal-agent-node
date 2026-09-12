type ScrollActions = { scrolled: (userInitiated: boolean) => void; release: () => void; towardLatest: () => void };
type InputOptions = {
  windowTarget: EventTarget;
  previewRoot: EventTarget;
  setTimer: (callback: () => void, delay: number) => number;
  clearTimer: (id: number) => void;
};

/** Bound both inactivity and total inertia time; scrollend is only an optional fast path. */
export function bindConversationScrollInput(thread: EventTarget, actions: ScrollActions, options: InputOptions) {
  let active = false;
  let pointerHeld = false;
  let touchY = 0;
  let idleTimer: number | null = null;
  let hardTimer: number | null = null;
  const removals: (() => void)[] = [];
  const clear = () => {
    if (idleTimer !== null) options.clearTimer(idleTimer);
    if (hardTimer !== null) options.clearTimer(hardTimer);
    idleTimer = null; hardTimer = null;
  };
  const end = () => { active = false; clear(); };
  const idle = () => {
    if (idleTimer !== null) options.clearTimer(idleTimer);
    idleTimer = options.setTimer(end, 180);
  };
  const begin = () => {
    clear(); active = true; idle();
    hardTimer = options.setTimer(end, 1500);
  };
  const release = () => { end(); actions.release(); };
  const listen = (target: EventTarget, name: string, handler: (event: Event) => void) => {
    target.addEventListener(name, handler, { passive: true });
    removals.push(() => target.removeEventListener(name, handler));
  };
  listen(thread, "scroll", () => { actions.scrolled(active); if (active) idle(); });
  listen(thread, "scrollend", end);
  listen(thread, "wheel", (event) => {
    begin();
    if ((event as WheelEvent).deltaY < 0) actions.release(); else actions.towardLatest();
  });
  listen(thread, "keydown", (event) => {
    const key = event as KeyboardEvent;
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(key.key)) begin();
    if (["ArrowUp", "PageUp", "Home"].includes(key.key) || (key.key === " " && key.shiftKey)) actions.release();
  });
  listen(thread, "pointerdown", () => { pointerHeld = true; begin(); });
  listen(options.windowTarget, "pointermove", () => { if (pointerHeld) begin(); });
  listen(options.windowTarget, "pointerup", () => {
    if (!pointerHeld) return;
    if (active) actions.towardLatest();
    pointerHeld = false; end();
  });
  listen(options.windowTarget, "blur", () => { pointerHeld = false; end(); });
  listen(thread, "touchstart", (event) => { begin(); touchY = (event as TouchEvent).touches[0]?.clientY || 0; });
  listen(thread, "touchmove", (event) => {
    begin(); const next = (event as TouchEvent).touches[0]?.clientY || 0;
    if (next > touchY) actions.release(); touchY = next;
  });
  listen(thread, "touchend", begin);
  listen(thread, "touchcancel", end);
  listen(options.previewRoot, "chat-image-preview-open", release);
  listen(thread, "focusin", (event) => {
    const element = event.target as Element | null;
    if (typeof element?.matches === "function" && element.matches("img[data-chat-image], .chat-image-trigger, .message-earlier")) release();
  });
  return () => { end(); pointerHeld = false; removals.forEach((remove) => remove()); };
}
