const probe = "__route_contract_probe__";

export function routeContractIssues(registry, distribution) {
  const gatewayRoutes = distribution.routing.paths;
  const issues = [];
  for (const route of registry.routes) {
    // Internal Agent endpoints are not exposed by the public gateway.
    if (route.pattern.startsWith("/internal/")) continue;
    const pathname = route.pattern.endsWith("/*") ? `${route.pattern.slice(0, -1)}${probe}` : route.pattern;
    const gateway = matchGateway(gatewayRoutes, pathname);
    if (!gateway) issues.push(`${route.pattern}: no gateway route`);
    else if (gateway.access !== route.access) issues.push(`${route.pattern}: registry ${route.access}, gateway ${gateway.access}`);
  }
  for (const gateway of gatewayRoutes) {
    if (gateway.kind === "proxy" && (!(["console", "agent"].includes(gateway.targetKey)) || !gateway.upstreamPath?.startsWith("/"))) {
      issues.push(`${gateway.prefix}: unsupported gateway target or upstream path`);
    }
    const paths = gateway.exact ? [gateway.prefix] : [gateway.prefix, `${gateway.prefix.replace(/\/$/, "")}/${probe}`];
    for (const pathname of paths) {
      const registered = matchRegistry(registry.routes, pathname);
      if (!registered) issues.push(`${pathname}: gateway route is missing from the registry`);
      else if (registered.access !== gateway.access) issues.push(`${pathname}: registry ${registered.access}, gateway ${gateway.access}`);
    }
  }
  return issues;
}

function matchGateway(routes, pathname) {
  return routes.filter((route) => route.exact
    ? pathname === route.prefix
    : pathname === route.prefix || pathname.startsWith(`${route.prefix.replace(/\/$/, "")}/`))
    .sort((left, right) => right.prefix.length - left.prefix.length)[0];
}

function matchRegistry(routes, pathname) {
  return routes.filter((route) => route.pattern.endsWith("/*")
    ? pathname === route.pattern.slice(0, -2) || pathname.startsWith(route.pattern.slice(0, -1))
    : pathname === route.pattern)
    .sort((left, right) => right.pattern.length - left.pattern.length)[0];
}
