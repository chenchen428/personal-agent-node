export type MessageAnchor = { id: string; offset: number };
export type ConversationScrollPort = {
  metrics: () => { top: number; height: number; viewport: number };
  anchor: () => MessageAnchor | null;
  offset: (id: string) => number | null;
  writeTop: (top: number) => void;
  frame: (callback: () => void) => number;
  cancelFrame: (id: number) => void;
  pinnedChanged: (pinned: boolean) => void;
};

/** Content updates never decide whether the reader wants to follow the newest message. */
export function createConversationScroll(port: ConversationScrollPort) {
  let pinned = true;
  let anchor: MessageAnchor | null = null;
  let top = port.metrics().top;
  let expectedTop: number | null = null;
  let pending: number | null = null;
  let disposed = false;
  const setPinned = (value: boolean) => { if (pinned !== value) { pinned = value; port.pinnedChanged(value); } };
  const capture = () => { anchor = port.anchor(); top = port.metrics().top; };
  const write = (value: number) => {
    const metrics = port.metrics();
    expectedTop = Math.max(0, Math.min(value, metrics.height - metrics.viewport));
    port.writeTop(expectedTop); top = expectedTop;
  };
  const layoutChanged = () => {
    if (disposed || pending !== null) return;
    pending = port.frame(() => {
      pending = null;
      if (disposed) return;
      if (pinned) write(port.metrics().height);
      else {
        const currentOffset = anchor ? port.offset(anchor.id) : null;
        write(currentOffset !== null && anchor ? port.metrics().top + currentOffset - anchor.offset : top);
      }
      capture();
    });
  };
  return {
    layoutChanged,
    scrolled(userInitiated = false) {
      const metrics = port.metrics();
      if (expectedTop !== null && Math.abs(metrics.top - expectedTop) < 1) { expectedTop = null; capture(); return; }
      expectedTop = null;
      if (!userInitiated) return;
      setPinned(metrics.height - metrics.viewport - metrics.top <= 24);
      capture();
    },
    release() { expectedTop = null; setPinned(false); capture(); },
    towardLatest() {
      const metrics = port.metrics();
      if (metrics.height - metrics.viewport - metrics.top <= 24) { setPinned(true); capture(); }
    },
    latest() { setPinned(true); anchor = null; layoutChanged(); },
    dispose() { disposed = true; if (pending !== null) port.cancelFrame(pending); pending = null; },
  };
}
