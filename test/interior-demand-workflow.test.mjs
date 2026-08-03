import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("interior workflow is one co-design confirmation pipeline without compatibility modes", () => {
  const result = spawnSync(process.execPath, ["scripts/specialist-workflow.mjs", "accept", "--agent", "interior-designer"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.stageOrder, ["project-intake", "design-development", "drawing-review", "spatial-sketch-review", "panorama-production", "tour-review", "shareable-delivery", "delivered"]);
  assert.equal(report.standard.finalStage, "delivered");
  assert.equal(report.standard.confirmationCount, 7);
  assert.equal(report.interior.singlePipeline, true);
  assert.equal(report.interior.compatibilityModes, 0);
  assert.deepEqual(report.interior.shareableOutputs, ["Owner-Page", "Online-SVG", "Semantic-Web3D", "Krpano-Tour"]);
  assert.ok(report.standard.negativeGates.includes("stage-skip-rejected"));
  assert.ok(report.standard.negativeGates.includes("wrong-review-page-rejected"));
});
