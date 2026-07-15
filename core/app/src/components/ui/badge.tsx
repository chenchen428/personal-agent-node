import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none", {
  variants: {
    variant: {
      neutral: "border-[var(--hairline)] bg-[var(--surface-soft)] text-[var(--muted)]",
      ready: "border-[rgba(93,184,114,.32)] bg-[rgba(93,184,114,.1)] text-[#367b48]",
      warning: "border-[rgba(212,160,23,.34)] bg-[rgba(212,160,23,.1)] text-[#8b6810]",
      error: "border-[rgba(198,69,69,.3)] bg-[rgba(198,69,69,.09)] text-[var(--error)]",
    },
    defaultVariants: { variant: "neutral" },
  },
});

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
