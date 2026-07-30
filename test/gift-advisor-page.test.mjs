import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildGiftAdvisorTemplateExample,
} from "../skills/gift-advisor/scripts/build-page-example.mjs";
import {
  generateGiftAdvisorPage,
  validateGiftPlan,
  verifyGiftAdvisorPage,
} from "../skills/gift-advisor/scripts/generate-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const artifactRoot = path.join(root, "core/app/public/assets/agent-examples/gift-advisor-report-v1");
const examplePlanPath = path.join(root, "skills/gift-advisor/examples/example-plan.json");

test("the committed gift advisor example is a byte-stable governed Page artifact", () => {
  const result = buildGiftAdvisorTemplateExample({ check: true });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "check");
  const { manifest } = verifyGiftAdvisorPage(artifactRoot);
  assert.equal(manifest.templateId, "gift-advisor-report");
  assert.equal(manifest.templateVersion, 1);
  assert.equal(manifest.source.kind, "space-owned-gift-advisor-plan-v1");
  assert.equal(manifest.source.recommendationCount, 6);
  assert.equal(manifest.source.strategyCount, 3);
  assert.equal(manifest.source.visualAcceptance, "user");
  for (const [name, expected] of Object.entries(manifest.files)) {
    const bytes = fs.readFileSync(path.join(artifactRoot, name));
    assert.equal(bytes.length, expected.bytes, name);
    assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), expected.sha256, name);
  }
});

test("the gift Page exposes real products and local-only interaction code", () => {
  const html = fs.readFileSync(path.join(artifactRoot, "index.html"), "utf8");
  const cover = fs.readFileSync(path.join(artifactRoot, "cover.svg"), "utf8");
  assert.match(html, /data-template-id="gift-advisor-report"/);
  assert.match(html, /收礼者画像/);
  assert.match(html, /我们确切知道/);
  assert.match(html, /谨慎推断/);
  assert.match(html, /仍需确认/);
  assert.match(html, /不是心理诊断/);
  assert.match(html, /data-gift-filter="daily-ritual"/);
  assert.match(html, /data-sort/);
  assert.match(html, /data-detail-toggle/);
  assert.match(html, /data-shortlist/);
  assert.match(html, /data-copy-shortlist/);
  assert.match(html, /window\.print\(\)/);
  assert.match(html, /data-theme-light="切换日光模式"/);
  assert.match(html, /themeToggle\.setAttribute\("aria-label", label\)/);
  assert.match(html, /class="hero-subtitle" style="color:var\(--muted\)"/);
  assert.match(html, /@media\(max-width:620px\)/);
  assert.match(html, /@media print/);
  assert.match(html, /TIMEMORE 泰摩 Basic 2\.0 咖啡秤/);
  assert.match(html, /DJI Osmo Mobile 7P 手机云台/);
  assert.match(html, /LEGO Ideas 宝丽来 OneStep SX-70 相机/);
  assert.match(html, /US\$55/);
  assert.match(html, /¥599/);
  assert.match(html, /https:\/\/www\.timemore\.com\/products\/timemore-basic-2-0-electronic-espresso-scale-with-timer/);
  assert.match(html, /https:\/\/www\.lego\.com\/en-us\/product\/polaroid-onestep-sx-70-camera-21345/);
  assert.equal((html.match(/<img class="product-image"/g) || []).length, 6);
  assert.equal((html.match(/class="product-link"/g) || []).length, 6);
  assert.doesNotMatch(html, /(?:file:\/\/|localhost|127\.0\.0\.1|<iframe\b|<object\b|<embed\b|<form\b)/i);
  assert.doesNotMatch(html, /<(?:script|link)\b[^>]*(?:src|href)=["']https?:\/\//i);
  assert.match(cover, /data-cover-item="daily-ritual"/);
  assert.match(cover, /GIFT ADVISOR/);
});

test("gift plan validation enforces budget, diversity, and complete real-product evidence", () => {
  const input = JSON.parse(fs.readFileSync(examplePlanPath, "utf8"));
  const validated = validateGiftPlan(input);
  assert.equal(validated.recommendations.length, 6);
  assert.equal(new Set(validated.recommendations.map((item) => item.productFamily)).size, 6);
  assert.equal(validated.recommendations.filter((item) => item.product.image.url).length, 6);
  assert.equal(validated.sources.length, 6);
  assert.ok(validated.portrait.unknowns.length > 0);

  const overBudget = structuredClone(input);
  overBudget.recommendations[0].price.max = 801;
  assert.throws(() => validateGiftPlan(overBudget), /must stay inside/);

  const duplicateFamily = structuredClone(input);
  duplicateFamily.recommendations[1].productFamily = duplicateFamily.recommendations[0].productFamily;
  assert.throws(() => validateGiftPlan(duplicateFamily), /duplicate product family/);

  const missingProduct = structuredClone(input);
  delete missingProduct.recommendations[0].product;
  assert.throws(() => validateGiftPlan(missingProduct), /must be an object/);

  const localLink = structuredClone(input);
  localLink.recommendations[0].product.url = "https://127.0.0.1/item";
  localLink.recommendations[0].product.image.sourceUrl = "https://127.0.0.1/item";
  assert.throws(() => validateGiftPlan(localLink), /public HTTPS URL/);

  const placeholderImage = structuredClone(input);
  placeholderImage.recommendations[0].product.image.url = "https://example.com/product.png";
  assert.throws(() => validateGiftPlan(placeholderImage), /placeholder host/);

  const sourceMismatch = structuredClone(input);
  sourceMismatch.sources[0].checkedAt = "2026-07-27";
  assert.throws(() => validateGiftPlan(sourceMismatch), /matching source/);
});

test("gift generator confines output to the project derived directory and produces Page provenance", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gift-advisor-test-"));
  try {
    const projectDir = path.join(temporaryRoot, "project");
    const output = path.join(projectDir, "derived", "page");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.copyFileSync(examplePlanPath, path.join(projectDir, "gift-plan.json"));
    const result = generateGiftAdvisorPage({ projectDir, output });
    assert.equal(result.ok, true);
    assert.equal(result.template.visualAcceptance, "user");
    const verified = verifyGiftAdvisorPage(output);
    assert.equal(verified.manifest.templateId, "gift-advisor-report");
    assert.equal(verified.manifest.templateVersion, 1);
    assert.equal(verified.manifest.files["index.html"].sha256, result.artifactSha256);
    assert.throws(
      () => generateGiftAdvisorPage({
        projectDir,
        output: path.join(temporaryRoot, "outside"),
      }),
      /must stay inside/,
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
