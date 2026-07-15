import * as React from "react";
import { cn } from "@/lib/utils";

function Card({ className, ...props }: React.ComponentProps<"article">) {
  return <article data-slot="card" className={cn("flex flex-col rounded-xl border border-[var(--hairline)] bg-[var(--canvas)]", className)} {...props} />;
}
function CardHeader({ className, ...props }: React.ComponentProps<"header">) {
  return <header data-slot="card-header" className={cn("grid gap-2 px-6 pt-6", className)} {...props} />;
}
function CardTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 data-slot="card-title" className={cn("m-0 text-2xl leading-tight", className)} {...props} />;
}
function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="card-description" className={cn("m-0 text-sm text-[var(--muted)]", className)} {...props} />;
}
function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("px-6 py-5", className)} {...props} />;
}
function CardFooter({ className, ...props }: React.ComponentProps<"footer">) {
  return <footer data-slot="card-footer" className={cn("mt-auto flex items-center px-6 pb-6", className)} {...props} />;
}

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
