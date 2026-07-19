"use client";

import { ChevronDown, Globe2, ServerCog } from "lucide-react";
import { Button } from "../desktop-v72/primitives";

export function DomainEntryMenu({ disabled, onPlatform, onCustom }: { disabled?: boolean; onPlatform: () => void; onCustom: () => void }) {
  return <div className="domain-entry-menu">
    <Button className="connection-compact-action domain-entry-trigger" variant="primary" disabled={disabled} onClick={onPlatform}>
      <Globe2 />配置<ChevronDown className="domain-entry-chevron" />
    </Button>
    <div className="domain-entry-popover" role="menu" aria-label="域名入口选项">
      <button type="button" role="menuitem" onClick={onCustom}>
        <ServerCog /><span><strong>使用自定义域名</strong><small>连接自己的服务器与域名</small></span>
      </button>
    </div>
  </div>;
}
