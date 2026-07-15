import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return <input type={type} data-slot="input" className={cn("h-10 w-full rounded-lg border border-[var(--hairline)] bg-[var(--canvas)] px-3 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--muted-soft)] focus:border-[var(--coral)] focus:ring-3 focus:ring-[rgba(204,120,92,.14)] disabled:opacity-50", className)} {...props} />;
}

export { Input };
