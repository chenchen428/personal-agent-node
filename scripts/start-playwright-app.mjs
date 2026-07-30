import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const appRoot = path.join(root, "core", "app");
const standaloneApp = path.join(appRoot, ".next", "standalone", "core", "app");
const server = path.join(standaloneApp, "server.js");
if (!fs.existsSync(server)) throw new Error("Run npm run app:build before Playwright tests");

fs.cpSync(path.join(appRoot, ".next", "static"), path.join(standaloneApp, ".next", "static"), { recursive: true });
if (fs.existsSync(path.join(appRoot, "public"))) fs.cpSync(path.join(appRoot, "public"), path.join(standaloneApp, "public"), { recursive: true });
process.env.HOSTNAME = "127.0.0.1";
process.env.PORT = process.env.PLAYWRIGHT_PORT || "8892";
process.env.NODE_ENV = "production";
process.chdir(standaloneApp);
await import(pathToFileURL(server).href);
