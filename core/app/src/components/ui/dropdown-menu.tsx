"use client";

import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

function DropdownMenuContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return <DropdownMenuPrimitive.Portal><DropdownMenuPrimitive.Content data-slot="dropdown-menu-content" sideOffset={sideOffset} className={cn("z-50 min-w-44 overflow-hidden rounded-lg border border-[var(--pa-line)] bg-white p-1 text-[var(--pa-body)] shadow-[0_14px_36px_rgba(26,31,27,.14)]", className)} {...props} /></DropdownMenuPrimitive.Portal>;
}

function DropdownMenuItem({ className, inset, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & { inset?: boolean }) {
  return <DropdownMenuPrimitive.Item data-slot="dropdown-menu-item" data-inset={inset || undefined} className={cn("relative flex min-h-10 cursor-default select-none items-center gap-2 rounded-md px-2.5 py-2 text-xs outline-none transition-colors focus:bg-[var(--pa-surface)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8", className)} {...props} />;
}

function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return <DropdownMenuPrimitive.Label data-slot="dropdown-menu-label" className={cn("px-2.5 py-1.5 text-[10px] font-medium text-[var(--pa-muted)]", className)} {...props} />;
}

function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator data-slot="dropdown-menu-separator" className={cn("-mx-1 my-1 h-px bg-[var(--pa-line)]", className)} {...props} />;
}

export { Check as DropdownMenuItemIndicator, ChevronRight as DropdownMenuSubIndicator, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger };
