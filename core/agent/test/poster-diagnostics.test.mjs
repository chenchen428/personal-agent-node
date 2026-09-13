import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { PosterService } from "../src/posters/service.js";
import { PrivatePublicationStore } from "../src/online-pages/private-publications.js";
import { PublicPagePosterStore } from "../src/posters/public-pages.js";
import { posterDiagnostic } from "../src/posters/diagnostics.js";
import { createPageThumbnailPng } from "./page-thumbnail-fixture.mjs";

const command = { action: "page-poster", input: { pageId: "private-demo", sourceObjectId: `obj_${"a".repeat(24)}` } };
const sensitive = "C:\\private\\customer\\publication.json secret-fixture-value";
const authorize = () => true;
const service = (overrides = {}) => new PosterService({ outputRoot: os.tmpdir(), spaceId: "space-a",
  privatePublications: { pageVersion: () => "a".repeat(64) }, externalAccess: { ready: true, origin: "https://space.example.com" },
  managedFiles: { stat: () => ({ status: "ready", contentType: "image/png", sizeBytes: 100, sha256: "b".repeat(64) }),
    materialize: async () => ({ verified: false }) }, ...overrides,
});

test("poster recovery only suggests executable CLI operations and verified Page references", () => {
  const sources = [
    fs.readFileSync(new URL("../src/posters/diagnostics.js", import.meta.url), "utf8"),
    fs.readFileSync(new URL("../../../skills/cove-runtime/references/page-publishing.md", import.meta.url), "utf8"),
  ];
  for (const source of sources) {
    assert.doesNotMatch(source, /pa-cli pages (?:list|show|inspect)|pa-cli file show/);
    const commands = [...source.matchAll(/pa-cli\s+(\w+)\s+(\w+)/g)].map((match) => `${match[1]} ${match[2]}`);
    assert.ok(commands.every((command) => ["pages publish", "pages poster", "file stat"].includes(command)));
  }
  for (const code of ["POSTER_PAGE_NOT_FOUND", "POSTER_PAGE_UNAVAILABLE"]) {
    assert.match(posterDiagnostic(code).recovery, /pages publish.*pageId.*当前会话/);
  }
});

test("poster failures retain actionable codes while redacting underlying exception text", async () => {
  for (const code of ["POSTER_PAGE_ENTRY_MISSING", "POSTER_PAGE_ENTRY_AMBIGUOUS", "POSTER_PAGE_ASSET_MISSING", "POSTER_PAGE_ASSET_INVALID", "POSTER_PAGE_VERSION_CONFLICT", "POSTER_PAGE_NOT_FOUND", "ENOENT"]) {
    const instance = service({ privatePublications: { pageVersion() { throw Object.assign(new Error(sensitive), { code }); } } });
    await assert.rejects(instance.page(command, authorize), (error) => {
      assert.equal(error.code, code === "ENOENT" ? "POSTER_PAGE_UNAVAILABLE" : code);
      assert.doesNotMatch(error.message, /customer|secret-fixture|publication\.json/);
      assert.ok(error.message.includes(posterDiagnostic(error.code).recovery));
      return true;
    });
  }
  await assert.rejects(service({ externalAccess: { ready: false } }).page(command, authorize), { code: "POSTER_LINK_UNAVAILABLE" });
  await assert.rejects(service({ managedFiles: { stat() { throw new Error(sensitive); } } }).page(command, authorize), { code: "POSTER_SOURCE_NOT_READY" });
  await assert.rejects(service({ managedFiles: { stat: () => ({ status: "pending" }) } }).page(command, authorize), { code: "POSTER_SOURCE_NOT_READY" });
  await assert.rejects(service().page(command, authorize), { code: "POSTER_SOURCE_CHANGED" });
  let revision = 0;
  await assert.rejects(service({ privatePublications: { pageVersion: () => String(++revision) } }).page(command, authorize), { code: "POSTER_PAGE_VERSION_CONFLICT" });
  await assert.rejects(service().page(command, () => { throw Object.assign(new Error("capability expired"), { code: "MAIN_AGENT_REQUIRED" }); }), { code: "MAIN_AGENT_REQUIRED" });
});

test("private and public Page integrity distinguish a missing asset from a missing page", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "poster-diagnostic-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const privateStore = new PrivatePublicationStore({ rootDir: path.join(root, "private") });
  privateStore.publish({ publicationId: "demo", fileName: "index.html", content: "<h1>Fixture</h1>", title: "Fixture",
    desktopThumbnail: { fileName: "desktop.png", content: createPageThumbnailPng().toString("base64") },
    mobileThumbnail: { fileName: "mobile.png", content: createPageThumbnailPng(750, 1200).toString("base64") } });
  fs.unlinkSync(path.join(root, "private", "demo", "desktop.png"));
  assert.throws(() => privateStore.pageVersion("demo"), { code: "POSTER_PAGE_ASSET_MISSING" });
  const manifestPath = path.join(root, "private", "demo", "publication.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  delete manifest.page.entryFile; manifest.files = manifest.files.filter((file) => !file.name.endsWith(".html"));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => privateStore.pageVersion("demo"), { code: "POSTER_PAGE_ENTRY_MISSING" });
  const directory = path.join(root, "public", "demo"); fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, ".page.json"), JSON.stringify({ pageId: "public-demo", entryFile: "index.html" }));
  const publicStore = new PublicPagePosterStore({ uploadsRoot: path.join(root, "public"), bindingRoot: path.join(root, "bindings") });
  assert.throws(() => publicStore.pageVersion("public-demo"), { code: "POSTER_PAGE_ASSET_MISSING" });
  assert.throws(() => publicStore.pageVersion("public-absent"), { code: "POSTER_PAGE_NOT_FOUND" });
});

test("pages poster JSON errors carry safe code and recovery with a failing exit status", async (t) => {
  let responseCode = "POSTER_PAGE_ENTRY_AMBIGUOUS";
  const server = http.createServer(async (request, response) => {
    for await (const _chunk of request) { /* drain */ }
    response.writeHead(409, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: false, code: responseCode, error: sensitive }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  for (const code of ["POSTER_PAGE_ENTRY_AMBIGUOUS", "POSTER_PAGE_ASSET_MISSING", "POSTER_SOURCE_NOT_READY", "POSTER_LINK_UNAVAILABLE"]) {
    responseCode = code;
    await assert.rejects(promisify(execFile)(process.execPath, [path.resolve(import.meta.dirname, "../bin/pa-cli.mjs"), "pages", "poster",
      "--id", "private-demo", "--source-object", command.input.sourceObjectId, "--capability", "fixture-ephemeral", "--json"], {
      env: { ...process.env, OPEN_AGENT_BRIDGE_API_BASE: `http://127.0.0.1:${server.address().port}` },
    }), (error) => {
      assert.equal(error.code, 1);
      const result = JSON.parse(error.stdout);
      assert.equal(result.ok, false); assert.equal(result.code, code);
      assert.equal(result.recovery, posterDiagnostic(code).recovery);
      assert.doesNotMatch(error.stdout + error.stderr, /customer|secret-fixture|fixture-ephemeral|publication\.json/);
      return true;
    });
  }
});
