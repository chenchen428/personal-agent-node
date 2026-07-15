import * as React from "react";
import { cn } from "@/lib/utils";

function Progress({ className, value = 0, ...props }: Omit<React.ComponentProps<"div">, "children"> & { value?: number }) {
  const normalized = Math.min(100, Math.max(0, value));
  return (
    <div
      data-slot="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={normalized}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-[var(--surface-card)]", className)}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        className="h-full w-full origin-left rounded-full bg-[var(--coral)] transition-transform duration-500"
        style={{ transform: `scaleX(${normalized / 100})` }}
      />
    </div>
  );
}

export { Progress };
