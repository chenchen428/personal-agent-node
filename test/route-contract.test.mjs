import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildRoutes } from "../core/runtime/src/gateway.ts";
import { routeContractIssues } from "../scripts/lib/route-contract.mjs";

const root = path.resolve(import.meta.dirname, "..");
const registry = JSON.parse(fs.readFileSync(path.join(root, "registry/routes.json")));
const distribution = JSON.parse(fs.readFileSync(path.join(root, "registry/site-distribution.json")));

test("registered routes and gateway paths agree on access", () => {
  assert.deepEqual(routeContractIssues(registry, distribution), []);
});

test("route contract rejects a public gateway change without a registry update", () => {
  const changed = structuredClone(distribution);
  changed.routing.paths.find((route) => route.key === "app-files").access = "public";
  assert.match(routeContractIssues(registry, changed).join("\n"), /\/app\/files\/\*: registry authenticated, gateway public/);
});

test("route contract rejects an unregistered gateway path", () => {
  const changed = structuredClone(distribution);
  changed.routing.paths.push({ key: "unexpected", prefix: "/new-public", access: "public", kind: "proxy", targetKey: "agent", upstreamPath: "/pages" });
  assert.match(routeContractIssues(registry, changed).join("\n"), /\/new-public: gateway route is missing from the registry/);
});

test("route contract rejects a gateway target without an upstream", () => {
  const changed = structuredClone(distribution);
  changed.routing.paths.find((route) => route.key === "public-pages").targetKey = "unknown";
  assert.match(routeContractIssues(registry, changed).join("\n"), /\/public: unsupported gateway target or upstream path/);
});

test("gateway keeps Page and skill management targets on their authorized hops", () => {
  const routes = buildRoutes({ routingMode: "path", distribution, ports: { admin: 8791, bridge: 8788 }, pluginsDir: path.join(root, ".local", "absent-plugins"), dataRoot: path.join(root, ".local") });
  for (const [prefix, access, target, upstreamPath] of [
    ["/", "authenticated", "http://127.0.0.1:8791", "/app"],
    ["/public", "public", "http://127.0.0.1:8788", "/pages"],
    ["/pages", "authenticated", "http://127.0.0.1:8788", "/pages"],
    ["/publications", "authenticated", "http://127.0.0.1:8788", "/publications"],
    ["/app/files", "authenticated", "http://127.0.0.1:8788", "/private-files"],
    ["/api/skills/user", "authenticated", "http://127.0.0.1:8791", "/api/skills/user"],
  ]) {
    assert.deepEqual({ access: routes.get(prefix)?.access, target: routes.get(prefix)?.target, upstreamPath: routes.get(prefix)?.upstreamPath }, { access, target, upstreamPath }, prefix);
  }
});
