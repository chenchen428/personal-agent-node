import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { createArtifactWorkflow } from "../skills/interior-design/scripts/artifact-workflow-v5.mjs";
import { registerPanoramaImage } from "../skills/interior-design/scripts/panorama-artifacts-v5.mjs";
import { inspectPanoramaQuality, normalizePanoramaSeam, stitchPanoramaWrapSeam } from "../skills/interior-design/scripts/panorama-quality-v5.mjs";

test("panorama registration enforces 2:1 high-resolution images and one-record ledger entries", async () => {
  const root = createProject();
  try {
    const good = path.join(root, "panoramas", "living-base.png");
    const bad = path.join(root, "panoramas", "living-bad.png");
    fs.mkdirSync(path.dirname(good), { recursive: true });
    await sharp({ create: { width: 2048, height: 1024, channels: 3, background: "#c9b79c" } }).png().toFile(good);
    await sharp({ create: { width: 2048, height: 1200, channels: 3, background: "#c9b79c" } }).png().toFile(bad);
    await assert.rejects(registerPanoramaImage({ projectDir: root, nodeId: "living", kind: "control", file: "panoramas/living-bad.png", generator: "blender" }), /2:1/);
    const result = await registerPanoramaImage({ projectDir: root, nodeId: "living", kind: "control", file: "panoramas/living-base.png", generator: "blender" });
    assert.equal(result.artifact.status, "ready-for-review");
    assert.deepEqual(result.dimensions, { format: "png", width: 2048, height: 1024 });
    const ledger = JSON.parse(fs.readFileSync(path.join(root, "panorama-production.json"), "utf8"));
    assert.equal(ledger.records.length, 1);
    assert.equal(ledger.records[0].nodeId, "living");
    assert.equal(ledger.records[0].quality.seam.status, "passed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("panorama seam normalization moves a continuous boundary to the 360 wrap edge", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "interior-panorama-seam-v5-"));
  try {
    const source = path.join(root, "gradient.png");
    const output = path.join(root, "normalized.png");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="1024"><defs><linearGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><rect width="2048" height="1024" fill="url(#g)"/></svg>`;
    await sharp(Buffer.from(svg)).png().toFile(source);
    const before = await inspectPanoramaQuality(source);
    assert.equal(before.seam.status, "failed");
    const normalized = await normalizePanoramaSeam({ source, output });
    const after = await inspectPanoramaQuality(output);
    assert.equal(after.seam.status, "passed");
    assert.ok(Math.abs(normalized.orientationOffsetDeg) > 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("photorealistic seam stitching changes only the original wrap boundary", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "interior-panorama-wrap-v5-"));
  try {
    const source = path.join(root, "gradient.png");
    const output = path.join(root, "stitched.png");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="1024"><defs><linearGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><rect width="2048" height="1024" fill="url(#g)"/></svg>`;
    await sharp(Buffer.from(svg)).png().toFile(source);
    const middleBefore = await sharp(source).removeAlpha().extract({ left: 1024, top: 512, width: 1, height: 1 }).raw().toBuffer();
    const stitched = await stitchPanoramaWrapSeam({ source, output, bandWidth: 64 });
    const middleAfter = await sharp(output).extract({ left: 1024, top: 512, width: 1, height: 1 }).raw().toBuffer();
    const quality = await inspectPanoramaQuality(output);
    assert.equal(stitched.bandWidth, 64);
    assert.equal(quality.seam.status, "passed");
    assert.deepEqual(middleAfter, middleBefore);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function createProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "interior-panorama-v5-"));
  const geometry = { projectId: "fixture", panoramaNodes: [{ id: "living", title: "客厅" }] };
  fs.writeFileSync(path.join(root, "geometry.json"), `${JSON.stringify(geometry)}\n`);
  fs.writeFileSync(path.join(root, "artifact-workflow.json"), `${JSON.stringify(createArtifactWorkflow({ projectId: "fixture", geometry }), null, 2)}\n`);
  return root;
}
