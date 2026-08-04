import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { confirmArtifact, markArtifactReady, modifyArtifact, validateArtifactWorkflow } from "./artifact-workflow-v5.mjs";
import { resolveTourNodes } from "./portal-topology-v5.mjs";

export function assembleKrpanoTour({ projectDir, runtimeFile, output }) {
  const root = path.resolve(projectDir);
  const target = path.resolve(output ?? path.join(root, "pages", "tour"));
  if (!inside(root, target)) throw new Error("krpano tour output must stay inside the project workspace");
  const workflowFile = path.join(root, "artifact-workflow.json");
  let workflow = readJson(workflowFile);
  const geometry = readJson(path.join(root, "geometry.json"));
  const project = readJson(path.join(root, "project.json"));
  const productionFile = path.join(root, "panorama-production.json");
  const production = fs.existsSync(productionFile) ? readJson(productionFile) : { records: [] };
  validateArtifactWorkflow(workflow);

  const nodes = resolveTourNodes(geometry);
  if (nodes.length === 0) throw new Error("geometry.panoramaNodes must contain at least one confirmed view");
  const missingImages = nodes.flatMap((node) => {
    const artifact = workflow.artifacts[`panorama-photorealistic-${node.id}`];
    if (!artifact || artifact.status !== "confirmed") return [`${node.id}:image-not-confirmed`];
    if (!artifact.file || !fs.existsSync(path.join(root, artifact.file))) return [`${node.id}:file-missing`];
    return [];
  });
  if (missingImages.length) throw new Error(`krpano assembly is gated by confirmed Imagegen photorealistic panoramas: ${missingImages.join(", ")}`);

  const runtime = path.resolve(runtimeFile ?? "");
  if (!runtimeFile || !fs.existsSync(runtime) || path.basename(runtime).toLowerCase() !== "krpano.js") throw new Error("a valid licensed krpano.js runtime is required; pass --runtime <path-to-krpano.js>");
  const orientationOffsets = Object.fromEntries(nodes.map((node) => {
    const record = [...production.records].reverse().find((entry) => entry.nodeId === node.id && entry.kind === "photorealistic");
    return [node.id, Number(record?.orientationOffsetDeg ?? 0)];
  }));
  workflow = materializeHotspotArtifacts({ root, nodes, workflow, orientationOffsets });
  writeJson(workflowFile, workflow);

  fs.mkdirSync(path.join(target, "panoramas"), { recursive: true });
  fs.copyFileSync(runtime, path.join(target, "krpano.js"));
  for (const node of nodes) {
    const source = path.join(root, workflow.artifacts[`panorama-photorealistic-${node.id}`].file);
    fs.copyFileSync(source, path.join(target, "panoramas", `${node.id}${path.extname(source).toLowerCase()}`));
  }
  fs.writeFileSync(path.join(target, "tour.xml"), renderTourXml(nodes, workflow, orientationOffsets), "utf8");
  fs.writeFileSync(path.join(target, "index.html"), renderTourHtml(project), "utf8");
  writeJson(path.join(target, "tour.json"), {
    contract: "personal-agent/interior-krpano-tour/v5",
    projectId: project.projectId,
    navigation: "portal-threshold-with-continuous-arrival-heading",
    scenes: nodes.map((node) => ({
      id: node.id,
      title: node.title,
      sourceArtifact: `panorama-photorealistic-${node.id}`,
      orientationOffsetDeg: orientationOffsets[node.id],
      hotspots: resolveHotspotAngles(node, nodes, orientationOffsets),
    })),
    visualAcceptance: "user",
  });
  const entry = path.join(target, "index.html");
  const ready = markArtifactReady(workflow, "krpano-tour", { file: slash(path.relative(root, entry)), sha256: sha256File(entry) });
  writeJson(workflowFile, ready);
  return { ok: true, output: target, entry: "index.html", scenes: nodes.length };
}

function materializeHotspotArtifacts({ root, nodes, workflow, orientationOffsets }) {
  let state = workflow;
  for (const node of nodes) {
    const artifactId = `panorama-hotspots-${node.id}`;
    const file = path.join(root, "panoramas", "hotspots", `${node.id}.json`);
    writeJson(file, {
      contract: "personal-agent/interior-panorama-hotspots/v5",
      nodeId: node.id,
      camera: { position: node.position, lookAt: node.lookAt },
      hotspots: resolveHotspotAngles(node, nodes, orientationOffsets),
    });
    const relative = slash(path.relative(root, file));
    const hash = sha256File(file);
    const current = state.artifacts[artifactId];
    if (current.status === "confirmed" && (current.sha256 !== hash || current.file !== relative)) state = modifyArtifact(state, artifactId, { reason: "portal route or panorama orientation changed" });
    if (state.artifacts[artifactId].status !== "confirmed") {
      state = markArtifactReady(state, artifactId, { file: relative, sha256: hash });
      state = confirmArtifact(state, artifactId, {
        confirmedBy: "agent-navigation-gate",
        summary: "门槛锚点、门洞转向、往返关系和目标到达视线已通过检查。",
      });
    }
  }
  return state;
}

export function resolveHotspotAngles(node, nodes, orientationOffsets) {
  const sourceOffset = Number(orientationOffsets[node.id] ?? 0);
  return (node.hotspots ?? []).map((hotspot) => {
    const targetOffset = Number(orientationOffsets[hotspot.target] ?? 0);
    return {
      ...hotspot,
      departureAth: yaw(Number(hotspot.departureYaw ?? 0) - sourceOffset),
      departureAtv: Number(hotspot.departurePitch ?? 18),
      arrivalHlookat: yaw(Number(hotspot.arrivalYaw ?? 0) - targetOffset),
      arrivalVlookat: Number(hotspot.arrivalPitch ?? nodes.find((entry) => entry.id === hotspot.target)?.initialView?.pitch ?? 0),
    };
  });
}

function renderTourXml(nodes, workflow, orientationOffsets) {
  const scenes = nodes.map((node) => {
    const artifact = workflow.artifacts[`panorama-photorealistic-${node.id}`];
    const extension = path.extname(artifact.file).toLowerCase();
    const offset = Number(orientationOffsets[node.id] ?? 0);
    const hotspots = resolveHotspotAngles(node, nodes, orientationOffsets).map((hotspot, index) => {
      const targetTitle = nodes.find((entry) => entry.id === hotspot.target)?.title ?? hotspot.target;
      const style = hotspot.kind === "portal" ? "portalspot" : "waypointspot";
      const icon = hotspot.kind === "portal" ? "↑" : "⌃";
      const vars = `view.hlookat=${hotspot.arrivalHlookat}&amp;view.vlookat=${hotspot.arrivalVlookat}`;
      const click = `lookto(${hotspot.departureAth},${Math.min(8, hotspot.departureAtv)},72,smooth(540,-540,540)); loadscene(scene_${xml(hotspot.target)},${vars},MERGE,BLEND(0.55)); lookat(${hotspot.arrivalHlookat},${hotspot.arrivalVlookat});`;
      return `<hotspot name="hs_${xml(node.id)}_${index}" ath="${hotspot.departureAth}" atv="${hotspot.departureAtv}" style="${style}" html="${icon}&lt;br/&gt;&lt;span&gt;${xml(hotspot.label ?? targetTitle)}&lt;/span&gt;" tooltip="${xml(targetTitle)}" onclick="${click}"/>`;
    }).join("\n    ");
    return `<scene name="scene_${xml(node.id)}" title="${xml(node.title)}" onstart="set(layer[scene_title].html, '${xml(node.title)}');">
    <view hlookat="${yaw(Number(node.initialView?.yaw ?? 0) - offset)}" vlookat="${Number(node.initialView?.pitch ?? 0)}" fovtype="MFOV" fov="88" maxpixelzoom="1.5" limitview="auto"/>
    <image><sphere url="panoramas/${xml(node.id)}${extension}"/></image>
    ${hotspots}
  </scene>`;
  }).join("\n  ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<krpano version="1.22" title="装修设计全景漫游" onstart="if(startscene === null, set(startscene, scene_${xml(nodes[0].id)})); loadscene(get(startscene));">
  <style name="portalspot" type="text" css="font:700 20px sans-serif;color:#fff;text-align:center;line-height:18px;" bgroundedge="8" bg="true" bgcolor="0x8C6544" bgalpha="0.9" padding="10 14" align="center" edge="center" distorted="true" depth="900" scale="0.82" onover="tween(scale,0.94);" onout="tween(scale,0.82);"/>
  <style name="waypointspot" type="text" css="font:700 18px sans-serif;color:#fff;text-align:center;line-height:18px;" bgroundedge="8" bg="true" bgcolor="0x26332D" bgalpha="0.86" padding="9 13" align="center" edge="center" distorted="true" depth="900" scale="0.78" onover="tween(scale,0.9);" onout="tween(scale,0.78);"/>
  <layer name="scene_title" type="text" align="top" y="24" width="280" height="44" bgcolor="0x17201C" bgalpha="0.84" bgroundedge="6" css="font:600 16px sans-serif;color:#fff;text-align:center;line-height:44px;"/>
  ${scenes}
</krpano>\n`;
}

function renderTourHtml(project) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:"><title>${html(project.title)} · 全景漫游</title><style>html,body,#pano{width:100%;height:100%;margin:0;background:#101512}body{font-family:system-ui,"Microsoft YaHei",sans-serif}.back{position:fixed;z-index:9;left:18px;top:18px;color:#fff;background:#17201ce6;padding:10px 14px;border:1px solid #ffffff2b;border-radius:6px;text-decoration:none;font-size:14px}.back:focus-visible{outline:2px solid #fff;outline-offset:2px}</style></head><body><a class="back" href="../index.html">← 返回设计册</a><div id="pano"></div><script src="krpano.js"></script><script>embedpano({xml:"tour.xml",target:"pano",html5:"only",localfallback:"none",mobilescale:1.0,passQueryParameters:"startscene,startlookat"});</script></body></html>`;
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function inside(root, target) { const relative = path.relative(root, target); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); }
function xml(value) { return String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" })[char]); }
function html(value) { return xml(value); }
function slash(value) { return value.split(path.sep).join("/"); }
function sha256File(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function yaw(value) { return Math.round((((value + 180) % 360 + 360) % 360 - 180) * 10_000) / 10_000; }
