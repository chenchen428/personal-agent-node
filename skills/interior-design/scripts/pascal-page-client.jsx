import React, { Component, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CameraControls, Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import useScene from '@pascal-app/core/store';
import { Viewer, useViewer } from '@pascal-app/viewer';
import { Sphere, Vector3 } from 'three';
import { ArchitectureEnvelope } from './pascal-architecture.jsx';

class ViewerBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    document.body.dataset.viewerState = 'fallback';
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function Finish({ color, selected = false, metalness = 0.02, roughness = 0.76 }) {
  return <meshStandardMaterial
    color={selected ? '#c96f4a' : color}
    emissive={selected ? '#7a2f18' : '#000000'}
    emissiveIntensity={selected ? 0.28 : 0}
    metalness={metalness}
    roughness={roughness}
  />;
}

function BoxPart({ size, position, color, selected, rotation = [0, 0, 0] }) {
  return <mesh castShadow receiveShadow position={position} rotation={rotation}>
    <boxGeometry args={size} />
    <Finish color={color} selected={selected} />
  </mesh>;
}

function CylinderPart({ args, position, color, selected, rotation = [0, 0, 0] }) {
  return <mesh castShadow receiveShadow position={position} rotation={rotation}>
    <cylinderGeometry args={args} />
    <Finish color={color} selected={selected} />
  </mesh>;
}

function FurnitureItem({ item, selected }) {
  const [width, depth, height] = item.size;
  const [x, z] = item.position;
  const color = item.color || '#d8c9b6';
  const pale = '#f2efe7';
  const dark = '#4b554f';
  const kind = String(item.kind || '').toLowerCase();
  const angle = (item.rotation || 0) * Math.PI / 180;
  let content;

  if (kind.includes('rug')) {
    content = <>
      <BoxPart size={[width, Math.max(height, 0.045), depth]} position={[0, height / 2, 0]} color={color} selected={selected} />
      <BoxPart size={[width * 0.82, 0.012, depth * 0.72]} position={[0, height + 0.008, 0]} color={pale} selected={selected} />
    </>;
  } else if (kind.includes('bed')) {
    content = <>
      <BoxPart size={[width, 0.24, depth]} position={[0, 0.16, 0]} color={dark} selected={selected} />
      <BoxPart size={[width * 0.94, height * 0.58, depth * 0.88]} position={[0, 0.46, 0.04]} color={color} selected={selected} />
      <BoxPart size={[width * 1.02, 0.92, 0.16]} position={[0, 0.68, -depth * 0.46]} color={dark} selected={selected} />
      <BoxPart size={[width * 0.37, 0.13, depth * 0.2]} position={[-width * 0.23, 0.78, -depth * 0.25]} color={pale} selected={selected} />
      <BoxPart size={[width * 0.37, 0.13, depth * 0.2]} position={[width * 0.23, 0.78, -depth * 0.25]} color={pale} selected={selected} />
      <BoxPart size={[width * 0.64, 0.07, depth * 0.28]} position={[0, 0.73, depth * 0.2]} color="#47705b" selected={selected} />
    </>;
  } else if (kind.includes('sofa')) {
    content = <>
      <BoxPart size={[width, height * 0.42, depth]} position={[0, height * 0.25, 0]} color={color} selected={selected} />
      <BoxPart size={[width, height * 0.7, depth * 0.24]} position={[0, height * 0.57, -depth * 0.39]} color={color} selected={selected} />
      <BoxPart size={[0.22, height * 0.62, depth]} position={[-width * 0.46, height * 0.42, 0]} color={color} selected={selected} />
      <BoxPart size={[0.22, height * 0.62, depth]} position={[width * 0.46, height * 0.42, 0]} color={color} selected={selected} />
      {[-1, 0, 1].map((index) => <BoxPart key={index} size={[width * 0.22, 0.28, 0.14]} position={[index * width * 0.27, height * 0.72, -depth * 0.22]} color={index === 0 ? '#47705b' : pale} selected={selected} />)}
    </>;
  } else if (/dining|table|desk/.test(kind)) {
    const dining = kind.includes('dining');
    content = <>
      <BoxPart size={[width, 0.1, depth]} position={[0, height - 0.08, 0]} color={color} selected={selected} />
      {[-1, 1].flatMap((sideX) => [-1, 1].map((sideZ) => <BoxPart key={`${sideX}:${sideZ}`} size={[0.08, height - 0.1, 0.08]} position={[sideX * width * 0.38, height * 0.45, sideZ * depth * 0.34]} color={dark} selected={selected} />))}
      {dining ? [-1, 0, 1].flatMap((row) => [-1, 1].map((side) => <group key={`${row}:${side}`} position={[row * width * 0.36, 0, side * depth * 0.82]}>
        <BoxPart size={[0.44, 0.12, 0.42]} position={[0, 0.43, 0]} color={pale} selected={selected} />
        <BoxPart size={[0.44, 0.48, 0.11]} position={[0, 0.68, side * 0.15]} color={pale} selected={selected} />
      </group>)) : null}
    </>;
  } else if (/chair|bench/.test(kind)) {
    content = <>
      <BoxPart size={[width, 0.24, depth]} position={[0, Math.min(height * 0.42, 0.4), 0]} color={color} selected={selected} />
      {!kind.includes('bench') ? <BoxPart size={[width, height * 0.62, 0.16]} position={[0, height * 0.64, -depth * 0.4]} color={color} selected={selected} /> : null}
      {[-1, 1].flatMap((sideX) => [-1, 1].map((sideZ) => <BoxPart key={`${sideX}:${sideZ}`} size={[0.07, Math.min(height * 0.42, 0.4), 0.07]} position={[sideX * width * 0.35, 0.19, sideZ * depth * 0.34]} color={dark} selected={selected} />))}
    </>;
  } else if (kind.includes('lamp')) {
    content = <>
      <CylinderPart args={[width * 0.34, width * 0.4, 0.08, 18]} position={[0, 0.04, 0]} color={dark} selected={selected} />
      <CylinderPart args={[0.045, 0.06, height * 0.8, 14]} position={[0, height * 0.43, 0]} color={dark} selected={selected} />
      <CylinderPart args={[width * 0.42, width * 0.23, height * 0.22, 18]} position={[0, height * 0.86, 0]} color={pale} selected={selected} />
    </>;
  } else if (kind.includes('plant')) {
    content = <>
      <CylinderPart args={[width * 0.3, width * 0.24, height * 0.42, 14]} position={[0, height * 0.21, 0]} color="#8b7461" selected={selected} />
      {[0, 1, 2, 3, 4, 5, 6].map((index) => <mesh key={index} castShadow position={[Math.sin(index * 2.1) * width * 0.24, height * (0.55 + (index % 3) * 0.1), Math.cos(index * 2.1) * depth * 0.24]} scale={[1, 1.35, 0.72]}>
        <sphereGeometry args={[width * 0.22, 10, 8]} />
        <Finish color={index % 2 ? '#47705b' : '#66816f'} selected={selected} />
      </mesh>)}
    </>;
  } else if (/toilet|sink/.test(kind)) {
    content = kind.includes('toilet') ? <>
      <BoxPart size={[width, height * 0.55, depth * 0.58]} position={[0, height * 0.27, depth * 0.16]} color={pale} selected={selected} />
      <CylinderPart args={[width * 0.4, width * 0.46, height * 0.34, 18]} position={[0, height * 0.63, -depth * 0.18]} color={pale} selected={selected} />
    </> : <>
      <BoxPart size={[width, height * 0.76, depth]} position={[0, height * 0.38, 0]} color={color} selected={selected} />
      <CylinderPart args={[width * 0.34, width * 0.3, height * 0.12, 20]} position={[0, height * 0.83, 0]} color={pale} selected={selected} />
    </>;
  } else {
    content = <>
      <BoxPart size={[width, height, depth]} position={[0, height / 2, 0]} color={color} selected={selected} />
      {kind.includes('cabinet') || kind.includes('media') ? <BoxPart size={[0.024, height * 0.72, depth * 0.86]} position={[width * 0.505, height * 0.52, 0]} color={pale} selected={selected} /> : null}
    </>;
  }

  return <group name={item.id} position={[x, item.elevation || 0, z]} rotation={[0, angle, 0]}>{content}</group>;
}

function ProceduralFurniture({ items, highlighted }) {
  return items.filter((item) => item?.size?.length === 3).map((item) => <FurnitureItem item={item} key={item.id} selected={highlighted.has(item.id)} />);
}

function SceneLabels({ payload }) {
  const labels = useMemo(() => Object.values(payload.scene?.nodes || {})
    .filter((node) => node.type === 'zone' && Array.isArray(node.polygon) && node.polygon.length >= 3)
    .map((node) => ({
      id: node.id,
      name: node.name,
      position: [
        node.polygon.reduce((sum, point) => sum + point[0], 0) / node.polygon.length,
        1.35,
        node.polygon.reduce((sum, point) => sum + point[1], 0) / node.polygon.length,
      ],
    })), [payload]);
  return labels.map((label) => <Html center className="pascal-room-label" key={label.id} position={label.position}>
    <span>{label.name}</span>
  </Html>);
}

function ProjectCamera({ payload }) {
  const controls = useRef(null);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const cameraMode = useViewer((state) => state.cameraMode);
  const frame = useMemo(() => {
    const points = Object.values(payload.scene?.nodes || {})
      .filter((node) => node.type === 'zone' && Array.isArray(node.polygon))
      .flatMap((node) => node.polygon);
    const minX = Math.min(...points.map((point) => point[0]), 0);
    const maxX = Math.max(...points.map((point) => point[0]), 8);
    const minZ = Math.min(...points.map((point) => point[1]), 0);
    const maxZ = Math.max(...points.map((point) => point[1]), 8);
    return {
      sphere: new Sphere(
        new Vector3((minX + maxX) / 2, 1.5, (minZ + maxZ) / 2),
        Math.hypot(maxX - minX, maxZ - minZ, 3) * 0.58,
      ),
      centerX: (minX + maxX) / 2,
      centerZ: (minZ + maxZ) / 2,
      span: Math.max(maxX - minX, maxZ - minZ, 8),
    };
  }, [payload]);
  useEffect(() => {
    const api = controls.current;
    if (!api) return;
    void (async () => {
      if (cameraMode === 'orthographic') {
        await api.setLookAt(
          frame.centerX,
          frame.span * 1.6,
          frame.centerZ + 0.001,
          frame.centerX,
          0,
          frame.centerZ,
          false,
        );
      } else {
        await api.setLookAt(
          frame.centerX + frame.span * 0.95,
          frame.span * 1.28,
          frame.centerZ + frame.span * 0.95,
          frame.centerX,
          0.7,
          frame.centerZ,
          false,
        );
      }
      await api.fitToSphere(frame.sphere, false);
      invalidate();
    })();
  }, [camera, cameraMode, frame, invalidate]);
  return <CameraControls
    camera={camera}
    dollyToCursor
    key={cameraMode}
    makeDefault
    maxDistance={frame.span * 5}
    minDistance={Math.max(2, frame.span * 0.16)}
    ref={controls}
  />;
}

function PascalScene({ payload }) {
  const [highlighted, setHighlighted] = useState(new Set());
  useEffect(() => {
    document.body.dataset.renderProfile = 'professional-mesh-ink';
    const handler = (event) => setHighlighted(new Set(event.detail || []));
    window.addEventListener('pascal-highlight', handler);
    return () => {
      delete document.body.dataset.renderProfile;
      window.removeEventListener('pascal-highlight', handler);
    };
  }, []);
  return <ViewerBoundary>
    <Viewer
      defaultRender={{ shading: 'rendered', textures: false, colorPreset: 'clay' }}
      disablePostFx
      renderContext="viewer"
      sceneReadyKey={payload.sceneHash || payload.revision}
      sceneReadyMaxWaitMs={12_000}
      onSceneReadyChange={(ready) => {
        document.body.dataset.viewerState = ready ? 'ready' : 'loading';
        const fallback = document.getElementById('fallback');
        if (fallback) fallback.hidden = ready;
      }}
    >
      <ProjectCamera payload={payload} />
      <ArchitectureEnvelope payload={payload} />
      <ProceduralFurniture highlighted={highlighted} items={payload.furniture || []} />
      <SceneLabels payload={payload} />
    </Viewer>
  </ViewerBoundary>;
}

function start() {
  const source = document.getElementById('pascal-scene');
  const target = document.getElementById('scene');
  const fallback = document.getElementById('fallback');
  if (!source || !target) return;
  try {
    const payload = JSON.parse(source.textContent || '{}');
    const scene = payload.scene;
    if (!scene?.nodes || !Array.isArray(scene.rootNodeIds)) throw new Error('invalid Pascal scene payload');
    useScene.getState().setScene(scene.nodes, scene.rootNodeIds, {
      collections: scene.collections || {},
      materials: scene.materials || {},
    });
    useScene.getState().setReadOnly(true);
    useViewer.setState((state) => ({
      projectId: payload.projectId || null, renderContext: 'viewer',
      shading: 'rendered', shadingByContext: { ...state.shadingByContext, viewer: 'rendered' },
      colorPreset: 'clay', edges: 'off', shadows: true, sceneTheme: 'studio',
      transparentBackground: false, unit: 'metric', unitExplicit: true, textures: false,
      levelMode: 'stacked', wallMode: 'down', cameraMode: 'perspective',
    }));
    window.PersonalAgentPascalViewer = {
      setLevelMode(mode) {
        if (!['stacked', 'exploded', 'solo'].includes(mode)) return false;
        useViewer.getState().setLevelMode(mode);
        return true;
      },
      setLevel(levelId) {
        useViewer.getState().setSelection({ levelId: levelId || null, selectedIds: [] });
        if (levelId) useViewer.getState().setLevelMode('solo');
        return true;
      },
      setCameraMode(mode) {
        if (!['perspective', 'orthographic'].includes(mode)) return false;
        useViewer.getState().setCameraMode(mode);
        return true;
      },
      highlight(ids) {
        const selectedIds = Array.isArray(ids) ? ids : [];
        useViewer.getState().setSelection({ selectedIds });
        window.dispatchEvent(new CustomEvent('pascal-highlight', { detail: selectedIds }));
        return true;
      },
    };
    createRoot(target).render(<PascalScene payload={payload} />);
  } catch {
    document.body.dataset.viewerState = 'fallback';
    if (fallback) fallback.hidden = false;
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
