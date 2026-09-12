"use client";

import { Component, type ReactNode } from "react";

export function RecoveryPanel({ onRetry, full = false }: { onRetry: () => void; full?: boolean }) {
  return <section role="alert" className="cove-recovery" style={{ padding: 32, display: "grid", justifyItems: "start", gap: 12 }}>
    <h2>{full ? "暂时无法打开 Cove" : "这个页面暂时无法显示"}</h2>
    <p>{full ? "请重新加载后继续。" : "可以重新加载这个页面，其他页面保持原样。"}</p>
    <button className="primary" type="button" onClick={onRetry}>{full ? "重新加载" : "重新加载此页面"}</button>
  </section>;
}

export class PageRecoveryBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <RecoveryPanel onRetry={this.props.onRetry} /> : this.props.children; }
}
