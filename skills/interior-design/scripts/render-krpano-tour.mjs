import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { markArtifactReady, validateArtifactWorkflow } from "./artifact-workflow-v5.mjs";

export function assembleKrpanoTour({ projectDir, runtimeFile, output }) {
  const root = path.resolve(projectDir);
  const target = path.resolve(output ?? path.join(root, "pages", "tour"));
  if (!inside(root, target)) throw new Error("krpano tour output must stay inside the project workspace");
  const workflow = readJson(path.join(root, "artifact-workflow.json"));
  const geometry = readJson(path.join(root, "geometry.json"));
  const project = readJson(path.join(root, "project.json"));
  const productionFile = path.join(root, "panorama-production.json");
  const production = fs.existsSync(productionFile) ? readJson(productionFile) : { records: [] };
  validateArtifactWorkflow(workflow);

  const nodes = geometry.panoramaNodes ?? [];
  if (nodes.length === 0) throw new Error("geometry.panoramaNodes must contain at least one confirmed view");
  const missing = nodes.flatMap((node) => {
    const artifact = workflow.artifacts[`panorama-photorealistic-${node.id}`];
    const hotspots = workflow.artifacts[`panorama-hotspots-${node.id}`];
    const issues = [];
    if (!artifact || artifact.status !== "confirmed") issues.push(`${node.id}:image-not-confirmed`);
    else if (!artifact.file || !fs.existsSync(path.join(root, artifact.file))) issues.push(`${node.id}:file-missing`);
    if (!hotspots || hotspots.status !== "confirmed") issues.push(`${node.id}:hotspots-not-confirmed`);
    return issues;
  });
  if (missing.length) throw new Error(`krpano assembly is gated by confirmed Imagegen photorealistic panoramas: ${missing.join(", ")}`);

  const runtime = path.resolve(runtimeFile ?? "");
  if (!runtimeFile || !fs.existsSync(runtime) || path.basename(runtime).toLowerCase() !== "krpano.js") {
    throw new Error("a valid licensed krpano.js runtime is required; pass --runtime <path-to-krpano.js>");
  }

  fs.mkdirSync(path.join(target, "panoramas"), { recursive: true });
  fs.copyFileSync(runtime, path.join(target, "krpano.js"));
  for (const node of nodes) {
    const source = path.join(root, workflow.artifacts[`panorama-photorealistic-${node.id}`].file);
    fs.copyFileSync(source, path.join(target, "panoramas", `${node.id}${path.extname(source).toLowerCase()}`));
  }
  const orientationOffsets = Object.fromEntries(nodes.map((node) => {
    const record = [...production.records].reverse().find((entry) => entry.nodeId === node.id && entry.kind === "photorealistic");
    return [node.id, Number(record?.orientationOffsetDeg ?? 0)];
  }));
  fs.writeFileSync(path.join(target, "tour.xml"), renderTourXml(nodes, workflow, orientationOffsets), "utf8");
  fs.writeFileSync(path.join(target, "index.html"), renderTourHtml(project), "utf8");
  writeJson(path.join(target, "tour.json"), {
    contract: "personal-agent/interior-krpano-tour/v5",
    projectId: project.projectId,
    scenes: nodes.map((node) => ({ id: node.id, title: node.title, sourceArtifact: `panorama-photorealistic-${node.id}`, orientationOffsetDeg: orientationOffsets[node.id], hotspots: node.hotspots ?? [] })),
    visualAcceptance: "user",
  });
  const entry = path.join(target, "index.html");
  const ready = markArtifactReady(workflow, "krpano-tour", {
    file: slash(path.relative(root, entry)),
    sha256: crypto.createHash("sha256").update(fs.readFileSync(entry)).digest("hex"),
  });
  writeJson(path.join(root, "artifact-workflow.json"), ready);
  return { ok: true, output: target, entry: "index.html", scenes: nodes.length };
}

function renderTourXml(nodes, workflow, orientationOffsets) {
  const scenes = nodes.map((node, index) => {
    const artifact = workflow.artifacts[`panorama-photorealistic-${node.id}`];
    const extension = path.extname(artifact.file).toLowerCase();
    const offset = Number(orientationOffsets[node.id] ?? 0);
    const hotspots = (node.hotspots ?? []).map((hotspot, hotspotIndex) => `<hotspot name="hs_${node.id}_${hotspotIndex}" ath="${yaw(Number(hotspot.yaw ?? 0) - offset)}" atv="${Number(hotspot.pitch ?? 0)}" style="navspot" tooltip="${xml(nodes.find((entry) => entry.id === hotspot.target)?.title ?? hotspot.target)}" onclick="loadscene(scene_${xml(hotspot.target)}, null, MERGE, BLEND(0.6));"/>`).join("\n    ");
    return `<scene name="scene_${xml(node.id)}" title="${xml(node.title)}" onstart="set(layer[scene_title].html, '${xml(node.title)}');">
    <view hlookat="${yaw(Number(node.initialView?.yaw ?? 0) - offset)}" vlookat="${Number(node.initialView?.pitch ?? 0)}" fovtype="MFOV" fov="92" maxpixelzoom="1.5" limitview="auto"/>
    <image><sphere url="panoramas/${xml(node.id)}${extension}"/></image>
    ${hotspots}
  </scene>`;
  }).join("\n  ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<krpano version="1.22" title="装修设计全景漫游" onstart="if(startscene === null, set(startscene, scene_${xml(nodes[0].id)})); loadscene(get(startscene));">
  <include url="skin/vtourskin.xml" if="false"/>
  <style name="navspot" type="text" html="↗" css="font:700 22px sans-serif;color:#fff;" bgroundedge="28" bg="true" bgcolor="0x8C6544" width="52" height="52" align="center" edge="center" distorted="true" scale="1" onover="tween(scale,1.15);" onout="tween(scale,1);"/>
  <layer name="scene_title" type="text" align="top" y="24" width="280" height="44" bgcolor="0x17201C" bgalpha="0.84" bgroundedge="22" css="font:600 16px sans-serif;color:#fff;text-align:center;line-height:44px;"/>
  ${scenes}
</krpano>\n`;
}

function renderTourHtml(project) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:"><title>${html(project.title)} · 全景漫游</title><style>html,body,#pano{width:100%;height:100%;margin:0;background:#101512}body{font-family:system-ui,"Microsoft YaHei",sans-serif}.back{position:fixed;z-index:9;left:18px;top:18px;color:#fff;background:#17201cd9;padding:11px 16px;border-radius:999px;text-decoration:none}</style></head><body><a class="back" href="../index.html">返回设计册</a><div id="pano"></div><script src="krpano.js"></script><script>embedpano({xml:"tour.xml",target:"pano",html5:"only",localfallback:"none",mobilescale:1.0,passQueryParameters:"startscene,startlookat"});</script></body></html>`;
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function inside(root, target) { const relative = path.relative(root, target); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); }
function xml(value) { return String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" })[char]); }
function html(value) { return xml(value); }
function slash(value) { return value.split(path.sep).join("/"); }
function yaw(value) { const normalized = ((value + 180) % 360 + 360) % 360 - 180; return Math.round(normalized * 10000) / 10000; }
