import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { isMobileRequest } from "../core/app/src/lib/request-device.ts";

const headers = (values) => ({ get: (name) => values[name.toLowerCase()] ?? null });

test("request surface prefers client hints and classifies common mobile devices before render", () => {
  assert.equal(isMobileRequest(headers({ "sec-ch-ua-mobile": "?1", "user-agent": "Windows NT" })), true);
  assert.equal(isMobileRequest(headers({ "sec-ch-ua-mobile": "?0", "user-agent": "iPhone" })), true);
  assert.equal(isMobileRequest(headers({ "user-agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile" })), true);
  assert.equal(isMobileRequest(headers({ "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" })), false);
  assert.equal(isMobileRequest(headers({})), false);
});

test("mobile routes use direct modules and a persistent parent shell", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const appShell = fs.readFileSync(path.join(root, "core/app/src/components/app-shell.tsx"), "utf8");
  const mobileShell = fs.readFileSync(path.join(root, "core/app/src/components/mobile-current/shell.tsx"), "utf8");
  assert.match(appShell, /<MobileAppShell>\{children\}<\/MobileAppShell>/);
  assert.match(mobileShell, /MobileShellContext\.Provider/);
  assert.match(mobileShell, /return <main className=\{`mobile-screen/);
  for (const file of fs.readdirSync(path.join(root, "core/app/src/app/app/mobile"), { recursive: true }).filter((name) => String(name).endsWith("page.tsx"))) {
    const source = fs.readFileSync(path.join(root, "core/app/src/app/app/mobile", file), "utf8");
    assert.doesNotMatch(source, /window\.location|location\.href|<a href="\/app\/mobile/);
  }
});
