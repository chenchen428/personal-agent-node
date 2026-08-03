import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { createArtifactWorkflow } from "../skills/interior-design/scripts/artifact-workflow-v5.mjs";
import { prepareImagegenPanoramaPrompt } from "../skills/interior-design/scripts/imagegen-panorama-prompt-v5.mjs";
import { registerPanoramaImage } from "../skills/interior-design/scripts/panorama-artifacts-v5.mjs";
import { finalizeImagegenPanorama } from "../skills/interior-design/scripts/finalize-imagegen-panorama-v5.mjs";

test("Imagegen panorama prompt binds the confirmed design, camera, and Blender control", async () => {
  const root = createProject();
  try {
    const result = prepareImagegenPanoramaPrompt({ projectDir: root, nodeId: "living" });
    assert.equal(result.artifact.status, "confirmed");
    assert.equal(result.artifact.confirmation.confirmedBy, "agent-prompt-compiler");
    assert.equal(result.prompt.execution.skill, "imagegen");
    assert.equal(result.prompt.execution.policy, "one-node-one-call-one-image");
    assert.deepEqual(result.prompt.execution.deliveryCanvas, { width: 4096, height: 2048 });
    assert.match(result.prompt.finalPrompt, /按已确认装修设计/);
    assert.match(result.prompt.finalPrompt, /2:1 equirectangular projection/);
    assert.match(result.prompt.finalPrompt, /Blender 空间结构控制底稿/);
    assert.equal(result.prompt.inputs.images[0].sha256, sha256(fs.readFileSync(path.join(root, "panoramas", "control", "living.png"))));

    const repeated = prepareImagegenPanoramaPrompt({ projectDir: root, nodeId: "living" });
    assert.equal(repeated.unchanged, true);
    assert.equal(repeated.prompt.promptId, result.prompt.promptId);

    const photo = path.join(root, "panoramas", "photorealistic", "living.png");
    fs.mkdirSync(path.dirname(photo), { recursive: true });
    await sharp({ create: { width: 2048, height: 1024, channels: 3, background: "#b8aa95" } }).png().toFile(photo);
    await assert.rejects(
      registerPanoramaImage({ projectDir: root, nodeId: "living", kind: "photorealistic", file: "panoramas/photorealistic/living.png", generator: "codex-imagegen" }),
      /require --prompt-id/,
    );
    const registered = await registerPanoramaImage({
      projectDir: root,
      nodeId: "living",
      kind: "photorealistic",
      file: "panoramas/photorealistic/living.png",
      generator: "codex-imagegen",
      promptId: result.prompt.promptId,
    });
    assert.equal(registered.record.promptArtifactId, "panorama-imagegen-prompt-living");
    assert.equal(registered.record.promptSha256, result.artifact.sha256);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Imagegen panorama finalization preserves 2:1 projection and records deterministic delivery upscaling", async () => {
  const root = createProject();
  try {
    const prompt = prepareImagegenPanoramaPrompt({ projectDir: root, nodeId: "living" });
    const raw = path.join(root, "panoramas", "imagegen-raw", "living.png");
    fs.mkdirSync(path.dirname(raw), { recursive: true });
    await sharp({ create: { width: 1600, height: 800, channels: 3, background: "#b8aa95" } }).png().toFile(raw);
    const result = await finalizeImagegenPanorama({
      projectDir: root,
      nodeId: "living",
      file: "panoramas/imagegen-raw/living.png",
      promptId: prompt.prompt.promptId,
    });
    assert.deepEqual(result.source.dimensions, { width: 1600, height: 800 });
    assert.deepEqual(result.delivery, { file: "panoramas/photorealistic/living-attempt-001.png", width: 4096, height: 2048 });
    assert.equal(result.artifact.status, "ready-for-review");
    assert.equal(result.record.normalization.type, "same-projection-resize-and-wrap-seam-stitch");
    assert.equal(result.record.normalization.contentGeneratedByPostprocess, false);
    assert.equal(result.record.orientationOffsetDeg, result.record.normalization.orientationOffsetDeg);
    assert.equal(result.record.normalization.additionalYawOffsetDeg, 0);
    assert.ok(result.record.normalization.seamStitch.bandWidth > 0);
    assert.equal(result.record.normalization.seamStitch.after.meanDelta, 0);
    const metadata = await sharp(path.join(root, result.delivery.file)).metadata();
    assert.deepEqual({ width: metadata.width, height: metadata.height }, { width: 4096, height: 2048 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function createProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "interior-imagegen-prompt-v5-"));
  const geometry = {
    projectId: "fixture",
    rooms: [{ id: "room-living", name: "客餐厅" }],
    panoramaNodes: [{ id: "living", title: "客餐厅", roomId: "room-living", position: [2000, 3000, 1550], lookAt: [5000, 3000, 1200] }],
  };
  const project = {
    projectId: "fixture",
    revision: 3,
    title: "朋友案例",
    design: {
      concept: { name: "暖雾木序", summary: "清晰动线与耐久收纳" },
      style: { name: "暖白与烟熏橡木", keywords: ["克制", "低眩光"], palette: ["#f1eee6", "#735c49"], lighting: "自然光与 3000K 分层照明" },
      materials: [{ id: "floor", name: "浅烟熏橡木地板", color: "#d8d0c4" }],
    },
  };
  const controlFile = path.join(root, "panoramas", "control", "living.png");
  fs.mkdirSync(path.dirname(controlFile), { recursive: true });
  fs.writeFileSync(controlFile, "control-image");
  const workflow = createArtifactWorkflow({ projectId: "fixture", geometry });
  workflow.artifacts["panorama-control-living"].status = "confirmed";
  workflow.artifacts["panorama-control-living"].file = "panoramas/control/living.png";
  workflow.artifacts["panorama-control-living"].sha256 = sha256(fs.readFileSync(controlFile));
  fs.writeFileSync(path.join(root, "project.json"), `${JSON.stringify(project, null, 2)}\n`);
  fs.writeFileSync(path.join(root, "geometry.json"), `${JSON.stringify(geometry, null, 2)}\n`);
  fs.writeFileSync(path.join(root, "artifact-workflow.json"), `${JSON.stringify(workflow, null, 2)}\n`);
  return root;
}

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
