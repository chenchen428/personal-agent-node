"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { cameraPose, createInteriorScene, disposeInteriorScene, type InteriorView } from "./interior-template-scene";

export function InteriorTemplateCanvas({ view, roomId }: { view: InteriorView; roomId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", "可旋转、平移和缩放的装修设计 3D 户型");
    host.replaceChildren(canvas);
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
    const scene = createInteriorScene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 100);
    const pose = cameraPose(view, roomId);
    camera.position.copy(pose.position);
    const controls = new OrbitControls(camera, canvas);
    controls.target.copy(pose.target);
    controls.enableDamping = false;
    controls.enablePan = true;
    controls.enableRotate = view !== "top";
    controls.screenSpacePanning = true;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = roomId ? 1.6 : 4;
    controls.maxDistance = roomId ? 14 : 42;
    controls.update();
    const render = () => renderer.render(scene, camera);
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
    return () => {
      observer.disconnect();
      controls.removeEventListener("change", render);
      controls.dispose();
      disposeInteriorScene(scene);
      renderer.dispose();
      canvas.remove();
    };
  }, [roomId, view]);

  return <div className="interior-template-canvas" ref={hostRef}>{fallback ? <ProjectionFallback /> : null}</div>;
}

function ProjectionFallback() {
  return <div className="interior-projection-fallback" role="img" aria-label="装修设计概念户型的 3D 投影降级预览">
    <div className="projection-home"><i /><i /><i /><i /><i /><i /><i /></div>
    <strong>3D 投影预览</strong><span>当前设备未启用 WebGL，仍可查看完整空间关系。</span>
  </div>;
}
