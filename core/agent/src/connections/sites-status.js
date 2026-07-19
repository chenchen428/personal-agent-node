export function buildSitesConnectionStatus({ domainReady, domain, verified, external, verification }) {
  const platformDomainBound = Boolean(domainReady && verified);
  const publicReady = Boolean(platformDomainBound && external?.ready);
  const publicStatus = publicReady
    ? "ready"
    : platformDomainBound && external?.reason === "tunnel-offline"
      ? "tunnel-offline"
      : platformDomainBound
        ? "unavailable"
        : "not-bound";

  return {
    state: publicStatus === "tunnel-offline" || publicStatus === "unavailable" ? "degraded" : "connected",
    primaryAction: platformDomainBound ? "移除域名绑定" : "使用平台域名",
    statusLabel: publicStatus === "ready"
      ? "公网访问正常"
      : publicStatus === "tunnel-offline"
        ? "公网穿透离线"
        : publicStatus === "unavailable"
          ? "公网访问不可用"
          : "本地已连接",
    runtime: [
      { label: "公网域名", value: domain || "尚未分配" },
      {
        label: "公网访问",
        value: publicReady
          ? external.origin
          : publicStatus === "tunnel-offline"
            ? "安全穿透离线"
            : publicStatus === "unavailable"
              ? "公网连接未就绪"
              : domainReady
                ? "等待绑定验证"
                : "分配域名后可用",
      },
    ],
    details: {
      platformDomainBound,
      platformDomain: domain,
      publicReady,
      publicStatus,
      publicReason: external?.reason || "",
      publicOrigin: publicReady ? external.origin : "",
      domainVerification: verification,
    },
  };
}
