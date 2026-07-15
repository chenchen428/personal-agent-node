import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PrivatePublicationStore } from "../src/online-pages/private-publications.js";

test("private publications persist report files under authenticated routes", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-private-publications-"));
  const store = new PrivatePublicationStore({ rootDir, baseUrl: "https://agent.example.test" });
  const uploaded = store.upload({ publicationId: "june-report", fileName: "index.html", content: "<h1>六月账单</h1>" });
  assert.equal(uploaded.url, "https://agent.example.test/publications/june-report/index.html");
  assert.equal(fs.readFileSync(store.resolve("june-report", "index.html").filePath, "utf8"), "<h1>六月账单</h1>");
  assert.equal(store.list()[0].id, "june-report");
  assert.throws(() => store.resolve("june-report", "../secret"), /invalid/);
});
