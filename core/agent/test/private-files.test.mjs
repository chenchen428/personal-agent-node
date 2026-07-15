import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildInboundAttachmentDisplayName,
  buildPrivateAttachmentPreviewUrl,
  decodePrivateAttachmentPath,
  privateFilePreviewKind,
} from "../src/private-files/attachments.js";
import { ManagedFileCatalog } from "../src/managed-files/catalog.js";
import { configurePrivateManagedFiles, uploadPrivateAttachment } from "../src/private-files/local-store.js";
import { BridgeStore } from "../src/store/store.js";

const workspaceRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

test("builds readable attachment names and authenticated preview URLs", () => {
  const usedNames = new Set();
  assert.equal(buildInboundAttachmentDisplayName({
    kind: "image",
    fileName: "wechat-image.jpg",
    createdAt: "2026-07-10T15:06:07.000Z",
    usedNames,
  }), "微信图片-20260710-150607.jpg");
  assert.equal(buildInboundAttachmentDisplayName({
    kind: "image",
    fileName: "wechat-image.jpg",
    createdAt: "2026-07-10T15:06:07.000Z",
    usedNames,
  }), "微信图片-20260710-150607-2.jpg");
  assert.equal(buildInboundAttachmentDisplayName({
    kind: "file",
    fileName: "家庭清单.xlsx",
    createdAt: "2026-07-10T15:06:07.000Z",
    usedNames,
  }), "家庭清单.xlsx");

  const rootDir = "/private/files";
  assert.equal(buildPrivateAttachmentPreviewUrl({
    rootDir,
    filePath: "/private/files/wechat/user-a/2026-07-10/家庭清单.xlsx",
    consoleBaseUrl: "https://agent.example.test/",
  }), "https://agent.example.test/files/view/wechat/user-a/2026-07-10/%E5%AE%B6%E5%BA%AD%E6%B8%85%E5%8D%95.xlsx");
  assert.equal(buildPrivateAttachmentPreviewUrl({ rootDir, filePath: "/private/other/file", consoleBaseUrl: "https://agent.example.test" }), "");
  assert.throws(() => decodePrivateAttachmentPath("wechat/%2E%2E/secret"), /invalid private file path/);
  assert.equal(privateFilePreviewKind("text/html"), "text");
  assert.equal(privateFilePreviewKind("image/svg+xml"), "download");
});

test("private preview is authenticated, range-aware, and covered by the Nginx gateway", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "oab-private-files-"));
  const filesDir = path.join(directory, "files");
  const relativePath = "wechat/user-test/2026-07-10/2026-07-10T15-06-07-000Z-a1b2c3d4-家庭清单.txt";
  const filePath = path.join(filesDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "private-content");
  const dataDir = path.join(directory, "data");
  const seedStore = new BridgeStore({ dataDir, consoleBaseUrl: "http://127.0.0.1" });
  const seedSession = seedStore.getOrCreateMainSessionForChannel({ channel: "wechat", senderId: "user-test", workspaceRoot: directory });
  const batch = seedStore.createPrivateFileBatch({
    sessionId: seedSession.id,
    createdAt: "2026-07-10T15:06:07.000Z",
    attachments: [{ referenceName: "文件1", displayName: "家庭清单.txt", kind: "file", relativePath, size: 15 }],
  });
  seedStore.close();
  const port = await availablePort();
  let output = "";
  const child = spawn(process.execPath, [path.join(workspaceRoot, "node_modules", "tsx", "dist", "cli.mjs"), "src/server/server.ts"], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    env: {
      ...process.env,
      NODE_ENV: "test",
      OPEN_AGENT_BRIDGE_HOST: "127.0.0.1",
      OPEN_AGENT_BRIDGE_PORT: String(port),
      OPEN_AGENT_BRIDGE_DATA_DIR: dataDir,
      OPEN_AGENT_BRIDGE_WORKSPACE_ROOT: directory,
      WECHAT_INBOUND_ATTACHMENTS_DIR: filesDir,
      OPEN_AGENT_BRIDGE_CHANNEL_POLL: "0",
      OPEN_AGENT_BRIDGE_SCHEDULER: "0",
      OPEN_AGENT_BRIDGE_API_TOKEN: "private-file-test-token",
      PERSONAL_AGENT_AUTH_PASSWORD: "private-file-test-password",
      PERSONAL_AGENT_AUTH_COOKIE_SECRET: "private-file-test-cookie-secret",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await waitForServer(port, child, () => output);

  const encoded = relativePath.split("/").map(encodeURIComponent).join("/");
  const baseUrl = `http://127.0.0.1:${port}`;
  const unauthenticated = await fetch(`${baseUrl}/private-files/view/${encoded}`, { redirect: "manual" });
  assert.equal(unauthenticated.status, 302);
  assert.match(unauthenticated.headers.get("location") || "", /^\/login\?return_to=/);

  const headers = { "x-personal-agent-authenticated": "1" };
  const preview = await fetch(`${baseUrl}/private-files/view/${encoded}`, { headers });
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get("cache-control"), "private, no-store");
  assert.match(await preview.text(), /家庭清单\.txt/);

  const raw = await fetch(`${baseUrl}/private-files/raw/${encoded}`, { headers: { ...headers, range: "bytes=0-6" } });
  assert.equal(raw.status, 206);
  assert.equal(raw.headers.get("content-range"), "bytes 0-6/15");
  assert.equal(await raw.text(), "private");

  const batchUnauthenticated = await fetch(`${baseUrl}/private-files/batches/${batch.id}`, { redirect: "manual" });
  assert.equal(batchUnauthenticated.status, 302);
  const batchPreview = await fetch(`${baseUrl}/private-files/batches/${batch.id}`, { headers });
  assert.equal(batchPreview.status, 200);
  assert.equal(batchPreview.headers.get("cache-control"), "private, no-store");
  const batchHtml = await batchPreview.text();
  assert.match(batchHtml, /文件1/);
  assert.match(batchHtml, /家庭清单\.txt/);

  const distribution = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "registry", "site-distribution.json"), "utf8"));
  const route = distribution.routing.paths.find((entry) => entry.prefix === "/app/files");
  assert.equal(route.access, "authenticated");
  assert.equal(route.upstreamPath, "/private-files");
});

test("local cleanup delegates to catalog GC instead of deleting by mtime", () => {
  const service = fs.readFileSync(path.join(workspaceRoot, "core", "agent", "src", "managed-files", "service.js"), "utf8");
  const server = fs.readFileSync(path.join(workspaceRoot, "core", "agent", "src", "server", "server.ts"), "utf8");
  assert.match(service, /async gc\(\{ execute = false/);
  assert.match(server, /managedFiles\.gc\(\{ execute: body\.execute === true \}\)/);
  assert.equal(fs.existsSync(path.join(workspaceRoot, "infra", "private-files", "cleanup-local-private-files.sh")), false);
});

test("private attachments remain searchable as ready local copies", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "oab-private-pending-"));
  const filePath = path.join(directory, "inbound.txt");
  fs.writeFileSync(filePath, "available to the agent");
  const catalog = new ManagedFileCatalog({ dataDir: directory });
  const previousRoot = process.env.WECHAT_INBOUND_ATTACHMENTS_DIR;
  try {
    process.env.WECHAT_INBOUND_ATTACHMENTS_DIR = directory;
    configurePrivateManagedFiles({ catalog });

    const result = await uploadPrivateAttachment({
      filePath,
      relativePath: "wechat/user-test/inbound.txt",
      contentType: "text/plain",
    });

    assert.equal(result.uploaded, true);
    const stored = catalog.get(result.objectId);
    assert.equal(stored.status, "ready");
    assert.equal(stored.localCopies[0].tier, "hot");
    assert.equal(stored.localCopies[0].localPath, path.join(directory, "wechat", "user-test", "inbound.txt"));
  } finally {
    configurePrivateManagedFiles({ catalog: null });
    if (previousRoot === undefined) delete process.env.WECHAT_INBOUND_ATTACHMENTS_DIR;
    else process.env.WECHAT_INBOUND_ATTACHMENTS_DIR = previousRoot;
    catalog.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

async function availablePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(port, child, getOutput) {
  // The full workspace suite starts several Node subprocesses concurrently on CI.
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`private file server exited early: ${getOutput()}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      // Retry during startup.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`private file server did not start: ${getOutput()}`);
}
