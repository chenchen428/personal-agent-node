import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border text-sm font-medium whitespace-nowrap transition-colors outline-none disabled:pointer-events-none disabled:opacity-45 focus-visible:ring-3 focus-visible:ring-[rgba(204,120,92,.18)]",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[var(--coral)] px-5 text-white active:bg-[var(--coral-active)]",
        outline: "border-[var(--hairline)] bg-[var(--canvas)] px-5 text-[var(--ink)]",
        ghost: "border-transparent bg-transparent px-3 text-[var(--ink)]",
      },
      size: {
        default: "h-10",
        sm: "h-9 min-h-9 px-3 text-xs",
        icon: "size-10 min-h-10 px-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({ className, variant, size, asChild = false, ...props }: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { Button, buttonVariants };
