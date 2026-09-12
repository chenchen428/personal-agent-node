"use client";

import { RecoveryPanel } from "@/components/desktop-cache/recovery-panel";

export default function PageError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RecoveryPanel onRetry={reset} />;
}
