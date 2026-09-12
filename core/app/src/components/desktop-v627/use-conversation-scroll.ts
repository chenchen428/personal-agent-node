"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createConversationScroll } from "@/lib/conversation-scroll";
import { bindConversationScrollInput } from "@/lib/conversation-scroll-input";

export function useConversationScroll(revision: unknown) {
  const threadRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const controller = useRef<ReturnType<typeof createConversationScroll> | null>(null);
  const [pinned, setPinned] = useState(true);
  useLayoutEffect(() => {
    const thread = threadRef.current;
    const content = contentRef.current;
    if (!thread || !content) return;
    const nodes = () => Array.from(content.querySelectorAll<HTMLElement>("[data-message-id]"));
    const offset = (node: HTMLElement) => node.getBoundingClientRect().top - thread.getBoundingClientRect().top;
    const current = createConversationScroll({
      metrics: () => ({ top: thread.scrollTop, height: thread.scrollHeight, viewport: thread.clientHeight }),
      anchor: () => {
        const node = nodes().find((item) => item.getBoundingClientRect().bottom > thread.getBoundingClientRect().top);
        return node ? { id: node.dataset.messageId!, offset: offset(node) } : null;
      },
      offset: (id) => { const node = nodes().find((item) => item.dataset.messageId === id); return node ? offset(node) : null; },
      writeTop: (top) => { thread.scrollTop = top; },
      frame: window.requestAnimationFrame.bind(window), cancelFrame: window.cancelAnimationFrame.bind(window), pinnedChanged: setPinned,
    });
    controller.current = current;
    const unbindInput = bindConversationScrollInput(thread, current, {
      windowTarget: window,
      previewRoot: thread.closest('[data-session-role="main"]') || thread,
      setTimer: window.setTimeout.bind(window), clearTimer: window.clearTimeout.bind(window),
    });
    content.addEventListener("load", current.layoutChanged, true);
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(current.layoutChanged);
    resize?.observe(thread); resize?.observe(content);
    current.layoutChanged();
    return () => {
      current.dispose(); controller.current = null; resize?.disconnect();
      unbindInput(); content.removeEventListener("load", current.layoutChanged, true);
    };
  }, []);
  useLayoutEffect(() => { controller.current?.layoutChanged(); }, [revision]);
  return { threadRef, contentRef, pinned, latest: () => controller.current?.latest(), preserveAnchor: () => controller.current?.release() };
}
