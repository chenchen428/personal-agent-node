import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("Agent team pages use the runtime Agent registry API as their only profile source", () => {
  const list = read("core/app/src/components/desktop-v627/agent-team-page.tsx");
  const detail = read("core/app/src/components/desktop-v627/agent-profile-page.tsx");
  const featured = read("core/app/src/components/desktop-v627/agent-featured-output.tsx");
  const server = read("core/agent/src/server/server.ts");
  const registry = JSON.parse(read("registry/agents.json"));

  assert.match(list, /useJson<AgentsResponse>\("\/api\/agents"\)/);
  assert.match(detail, /useJson<AgentsResponse>\("\/api\/agents"\)/);
  assert.match(server, /listAgentProfiles\(config\.workspaceRoot\)\.map\(serializeAgentProfile\)/);
  assert.doesNotMatch(`${list}\n${detail}`, /video-creator|interior-designer|travel-planner|poster-designer|finance-analyst/);
  assert.ok(registry.agents.every((agent) => agent.publicProfile?.role && agent.publicProfile?.outputs?.length));
  assert.ok(registry.agents.every((agent) => agent.example?.title && agent.example?.devices?.length));
  assert.match(detail, /<AgentFeaturedOutput agent=\{agent\} \/>/);
  assert.match(featured, /output\.kind === "gallery"/);
  assert.match(featured, /output\.kind === "video"/);
  assert.match(featured, /output\.kind === "image"/);
});

test("every registered Agent ships its representative output inside the Node product", () => {
  const registry = JSON.parse(read("registry/agents.json"));
  for (const agent of registry.agents) {
    const routes = [agent.example.src, agent.example.poster, ...(agent.example.items || []).map((item) => item.src)].filter(Boolean);
    assert.ok(routes.length, `${agent.id} has preview assets`);
    for (const route of routes) {
      assert.match(route, /^\/assets\/(?:agent-examples|templates)\//);
      assert.equal(fs.statSync(path.join(root, "core/app/public", route)).isFile(), true, `${agent.id}: ${route}`);
    }
  }
  const poster = registry.agents.find((agent) => agent.id === "poster-designer");
  const video = registry.agents.find((agent) => agent.id === "video-creator");
  assert.equal(poster.example.items.length, 5);
  assert.ok(fs.statSync(path.join(root, "core/app/public", video.example.src)).size > 10_000_000);
  assert.match(read("core/app/public/assets/agent-examples/travel-planning-fuzhou-v1/sources.md"), /historical-example/);
  assert.match(read("core/app/public/assets/agent-examples/monthly-finance-review-v1/README.md"), /不包含真实姓名/);
});

test("Agent team routes and profile presentation are independently implemented", () => {
  for (const relative of [
    "core/app/src/app/app/agents/page.tsx",
    "core/app/src/app/app/agents/[agentId]/page.tsx",
    "core/app/src/components/desktop-v627/agent-featured-output.tsx",
    "core/app/src/components/desktop-v627/agent-profile-elements.tsx",
    "core/app/src/app/agent-teams.css",
  ]) {
    assert.equal(fs.existsSync(path.join(root, relative)), true, relative);
  }
  assert.match(read("core/app/src/components/navigation.ts"), /label: "Agent 团队", href: "\/app\/agents"/);
  assert.match(read("core/app/src/app/app/agents/[agentId]/page.tsx"), /decodeURIComponent\(agentId\)/);
});

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}
