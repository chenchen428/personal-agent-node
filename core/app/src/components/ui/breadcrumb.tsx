import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

function Breadcrumb(props: React.ComponentProps<"nav">) { return <nav aria-label="面包屑" data-slot="breadcrumb" {...props} />; }
function BreadcrumbList({ className, ...props }: React.ComponentProps<"ol">) { return <ol data-slot="breadcrumb-list" className={cn("flex flex-wrap items-center gap-1.5 text-xs text-[var(--pa-muted)]", className)} {...props} />; }
function BreadcrumbItem({ className, ...props }: React.ComponentProps<"li">) { return <li data-slot="breadcrumb-item" className={cn("inline-flex items-center gap-1.5", className)} {...props} />; }
function BreadcrumbPage({ className, ...props }: React.ComponentProps<"span">) { return <span aria-current="page" data-slot="breadcrumb-page" className={cn("font-medium text-[var(--pa-ink)]", className)} {...props} />; }
function BreadcrumbSeparator({ children, className, ...props }: React.ComponentProps<"li">) { return <li aria-hidden="true" data-slot="breadcrumb-separator" className={cn("[&>svg]:size-3.5", className)} {...props}>{children ?? <ChevronRight />}</li>; }

export { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator };
