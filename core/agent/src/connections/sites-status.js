export function buildSitesConnectionStatus({ domainReady, domain, verified, external, verification }) {
  const platformDomainBound = Boolean(domainReady && verified);
  const publicReady = Boolean(platformDomainBound && external?.ready);
  const publicStatus = publicReady
    ? "ready"
    : platformDomainBound && ["tunnel-offline", "degraded", "refreshing", "authorizing", "reauth_required"].includes(external?.reason)
      ? external.reason
      : platformDomainBound
        ? "unavailable"
        : "not-bound";

  return {
    state: publicStatus === "ready" || publicStatus === "not-bound" ? "connected" : "degraded",
    primaryAction: platformDomainBound ? "清空配置" : "配置",
    statusLabel: publicStatus === "ready"
      ? "公网访问正常"
      : publicStatus === "tunnel-offline"
        ? "公网穿透离线"
        : publicStatus === "refreshing"
          ? "正在自动续签连接凭据"
          : publicStatus === "authorizing"
            ? "正在通过浏览器会话恢复连接"
            : publicStatus === "reauth_required"
              ? "需要本人重新授权"
              : publicStatus === "degraded"
                ? "公网连接正在恢复"
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
            : publicStatus === "refreshing"
              ? "正在自动续签"
              : publicStatus === "authorizing"
                ? "正在静默恢复授权"
                : publicStatus === "reauth_required"
                  ? "等待本人授权"
                  : publicStatus === "degraded"
                    ? "连接恢复中"
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
