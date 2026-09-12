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
  "app/connections/page.tsx": "connections-page",
  "app/skills/page.tsx": "skills-page",
  "app/statistics/token-usage/page.tsx": "token-usage-page",
  "app/setup/page.tsx": "setup-page",
  "app/runtime/page.tsx": "runtime-page",
  "app/calendar/page.tsx": "calendar-page",
  "app/settings/page.tsx": "settings-page",
  "app/update/page.tsx": "update-page",
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
checks.push({ name: "desktop shell owns shared navigation", ok: shell.includes('from "@/components/navigation"') });
for (const retired of ["core/app/src/app/app/agents", "core/app/src/app/app/apps", "core/app/src/app/app/mobile/apps", "core/app/src/components/agents", "core/app/src/components/personal-app-host.tsx", "core/runtime/src/apps.ts", "core/apps"]) {
 checks.push({ name: "retired feature source absent: " + retired, ok: !fs.existsSync(path.join(root, retired)) });
}

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
