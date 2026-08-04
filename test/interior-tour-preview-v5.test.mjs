import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createArtifactWorkflow } from "../skills/interior-design/scripts/artifact-workflow-v5.mjs";
import { renderPanoramaTourPreview } from "../skills/interior-design/scripts/render-panorama-tour-preview.mjs";

test("tour preview stays separate from the final krpano artifact", () => withProject((root) => {
  assert.throws(() => renderPanoramaTourPreview({ projectDir: root, runtimeFile: path.join(root, "viewer.js") }), /not-confirmed/);
  const workflowFile = path.join(root, "artifact-workflow.json");
  const workflow = JSON.parse(fs.readFileSync(workflowFile, "utf8"));
  fs.mkdirSync(path.join(root, "panoramas"), { recursive: true });
  for (const id of ["living", "primary"]) {
    const file = `panoramas/${id}.jpg`;
    fs.writeFileSync(path.join(root, file), `image-${id}`);
    workflow.artifacts[`panorama-photorealistic-${id}`].status = "confirmed";
    workflow.artifacts[`panorama-photorealistic-${id}`].file = file;
  }
  fs.writeFileSync(workflowFile, `${JSON.stringify(workflow, null, 2)}\n`);
  const result = renderPanoramaTourPreview({ projectDir: root, runtimeFile: path.join(root, "viewer.js") });
  assert.equal(result.scenes, 2);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "pages", "tour-preview", "tour.json"), "utf8"));
  assert.equal(manifest.role, "acceptance-preview-not-final-runtime");
  assert.equal(manifest.finalDeliveryEngine, "krpano");
  assert.equal(manifest.scenes[0].hotspots[0].anchorType, "door-threshold");
  assert.equal(JSON.parse(fs.readFileSync(workflowFile, "utf8")).artifacts["krpano-tour"].status, "draft");
}));

function withProject(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "interior-tour-preview-v5-"));
  const geometry = {
    rooms: [
      { id: "room-living", polygon: [[0, 0], [5000, 0], [5000, 4000], [0, 4000]] },
      { id: "room-primary", polygon: [[5000, 0], [9000, 0], [9000, 4000], [5000, 4000]] },
    ],
    walls: [{ id: "wall-between", start: [5000, 0], end: [5000, 4000], thickness: 120, height: 2800 }],
    openings: [{ id: "door-between", type: "door", wallId: "wall-between", offset: 1500, width: 1000, height: 2200, sill: 0 }],
    portals: [{ id: "portal-between", openingId: "door-between", roomIds: ["room-living", "room-primary"], traversable: true, state: "open" }],
    panoramaNodes: [
      { id: "living", title: "客餐厅", roomId: "room-living", position: [3000, 2000, 1550], lookAt: [5000, 2000, 1200], hotspots: [{ id: "to-primary", kind: "portal", target: "primary", portalId: "portal-between", label: "主卧" }] },
      { id: "primary", title: "主卧", roomId: "room-primary", position: [7000, 2000, 1550], lookAt: [5000, 2000, 1200], hotspots: [{ id: "to-living", kind: "portal", target: "living", portalId: "portal-between", label: "客餐厅" }] },
    ],
  };
  fs.writeFileSync(path.join(root, "geometry.json"), `${JSON.stringify(geometry)}\n`);
  fs.writeFileSync(path.join(root, "project.json"), `${JSON.stringify({ projectId: "fixture", title: "案例" })}\n`);
  fs.writeFileSync(path.join(root, "artifact-workflow.json"), `${JSON.stringify(createArtifactWorkflow({ projectId: "fixture", geometry }), null, 2)}\n`);
  fs.writeFileSync(path.join(root, "viewer.js"), "preview runtime fixture");
  try { return run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
