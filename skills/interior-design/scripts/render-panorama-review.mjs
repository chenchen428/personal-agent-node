import fs from "node:fs";
import path from "node:path";
import { validateArtifactWorkflow } from "./artifact-workflow-v5.mjs";

export function renderPanoramaReview({ projectDir, output }) {
  const root = path.resolve(projectDir);
  const target = path.resolve(output ?? path.join(root, "pages", "panorama-review"));
  if (!inside(root, target)) throw new Error("panorama review output must stay inside the project workspace");
  const project = readJson(path.join(root, "project.json"));
  const geometry = readJson(path.join(root, "geometry.json"));
  const workflow = readJson(path.join(root, "artifact-workflow.json"));
  const production = fs.existsSync(path.join(root, "panorama-production.json"))
    ? readJson(path.join(root, "panorama-production.json"))
    : { records: [] };
  validateArtifactWorkflow(workflow);
  if (fs.existsSync(path.join(target, "images"))) fs.rmSync(path.join(target, "images"), { recursive: true, force: true });
  fs.mkdirSync(path.join(target, "images"), { recursive: true });

  const nodes = (geometry.panoramaNodes ?? []).map((node, index) => {
    const camera = workflow.artifacts[`panorama-camera-${node.id}`];
    const control = workflow.artifacts[`panorama-control-${node.id}`];
    const prompt = workflow.artifacts[`panorama-imagegen-prompt-${node.id}`];
    const photorealistic = workflow.artifacts[`panorama-photorealistic-${node.id}`];
    const hotspotArtifact = workflow.artifacts[`panorama-hotspots-${node.id}`];
    return {
      ...node,
      index: index + 1,
      camera,
      controlArtifact: control,
      promptArtifact: prompt,
      photorealistic: publicImage(root, target, node.id, "photorealistic", photorealistic),
      photorealisticArtifact: photorealistic,
      orientationOffsetDeg: latestOrientation(production.records, node.id, photorealistic),
      hotspotLinks: node.hotspots ?? [],
      hotspotArtifact,
    };
  });
  const runtime = path.resolve(import.meta.dirname, "../../../core/agent/public/assets/interior-workspace/panorama-viewer.bundle.js");
  if (!fs.existsSync(runtime)) throw new Error("panorama viewer runtime is missing; run npm run interior:build-runtime");
  fs.copyFileSync(runtime, path.join(target, "viewer.bundle.js"));
  fs.writeFileSync(path.join(target, "viewer.html"), viewerHtml(), "utf8");
  fs.writeFileSync(path.join(target, "index.html"), html(project, nodes), "utf8");
  writeJson(path.join(target, "review.json"), {
    contract: "personal-agent/interior-panorama-review/v5",
    projectId: project.projectId,
    generationPolicy: "one-view-one-image-one-confirmation",
    nodes: nodes.map((node) => ({ id: node.id, title: node.title, cameraStatus: node.camera.status, controlStatus: node.controlArtifact.status, promptStatus: node.promptArtifact.status, photorealisticStatus: node.photorealisticArtifact.status, orientationOffsetDeg: node.orientationOffsetDeg, hotspotStatus: node.hotspotArtifact.status })),
  });
  return { ok: true, output: target, nodes: nodes.length, entry: "index.html" };
}

function publicImage(root, target, nodeId, kind, artifact) {
  if (!artifact?.file) return { artifact, src: null };
  const source = path.resolve(root, artifact.file);
  if (!inside(root, source) || !fs.existsSync(source)) return { artifact, src: null };
  const extension = path.extname(source).toLowerCase() || ".png";
  const relative = `images/${nodeId}-${kind}${extension}`;
  fs.copyFileSync(source, path.join(target, relative));
  return { artifact, src: relative };
}

function html(project, nodes) {
  const cards = nodes.map((node) => `<article class="view-card" id="view-${escape(node.id)}">
    <div class="view-head"><span class="number">${String(node.index).padStart(2, "0")}</span><div><h2>${escape(node.title)}</h2><p>${escape(node.roomId ?? "空间视角")}</p></div>${badge(node.photorealisticArtifact.status)}</div>
    <div class="camera"><strong>相机视角</strong><span>${formatPoint(node.position)} → ${formatPoint(node.lookAt)}</span>${badge(node.camera.status)}<strong>空间一致性检查</strong>${badge(node.controlArtifact.status)}<strong>热点</strong><span>${node.hotspotLinks.length}</span>${badge(node.hotspotArtifact.status)}</div>
    ${panoramaPanel(node)}
    <p class="rule">修改本张实景图会重做当前节点；若后续视角以它作为风格参考，这些后续实景图也会重新确认，但相机和结构控制图保持不变。修改相机或空间设计时，才会重新生成对应结构控制底稿。</p>
  </article>`).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'unsafe-inline' 'self'; img-src 'self' data:; object-src 'none'"><title>${escape(project.title)} · 实景全景逐张确认</title><style>${css()}</style></head><body><header><a href="../index.html">← 返回设计册</a><p>实景全景确认</p></header><main><section class="hero"><span>Imagegen 一次生成一张 · 逐张确认</span><h1>先确认实景全景，再组成漫游</h1><p>确认相机后，系统依据设计稿和内部结构控制底稿生成一张完整的照片级 2:1 实景全景图。你只需要确认实景效果和视角；全部视角确认后才会组装 krpano 漫游。</p></section>${cards || "<p>尚未定义全景节点。</p>"}</main></body></html>`;
}

function panoramaPanel(node) {
  const title = "Imagegen 实景全景图";
  const yawValue = yaw(Number(node.initialView?.yaw ?? 0) - Number(node.orientationOffsetDeg ?? 0));
  const params = new URLSearchParams({
    image: node.photorealistic.src ?? "",
    title: node.title,
    yaw: String(yawValue),
    pitch: String(Number(node.initialView?.pitch ?? 0)),
  });
  const viewer = `viewer.html?${escape(params.toString())}`;
  const preview = node.photorealistic.src
    ? `<div class="panorama-frame"><iframe src="${viewer}" title="${escape(node.title)} 360° 实景全景" allowfullscreen loading="lazy"></iframe><a href="${viewer}" target="_blank" rel="noopener">全屏查看</a></div>`
    : `<div class="placeholder">等待上一阶段确认后生成</div>`;
  return `<section class="image-panel"><div><h3>${title}</h3>${badge(node.photorealisticArtifact.status)}</div>${preview}<p>请在 360° 球面中确认空间、材质、灯光、软装、窗外环境和视角，再进入下一张。</p></section>`;
}
function badge(status) {
  const labels = { draft: "待生成", "ready-for-review": "待确认", confirmed: "已确认", invalidated: "需重做" };
  return `<span class="badge ${escape(status)}">${labels[status] ?? status}</span>`;
}
function css() { return `*{box-sizing:border-box}body{margin:0;background:#f3f0e9;color:#202722;font-family:system-ui,"Microsoft YaHei",sans-serif}header{height:64px;padding:0 5vw;background:#17201c;color:#fff;display:flex;align-items:center;justify-content:space-between}header a{color:#fff;text-decoration:none}main{width:min(1240px,92vw);margin:auto;padding:64px 0 100px}.hero{max-width:800px;margin-bottom:56px}.hero span{color:#a66c3f;font-weight:700}.hero h1{font:500 clamp(38px,6vw,76px)/1.05 Georgia,"Noto Serif SC",serif;margin:14px 0;letter-spacing:0}.hero p{font-size:18px;color:#68736d;line-height:1.7}.view-card{background:#fffdf8;padding:34px;border:1px solid #d9d2c7;margin:28px 0}.view-head{display:flex;align-items:center;gap:18px}.view-head .number{font:500 40px Georgia;color:#a66c3f}.view-head h2{margin:0;font-size:28px;letter-spacing:0}.view-head p{margin:4px 0;color:#7a827d}.view-head>.badge{margin-left:auto}.camera{margin:24px 0;padding:16px 18px;background:#eef1ed;display:flex;gap:12px;align-items:center;flex-wrap:wrap}.camera span:nth-child(2){flex:1;min-width:240px;color:#606963}.image-panel{border:1px solid #ddd5c8;padding:18px}.image-panel>div:first-child{display:flex;justify-content:space-between;align-items:center}.image-panel h3{margin:0}.placeholder{width:100%;aspect-ratio:16/9;margin:15px 0;background:#dcded8;display:grid;place-items:center;color:#7a827d}.panorama-frame{position:relative;width:100%;aspect-ratio:16/9;margin:15px 0;background:#202722;overflow:hidden}.panorama-frame iframe{width:100%;height:100%;border:0;display:block}.panorama-frame>a{position:absolute;right:12px;bottom:12px;padding:9px 12px;background:rgba(23,32,28,.86);color:#fff;text-decoration:none;font-size:13px}.image-panel p,.rule{color:#707973;line-height:1.6}.badge{display:inline-block;border-radius:999px;padding:6px 10px;font-size:12px;background:#e4e5e0}.badge.confirmed{background:#dcebdd;color:#31583a}.badge.ready-for-review{background:#f4dfb8;color:#714d1e}.badge.invalidated{background:#f2d0cb;color:#7a322a}@media(max-width:760px){main{padding-top:38px}.view-card{padding:20px}.camera{align-items:flex-start}.panorama-frame{aspect-ratio:4/3}}`; }
function formatPoint(point = []) { return point.map((value) => Math.round(value)).join(", "); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function latestOrientation(records, nodeId, artifact) {
  const record = [...(records ?? [])].reverse().find((entry) => entry.nodeId === nodeId && entry.kind === "photorealistic" && entry.file === artifact?.file);
  return Number(record?.orientationOffsetDeg ?? 0);
}
function viewerHtml() { return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'unsafe-inline'; script-src 'self'; img-src 'self' data:; object-src 'none'"><title>实景全景查看</title><style>*{box-sizing:border-box}html,body,[data-panorama-viewer]{width:100%;height:100%;margin:0;overflow:hidden;background:#202722}[data-panorama-viewer] canvas{display:block;width:100%;height:100%;touch-action:none;cursor:grab}[data-panorama-viewer] canvas:active{cursor:grabbing}.tools{position:absolute;right:12px;top:12px;display:flex;gap:8px}.tools button{width:40px;height:40px;border:1px solid rgba(255,255,255,.28);background:rgba(23,32,28,.84);color:#fff;font-size:19px;cursor:pointer}.state{position:absolute;inset:0;display:grid;place-items:center;color:#fff;font:14px system-ui,"Microsoft YaHei",sans-serif;pointer-events:none}[data-ready='true'] .state{display:none}[data-error='true'] .state::after{content:'全景图加载失败'}.state::after{content:'加载中'}</style></head><body><main data-panorama-viewer><div class="state"></div><nav class="tools" aria-label="全景工具"><button type="button" data-action="reset" title="复位" aria-label="复位">↺</button><button type="button" data-action="fullscreen" title="全屏" aria-label="全屏">⛶</button></nav></main><script src="viewer.bundle.js"></script></body></html>`; }
function inside(root, target) { const relative = path.relative(root, target); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); }
function escape(value) { return String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" })[char]); }
function yaw(value) { return Math.round(((((value + 180) % 360) + 360) % 360 - 180) * 10_000) / 10_000; }
