#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { report, root } from "./harness-lib.mjs";

const checks = [];
const componentRoot = path.join(root, "core", "app", "src", "components");
const componentFiles = walk(componentRoot).filter((file) => file.endsWith(".tsx"));

for (const file of componentFiles) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).length;
  checks.push({
    name: `frontend component stays within 300 lines: ${relative}`,
    ok: lines <= 300,
    detail: `${lines} lines`,
  });
}

const menuPages = {
  "app/page.tsx": "overview-page",
  "app/conversations/page.tsx": "conversation-page",
  "app/workers/page.tsx": "workers-page",
  "app/mail/page.tsx": "mail-page",
  "app/pages/page.tsx": "pages-page",
  "app/data/page.tsx": "data-page",
  "app/automations/page.tsx": "automations-page",
  "app/channels/page.tsx": "channels-page",
  "app/skills/page.tsx": "skills-page",
  "app/setup/page.tsx": "setup-page",
  "app/runtime/page.tsx": "runtime-page",
  "app/apps/page.tsx": "apps-page",
  "app/settings/page.tsx": "settings-page",
};

for (const [route, moduleName] of Object.entries(menuPages)) {
  const file = path.join(root, "core", "app", "src", "app", route);
  const source = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  checks.push({
    name: `menu route owns a direct page component: /${route.replace(/\/page\.tsx$/, "")}`,
    ok: source.includes(`desktop-v627/${moduleName}`),
  });
}

const shell = read("core/app/src/components/app-shell.tsx");
const appCatalog = read("core/runtime/src/apps.ts");
const appGuide = read("docs/personal-app-development.md");
const frontendSkill = read("skills/frontend-design/SKILL.md");
const referenceApp = read("workspace/apps/personal-agent.daily-brief/dist/index.html");
const mobileShell = read("core/app/src/components/mobile-current/shell.tsx");
const mobilePersonalApp = read("core/app/src/components/mobile-current/personal-app.tsx");
checks.push({
  name: "desktop shell owns shared navigation",
  ok: shell.includes('from "@/components/navigation"'),
});
checks.push({
  name: "Personal Apps use the shared desktop host route",
  ok: fs.existsSync(path.join(root, "core/app/src/app/app/apps/[appId]/page.tsx"))
    && fs.existsSync(path.join(root, "core/app/src/components/personal-app-host.tsx")),
});
checks.push({
  name: "Personal Apps expose distinct desktop and mobile host routes",
  ok: appCatalog.includes("desktopRoute") && appCatalog.includes("mobileRoute")
    && fs.existsSync(path.join(root, "core/app/src/app/app/mobile/apps/[appId]/page.tsx")),
});
checks.push({
  name: "Personal App guide makes mobile-primary dual surfaces mandatory",
  ok: appGuide.includes("Mobile is the primary Personal App entry")
    && appGuide.includes("A mobile surface is not a narrow desktop page"),
});
checks.push({
  name: "frontend skill carries the Personal App dual-surface contract",
  ok: frontendSkill.includes("treat mobile as the primary surface")
    && frontendSkill.includes("media-query-compressed desktop page"),
});
checks.push({
  name: "reference Personal App owns separate desktop and mobile compositions",
  ok: referenceApp.includes('data-surface-view="desktop"')
    && referenceApp.includes('data-surface-view="mobile"'),
});
checks.push({
  name: "Personal App detail owns an exclusive active navigation item",
  ok: mobilePersonalApp.includes("activeAppId={appId}")
    && mobileShell.includes('section === "apps" && !activeAppId')
    && mobileShell.includes('activeAppId === app.id ? "page" : undefined')
    && shell.includes('pathname === "/app/apps" ? "page" : undefined'),
});

report(checks);

function read(relative) {
  const file = path.join(root, relative);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}
