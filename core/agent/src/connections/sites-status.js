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
    state: publicStatus === "ready" ? "connected" : "degraded",
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
          : domainReady
            ? "等待平台域名验证"
            : "未生效",
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
      authenticationRequired: external?.authenticationRequired === true,
      accessPolicy: external?.accessPolicy || "space-authenticated",
    },
  };
}

export function buildCustomSitesConnectionStatus({ binding, external, verification, relayInstallerUrl = "" }) {
  const ready = Boolean(external?.ready && external.bindingMode === "custom");
  const domain = external?.domain || binding.domain;
  const inherited = external?.inherited === true;
  const live = external?.tunnelReady === true;
  return {
    state: ready ? "connected" : "degraded", primaryAction: "清空配置",
    statusLabel: inherited ? ready ? "已继承主空间域名" : external.reason === "space-domain-verifying" ? "子域名自动验证中" : "等待主空间域名恢复"
      : ready ? "自定义域名已生效" : live ? "等待自定义域名验证" : "Relay 连接恢复中",
    runtime: [
      { label: "自定义域名", value: domain },
      { label: "Relay 连接", value: live ? "已连接" : "等待连接" },
      { label: "公网访问", value: ready ? external.origin : external?.verificationReady ? "连接恢复后可用" : "等待 DNS、TLS 与内容验证" },
    ],
    details: { platformDomainBound: false, bindingMode: "custom", customDomain: domain, customPublicAddress: `https://${domain}`,
      customServiceReady: live, customRelayCredentialPrepared: !inherited, customRelayInstallerUrl: relayInstallerUrl,
      publicReady: ready, publicStatus: external?.reason || "not-configured", publicOrigin: ready ? external.origin : "",
      authenticationRequired: true, accessPolicy: "space-authenticated", domainVerification: verification,
      ...(inherited ? { inherited: true, inheritedFromSpaceId: external.inheritedFromSpaceId, inheritedBaseDomain: external.inheritedBaseDomain } : {}),
    },
  };
}
