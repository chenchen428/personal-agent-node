"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { cameraPose, createInteriorScene, disposeInteriorScene, type InteriorView } from "./interior-template-scene";

export function InteriorTemplateCanvas({ view, level, resetKey }: { view: InteriorView; labels: boolean; level: "level-1" | "level-2"; resetKey: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(false);
  const [phase, setPhase] = useState<"loading" | "ready">("loading");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", "可旋转、平移和缩放的装修设计 3D 户型");
    host.replaceChildren(canvas);
    setPhase("loading");
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    } catch {
      setFallback(true);
      return;
    }
    setFallback(false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    const scene = createInteriorScene(level);
    const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 100);
    const pose = cameraPose(view, "");
    camera.position.copy(pose.position);
    const controls = new OrbitControls(camera, canvas);
    controls.target.copy(pose.target);
    controls.enableDamping = false;
    controls.enablePan = true;
    controls.enableRotate = view !== "top";
    controls.screenSpacePanning = true;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 4;
    controls.maxDistance = 42;
    controls.update();
    const render = () => { renderer.render(scene, camera); };
    controls.addEventListener("change", render);
    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    setPhase("ready");
    return () => {
      observer.disconnect();
      controls.removeEventListener("change", render);
      controls.dispose();
      disposeInteriorScene(scene);
      renderer.dispose();
      canvas.remove();
    };
  }, [level, resetKey, view]);

  return <div className="interior-template-canvas"><div className="interior-canvas-runtime" ref={hostRef} />{phase === "loading" && !fallback ? <LoadingProjection /> : null}{fallback ? <ProjectionFallback /> : null}</div>;
}

function LoadingProjection() {
  return <div className="interior-loading-projection" role="status"><div className="loading-model"><i /><i /><i /><i /><i /></div><strong>正在构建 SU 设计稿</strong><span>空间结构 · 门窗构件 · 家具与动线</span></div>;
}

function ProjectionFallback() {
  return <div className="interior-projection-fallback" role="img" aria-label="装修设计概念户型的 3D 投影降级预览">
    <div className="projection-home"><i /><i /><i /><i /><i /><i /><i /></div>
    <strong>3D 投影预览</strong><span>当前设备未启用 WebGL，仍可查看完整空间关系。</span>
  </div>;
}
