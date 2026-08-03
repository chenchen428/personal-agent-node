import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createArtifactWorkflow } from "../skills/interior-design/scripts/artifact-workflow-v5.mjs";
import { assembleKrpanoTour } from "../skills/interior-design/scripts/render-krpano-tour.mjs";

test("krpano assembly refuses unconfirmed panorama images", () => withProject((root) => {
  const runtime = path.join(root, "krpano.js");
  fs.writeFileSync(runtime, "licensed runtime fixture");
  assert.throws(() => assembleKrpanoTour({ projectDir: root, runtimeFile: runtime }), /not-confirmed/);
}));

test("krpano assembly creates scenes only after every panorama is confirmed", () => withProject((root) => {
  const workflowFile = path.join(root, "artifact-workflow.json");
  const workflow = JSON.parse(fs.readFileSync(workflowFile, "utf8"));
  for (const id of ["living", "primary"]) {
    const file = `panoramas/${id}.jpg`;
    fs.mkdirSync(path.join(root, "panoramas"), { recursive: true });
    fs.writeFileSync(path.join(root, file), `image-${id}`);
    workflow.artifacts[`panorama-photorealistic-${id}`].status = "confirmed";
    workflow.artifacts[`panorama-photorealistic-${id}`].file = file;
    workflow.artifacts[`panorama-hotspots-${id}`].status = "confirmed";
  }
  fs.writeFileSync(workflowFile, `${JSON.stringify(workflow, null, 2)}\n`);
  fs.writeFileSync(path.join(root, "panorama-production.json"), `${JSON.stringify({ records: [
    { nodeId: "living", kind: "photorealistic", orientationOffsetDeg: 15 },
    { nodeId: "primary", kind: "photorealistic", orientationOffsetDeg: 0 },
  ] }, null, 2)}\n`);
  const runtime = path.join(root, "krpano.js");
  fs.writeFileSync(runtime, "licensed runtime fixture");
  const result = assembleKrpanoTour({ projectDir: root, runtimeFile: runtime });
  assert.equal(result.scenes, 2);
  const xml = fs.readFileSync(path.join(root, "pages", "tour", "tour.xml"), "utf8");
  const html = fs.readFileSync(path.join(root, "pages", "tour", "index.html"), "utf8");
  assert.match(xml, /scene_living/);
  assert.match(xml, /loadscene\(scene_primary/);
  assert.match(xml, /if\(startscene === null/);
  assert.match(xml, /loadscene\(get\(startscene\)\)/);
  assert.match(xml, /ath="15"/);
  assert.match(html, /localfallback:"none"/);
  assert.equal(JSON.parse(fs.readFileSync(workflowFile, "utf8")).artifacts["krpano-tour"].status, "ready-for-review");
}));

function withProject(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "interior-krpano-v5-"));
  const geometry = {
    panoramaNodes: [
      { id: "living", title: "客餐厅", hotspots: [{ target: "primary", yaw: 30, pitch: 0 }] },
      { id: "primary", title: "主卧", hotspots: [{ target: "living", yaw: -40, pitch: 0 }] },
    ],
  };
  fs.writeFileSync(path.join(root, "geometry.json"), `${JSON.stringify(geometry)}\n`);
  fs.writeFileSync(path.join(root, "project.json"), `${JSON.stringify({ projectId: "fixture", title: "案例" })}\n`);
  fs.writeFileSync(path.join(root, "artifact-workflow.json"), `${JSON.stringify(createArtifactWorkflow({ projectId: "fixture", geometry }), null, 2)}\n`);
  try { return run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
