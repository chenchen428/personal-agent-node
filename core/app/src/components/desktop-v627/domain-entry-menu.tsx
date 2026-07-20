"use client";

import { ChevronDown, Globe2, ServerCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function DomainEntryMenu({ disabled, onPlatform, onCustom }: { disabled?: boolean; onPlatform: () => void; onCustom: () => void }) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button className="connection-compact-action domain-entry-trigger" size="sm" disabled={disabled}>配置<ChevronDown aria-hidden="true" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" aria-label="域名入口选项" className="w-60">
      <DropdownMenuItem onSelect={onPlatform} className="items-start"><Globe2 className="mt-0.5 size-4 shrink-0" /><span className="grid gap-0.5"><strong className="font-medium text-[var(--pa-ink)]">使用平台域名</strong><small className="text-[10px] leading-4 text-[var(--pa-muted)]">自动分配并完成连接</small></span></DropdownMenuItem>
      <DropdownMenuItem onSelect={onCustom} className="items-start"><ServerCog className="mt-0.5 size-4 shrink-0" /><span className="grid gap-0.5"><strong className="font-medium text-[var(--pa-ink)]">使用自定义域名</strong><small className="text-[10px] leading-4 text-[var(--pa-muted)]">连接自己的服务器与域名</small></span></DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
