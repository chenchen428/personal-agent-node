"use client";

import { RecoveryPanel } from "@/components/desktop-cache/recovery-panel";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="zh-CN"><body><RecoveryPanel full onRetry={reset} /></body></html>;
}
