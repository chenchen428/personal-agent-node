import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("desktop navigation and routes expose Agent Teams after connections", () => {
  const navigation = read("core/app/src/components/navigation.ts");
  const shell = read("core/app/src/components/app-shell.tsx");
  const breadcrumb = read("core/app/src/components/desktop-header-breadcrumb.tsx");
  assert.ok(navigation.indexOf('href: "/app/connections"') < navigation.indexOf('href: "/app/agents"'));
  assert.match(navigation, /label: "Agent 团队"/);
  assert.match(shell, /desktopNavigation\.find/);
  assert.match(breadcrumb, /drilldown\("Agent 团队", "\/app\/agents"/);
  assert.equal(fs.existsSync(path.join(root, "core/app/src/app/app/agents/page.tsx")), true);
  assert.equal(fs.existsSync(path.join(root, "core/app/src/app/app/agents/[agentId]/page.tsx")), true);
});

test("Agent Teams UI reads current runtime data and covers all directory states", () => {
  const directory = read("core/app/src/components/agents/agents-page.tsx");
  const profile = read("core/app/src/components/agents/agent-profile-page.tsx");
  const loadState = read("core/app/src/components/agents/agents-load-state.tsx");
  const status = read("core/app/src/components/agents/types.ts");
  assert.match(directory, /useJson<.*>\("\/api\/agents"\)/);
  assert.match(directory, /LoadingState/);
  assert.match(directory, /AgentsLoadState/);
  assert.match(directory, /agent\.status === "available"/);
  assert.match(profile, /\/api\/agents\/\$\{encodeURIComponent\(agentId\)\}/);
  assert.match(loadState, /permission/);
  assert.match(loadState, /offline/);
  assert.match(loadState, /empty/);
  assert.match(status, /"available" \| "updating" \| "unavailable"/);
});

test("each profile presents the public professional contract without internal instructions", () => {
  const profile = read("core/app/src/components/agents/agent-profile-page.tsx");
  const overview = read("core/app/src/components/agents/agent-profile-overview.tsx");
  const delivery = read("core/app/src/components/agents/agent-delivery-system.tsx");
  const featured = read("core/app/src/components/agents/agent-featured-output.tsx");
  assert.match(profile, /代表产物/);
  assert.match(profile, /能力与使用边界/);
  assert.match(profile, /工作方法与交付/);
  assert.match(overview, /requiredInputs/);
  assert.match(overview, /limitations/);
  assert.match(delivery, /profile\.workflow/);
  assert.match(delivery, /profile\.deliverables/);
  assert.match(delivery, /profile\.acceptance/);
  assert.match(featured, /sandbox="allow-scripts allow-same-origin"/);
  assert.doesNotMatch(`${profile}\n${overview}\n${delivery}`, /AGENT\.md|instructions/);
});

test("Pages is a result library with no template product entry", () => {
  const pages = read("core/app/src/components/desktop-v627/pages-page.tsx");
  const breadcrumb = read("core/app/src/components/desktop-header-breadcrumb.tsx");
  assert.doesNotMatch(pages, /查看模板|pages-template-action|LayoutTemplate/);
  assert.doesNotMatch(breadcrumb, /pages\/templates|findPageTemplate|模板详情/);
});
