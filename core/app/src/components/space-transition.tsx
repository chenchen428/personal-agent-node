"use client";

import React, { useLayoutEffect, useRef } from "react";
import { AlertCircle, Layers3, LoaderCircle } from "lucide-react";
import type { SpaceTransitionState } from "../lib/space-transition";

export function SpaceTransition({ state, onDismiss, onRetry }: {
  state: NonNullable<SpaceTransitionState>;
  onDismiss: () => void;
  onRetry: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); };
  }, []);
  const failed = state.phase === "error";
  return <dialog ref={dialog} className="cove-space-transition" aria-labelledby="space-transition-title"
    onCancel={(event) => { event.preventDefault(); onDismiss(); }}>
    <div className="cove-transition-content">
      <header className="cove-transition-heading">
        <span className="cove-transition-symbol">{failed ? <AlertCircle aria-hidden="true" /> : <Layers3 aria-hidden="true" />}</span>
        <p>{failed ? "暂时无法切换" : "正在切换空间"}</p>
        <h1 id="space-transition-title">{state.target.displayName}</h1>
        <p role={failed ? "alert" : "status"} className="cove-transition-status">
          {!failed ? <LoaderCircle className="cove-transition-spinner" aria-hidden="true" /> : null}
          {failed ? state.error : state.phase === "opening" ? "空间已就绪，正在打开…" : state.target.state === "running" ? "正在连接空间…" : "正在启动空间，请稍候…"}
        </p>
      </header>
      <SpaceContentSkeleton />
      <footer className="cove-transition-actions">
        <button type="button" disabled={state.phase === "opening"} onClick={onDismiss}>留在当前空间</button>
        {failed ? <button className="primary" type="button" onClick={onRetry}>重试切换</button> : null}
      </footer>
    </div>
  </dialog>;
}

export function SpaceContentSkeleton() {
  return <div className="cove-space-skeleton" aria-hidden="true">
    <div className="cove-skeleton-toolbar"><span /><i /></div>
    {[0, 1, 2].map((row) => <div className="cove-skeleton-row" key={row}><i /><div><span /><span /></div><b /></div>)}
  </div>;
}
