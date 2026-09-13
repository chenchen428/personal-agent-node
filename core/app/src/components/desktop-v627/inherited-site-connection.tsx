import { KeyValueGrid } from "../desktop-v72/primitives";
import type { Connection } from "./connection-types";

export function InheritedSiteConnection({ connection }: { connection: Connection }) {
  const details = connection.details;
  const parentDomain = details?.inheritedBaseDomain;
  const currentAddress = details?.publicOrigin || details?.customPublicAddress || details?.platformDomain || details?.customDomain;
  const items = [
    ...(parentDomain ? [{ label: "主空间域名", value: parentDomain }] : []),
    ...(currentAddress ? [{ label: "当前空间入口", value: currentAddress }] : []),
  ];
  return <section className="connection-summary-action" aria-label="继承的域名连接">
    <p>{connection.description}</p>
    <div className="domain-human-guide">
      <strong>沿用主空间的域名连接</strong>
      <p>域名和公网入口由主空间统一管理，无需在当前空间重新配置。如需更换域名或调整连接，请切换到主空间，在「连接」中管理。</p>
      {items.length ? <KeyValueGrid items={items} /> : null}
    </div>
  </section>;
}
