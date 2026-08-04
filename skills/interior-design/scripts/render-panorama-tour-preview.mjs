import fs from "node:fs";
import path from "node:path";
import { validateArtifactWorkflow } from "./artifact-workflow-v5.mjs";
import { resolveTourNodes } from "./portal-topology-v5.mjs";
import { resolveHotspotAngles } from "./render-krpano-tour.mjs";

export function renderPanoramaTourPreview({ projectDir, output, runtimeFile } = {}) {
  const root = path.resolve(projectDir);
  const target = path.resolve(output ?? path.join(root, "pages", "tour-preview"));
  if (!inside(root, target)) throw new Error("tour preview output must stay inside the project workspace");
  const project = readJson(path.join(root, "project.json"));
  const geometry = readJson(path.join(root, "geometry.json"));
  const workflow = readJson(path.join(root, "artifact-workflow.json"));
  const productionFile = path.join(root, "panorama-production.json");
  const production = fs.existsSync(productionFile) ? readJson(productionFile) : { records: [] };
  validateArtifactWorkflow(workflow);

  const nodes = resolveTourNodes(geometry);
  if (nodes.length === 0) throw new Error("geometry.panoramaNodes must contain at least one confirmed view");
  const missing = nodes.flatMap((node) => {
    const artifact = workflow.artifacts[`panorama-photorealistic-${node.id}`];
    if (!artifact || artifact.status !== "confirmed") return [`${node.id}:image-not-confirmed`];
    if (!artifact.file || !fs.existsSync(path.join(root, artifact.file))) return [`${node.id}:file-missing`];
    return [];
  });
  if (missing.length) throw new Error(`tour preview is gated by confirmed photorealistic panoramas: ${missing.join(", ")}`);

  const runtime = path.resolve(runtimeFile ?? path.join(import.meta.dirname, "../../../core/agent/public/assets/interior-workspace/panorama-tour-preview.bundle.js"));
  if (!fs.existsSync(runtime)) throw new Error("tour preview runtime is missing; run npm run interior:build-runtime");
  const orientationOffsets = Object.fromEntries(nodes.map((node) => {
    const record = [...production.records].reverse().find((entry) => entry.nodeId === node.id && entry.kind === "photorealistic");
    return [node.id, Number(record?.orientationOffsetDeg ?? 0)];
  }));

  fs.mkdirSync(path.join(target, "panoramas"), { recursive: true });
  fs.copyFileSync(runtime, path.join(target, "viewer.bundle.js"));
  const scenes = nodes.map((node) => {
    const artifact = workflow.artifacts[`panorama-photorealistic-${node.id}`];
    const source = path.join(root, artifact.file);
    const extension = path.extname(source).toLowerCase();
    fs.copyFileSync(source, path.join(target, "panoramas", `${node.id}${extension}`));
    return {
      id: node.id,
      title: node.title,
      image: `panoramas/${node.id}${extension}`,
      initialYaw: yaw(Number(node.initialView?.yaw ?? 0) - orientationOffsets[node.id]),
      initialPitch: Number(node.initialView?.pitch ?? 0),
      hotspots: resolveHotspotAngles(node, nodes, orientationOffsets).map((hotspot) => ({
        id: hotspot.id,
        kind: hotspot.kind,
        label: hotspot.label,
        target: hotspot.target,
        anchorType: hotspot.anchorType,
        departureAth: hotspot.departureAth,
        departureAtv: hotspot.departureAtv,
        arrivalHlookat: hotspot.arrivalHlookat,
        arrivalVlookat: hotspot.arrivalVlookat,
      })),
    };
  });
  writeJson(path.join(target, "tour.json"), {
    contract: "personal-agent/interior-tour-preview/v5",
    projectId: project.projectId,
    role: "acceptance-preview-not-final-runtime",
    engine: "three-v5",
    finalDeliveryEngine: "krpano",
    scenes,
  });
  fs.writeFileSync(path.join(target, "index.html"), html(project), "utf8");
  return { ok: true, output: target, entry: "index.html", scenes: scenes.length, role: "acceptance-preview-not-final-runtime" };
}

function html(project) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'"><title>${escape(project.title)} · 全景验收预览</title><style>${css()}</style></head><body><main data-panorama-tour-preview data-config="tour.json"><div class="state" data-state>加载中</div><div class="hotspots" data-hotspots></div><div class="topbar"><a href="../panorama-review/index.html" aria-label="返回实景全景确认">←</a><strong data-scene-title></strong><nav aria-label="全景工具"><button type="button" data-action="reset" title="复位" aria-label="复位">↺</button><button type="button" data-action="fullscreen" title="全屏" aria-label="全屏">⛶</button></nav></div><nav class="scene-list" data-scene-list aria-label="场景"></nav></main><script src="viewer.bundle.js"></script></body></html>`;
}

function css() {
  return `*{box-sizing:border-box}html,body,[data-panorama-tour-preview]{width:100%;height:100%;margin:0;overflow:hidden;background:#161a18;font-family:system-ui,"Microsoft YaHei",sans-serif}[data-panorama-tour-preview]{position:relative;color:#fff}[data-panorama-tour-preview] canvas{display:block;width:100%;height:100%;touch-action:none;cursor:grab}[data-panorama-tour-preview] canvas:active{cursor:grabbing}.state{position:absolute;inset:0;z-index:5;display:grid;place-items:center;background:#161a18;color:#fff;font-size:14px}[data-ready='true'] .state{display:none}[data-loading='true'] .state{display:grid;background:rgba(22,26,24,.52)}.topbar{position:absolute;z-index:4;left:16px;right:16px;top:max(16px,env(safe-area-inset-top));height:44px;display:grid;grid-template-columns:44px minmax(0,1fr) auto;align-items:center;gap:10px;pointer-events:none}.topbar>a,.topbar button{width:44px;height:44px;border:1px solid rgba(255,255,255,.25);border-radius:6px;background:rgba(20,27,23,.84);color:#fff;display:grid;place-items:center;text-decoration:none;font-size:20px;pointer-events:auto}.topbar strong{justify-self:center;max-width:min(420px,50vw);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:10px 16px;border-radius:6px;background:rgba(20,27,23,.78);font-size:15px;letter-spacing:0}.topbar nav{display:flex;gap:8px}.topbar button{cursor:pointer}.hotspots{position:absolute;inset:0;z-index:3;pointer-events:none}.hotspot{position:absolute;left:0;top:0;min-width:86px;max-width:180px;border:1px solid rgba(255,255,255,.36);border-radius:6px;padding:8px 11px;background:rgba(140,101,68,.92);color:#fff;pointer-events:auto;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.24)}.hotspot.waypoint{background:rgba(38,51,45,.9)}.hotspot span,.hotspot strong{display:block}.hotspot span{font-size:18px;line-height:14px}.hotspot strong{margin-top:4px;font-size:13px;line-height:16px;font-weight:650;overflow-wrap:anywhere}.scene-list{position:absolute;z-index:4;left:16px;right:16px;bottom:max(16px,env(safe-area-inset-bottom));display:flex;justify-content:center;gap:6px;pointer-events:none}.scene-list button{min-height:38px;max-width:180px;border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:8px 12px;background:rgba(20,27,23,.8);color:rgba(255,255,255,.76);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;pointer-events:auto}.scene-list button[data-active='true']{background:#fff;color:#202722;border-color:#fff}.topbar a:focus-visible,.topbar button:focus-visible,.hotspot:focus-visible,.scene-list button:focus-visible{outline:2px solid #fff;outline-offset:2px}@media(max-width:720px){.topbar{left:10px;right:10px}.topbar strong{max-width:42vw;font-size:13px}.scene-list{left:10px;right:10px;justify-content:flex-start;overflow-x:auto;padding-bottom:2px}.scene-list button{flex:0 0 auto;max-width:126px}.hotspot{min-width:76px;max-width:138px;padding:7px 9px}.hotspot strong{font-size:12px}}`;
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function inside(root, target) { const relative = path.relative(root, target); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); }
function escape(value) { return String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" })[char]); }
function yaw(value) { return Math.round((((value + 180) % 360 + 360) % 360 - 180) * 10_000) / 10_000; }
