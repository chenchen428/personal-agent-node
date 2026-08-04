#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { build } from "esbuild";

const skillRoot = path.resolve(import.meta.dirname, "..");
const productRoot = path.resolve(skillRoot, "../..");
const runtimeRoot = path.join(productRoot, "core", "agent", "public", "assets", "interior-workspace");
fs.mkdirSync(runtimeRoot, { recursive: true });

const workspace = await bundle({
  source: "viewer-entry.mjs",
  output: "workspace-viewer.bundle.js",
  manifest: "workspace-viewer-manifest.json",
  features: ["opening-aware-walls", "open-door-leaves-and-handles", "window-frames-and-glass", "semantic-furniture", "panorama-node-navigation", "pointer-lock-and-keyboard-walkthrough", "ceiling-zone-heights", "ceiling-toggle"],
});
const panorama = await bundle({
  source: "panorama-viewer-entry.mjs",
  output: "panorama-viewer.bundle.js",
  manifest: "panorama-viewer-manifest.json",
  features: ["equirectangular-sphere", "pointer-and-touch-look", "wheel-zoom", "reset", "fullscreen"],
});
const tourPreview = await bundle({
  source: "panorama-tour-preview-entry.mjs",
  output: "panorama-tour-preview.bundle.js",
  manifest: "panorama-tour-preview-manifest.json",
  features: ["multi-scene-equirectangular-sphere", "threshold-hotspots", "pre-turn", "continuous-arrival-heading", "pointer-and-touch-look", "wheel-zoom", "fullscreen"],
  stripTrailingWhitespace: true,
});

process.stdout.write(`${JSON.stringify({ ok: true, runtimes: [workspace, panorama, tourPreview] }, null, 2)}\n`);

async function bundle({ source, output, manifest, features, stripTrailingWhitespace = false }) {
  const entry = path.join(skillRoot, "scripts", source);
  const target = path.join(runtimeRoot, output);
  await build({ entryPoints: [entry], outfile: target, bundle: true, minify: true, format: "iife", platform: "browser", target: ["es2022"], legalComments: "none", sourcemap: false });
  if (stripTrailingWhitespace) {
    const normalized = fs.readFileSync(target, "utf8")
      .replace(/[ \t]+$/gm, "")
      .replace(/^ +(?=\t)/gm, "");
    fs.writeFileSync(target, normalized, "utf8");
  }
  const value = fs.readFileSync(target);
  const record = {
    schemaVersion: 5,
    source: `skills/interior-design/scripts/${source}`,
    output: `core/agent/public/assets/interior-workspace/${output}`,
    bytes: value.length,
    sha256: crypto.createHash("sha256").update(value).digest("hex"),
    features,
    dependencies: { three: "0.185.0", esbuild: "0.28.1" },
  };
  fs.writeFileSync(path.join(runtimeRoot, manifest), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
}
