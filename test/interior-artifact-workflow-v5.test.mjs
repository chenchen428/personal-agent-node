import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmArtifact,
  createArtifactWorkflow,
  markArtifactReady,
  modifyArtifact,
  validateArtifactWorkflow,
  workflowSummary,
} from "../skills/interior-design/scripts/artifact-workflow-v5.mjs";

function fixture() {
  return createArtifactWorkflow({
    projectId: "friend-case",
    geometry: { panoramaNodes: [{ id: "living", title: "客餐厅" }, { id: "master", title: "主卧" }] },
  });
}

test("V5 creates six editable drawings and one per-view panorama chain", () => {
  const state = fixture();
  assert.equal(validateArtifactWorkflow(state), true);
  assert.equal(Object.values(state.artifacts).filter((item) => item.kind === "drawing").length, 6);
  assert.deepEqual(state.artifacts["panorama-portal-map-living"].dependsOn, ["panorama-camera-living"]);
  assert.deepEqual(state.artifacts["panorama-control-living"].dependsOn, ["panorama-camera-living", "panorama-portal-map-living"]);
  assert.deepEqual(state.artifacts["panorama-imagegen-prompt-living"].dependsOn, ["panorama-control-living"]);
  assert.deepEqual(state.artifacts["panorama-imagegen-raw-living"].dependsOn, ["panorama-imagegen-prompt-living"]);
  assert.deepEqual(state.artifacts["panorama-photorealistic-living"].dependsOn, ["panorama-imagegen-raw-living", "panorama-control-living"]);
  assert.deepEqual(state.artifacts["panorama-imagegen-prompt-master"].dependsOn, ["panorama-control-master", "panorama-photorealistic-living"]);
  assert.deepEqual(state.artifacts["panorama-hotspots-living"].dependsOn, ["panorama-portal-map-living", "panorama-photorealistic-living"]);
  assert.deepEqual(state.artifacts["krpano-tour"].dependsOn, ["panorama-photorealistic-living", "panorama-photorealistic-master", "panorama-hotspots-living", "panorama-hotspots-master"]);
});

test("confirmation is gated by direct dependencies", () => {
  let state = fixture();
  state = markArtifactReady(state, "spatial-sketch-3d");
  assert.throws(() => confirmArtifact(state, "spatial-sketch-3d"), /unconfirmed dependencies/);
  for (const id of ["drawing-plan-layout", "drawing-ceiling-lighting", "drawing-switch-control", "drawing-socket-layout", "drawing-plumbing", "drawing-cabinet"]) {
    state = markArtifactReady(state, id);
    state = confirmArtifact(state, id, { summary: "业主确认" });
  }
  state = confirmArtifact(state, "spatial-sketch-3d", { summary: "空间关系确认" });
  assert.equal(state.artifacts["spatial-sketch-3d"].status, "confirmed");
});

test("modifying one view invalidates only its descendants", () => {
  let state = fixture();
  state.artifacts["panorama-camera-living"].status = "confirmed";
  state.artifacts["panorama-portal-map-living"].status = "confirmed";
  state.artifacts["panorama-control-living"].status = "confirmed";
  state.artifacts["panorama-imagegen-prompt-living"].status = "confirmed";
  state.artifacts["panorama-imagegen-raw-living"].status = "confirmed";
  state.artifacts["panorama-photorealistic-living"].status = "confirmed";
  state.artifacts["panorama-hotspots-living"].status = "confirmed";
  state.artifacts["panorama-camera-master"].status = "confirmed";
  state.artifacts["panorama-portal-map-master"].status = "confirmed";
  state.artifacts["panorama-control-master"].status = "confirmed";
  state.artifacts["panorama-imagegen-prompt-master"].status = "confirmed";
  state.artifacts["panorama-imagegen-raw-master"].status = "confirmed";
  state.artifacts["panorama-photorealistic-master"].status = "confirmed";
  state.artifacts["panorama-hotspots-master"].status = "confirmed";
  state.artifacts["krpano-tour"].status = "confirmed";

  state = modifyArtifact(state, "panorama-camera-living", { reason: "调整机位高度" });

  assert.equal(state.artifacts["panorama-camera-living"].status, "draft");
  assert.equal(state.artifacts["panorama-control-living"].status, "invalidated");
  assert.equal(state.artifacts["panorama-portal-map-living"].status, "invalidated");
  assert.equal(state.artifacts["panorama-imagegen-prompt-living"].status, "invalidated");
  assert.equal(state.artifacts["panorama-photorealistic-living"].status, "invalidated");
  assert.equal(state.artifacts["panorama-hotspots-living"].status, "invalidated");
  assert.equal(state.artifacts["krpano-tour"].status, "invalidated");
  assert.equal(state.artifacts["panorama-camera-master"].status, "confirmed");
  assert.equal(state.artifacts["panorama-control-master"].status, "confirmed");
  assert.equal(state.artifacts["panorama-imagegen-prompt-master"].status, "invalidated");
  assert.equal(state.artifacts["panorama-photorealistic-master"].status, "invalidated");
  assert.equal(state.artifacts["panorama-hotspots-master"].status, "invalidated");
  assert.ok(state.artifacts["krpano-tour"].invalidatedBy.includes("panorama-camera-living"));
});

test("workflow summary reports unfinished artifacts", () => {
  const summary = workflowSummary(fixture());
  assert.equal(summary.complete, false);
  assert.equal(summary.counts.draft, 24);
  assert.ok(summary.next.includes("owner-page-final"));
});
