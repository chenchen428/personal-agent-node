import React, { Component, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import useScene from '@pascal-app/core/store';
import { Viewer, useViewer } from '@pascal-app/viewer';

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

function ProceduralFurniture({ items }) {
  const entries = useMemo(() => items.filter((item) => item?.size?.length === 3), [items]);
  return entries.map((item) => {
    const [width, depth, height] = item.size;
    const [x, z] = item.position;
    const color = item.color || '#d8c9b6';
    return (
      <mesh
        key={item.id}
        name={item.id}
        position={[x, (item.elevation || 0) + height / 2, z]}
        rotation={[0, (item.rotation || 0) * Math.PI / 180, 0]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color={color} roughness={0.76} metalness={0.02} />
      </mesh>
    );
  });
}

function PascalScene({ payload }) {
  return (
    <ViewerBoundary>
      <Viewer
        defaultRender={{ shading: 'solid', textures: false, colorPreset: 'clay' }}
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
        <ProceduralFurniture items={payload.furniture || []} />
      </Viewer>
    </ViewerBoundary>
  );
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
    const viewer = useViewer.getState();
    viewer.setProjectId(payload.projectId || null);
    viewer.setUnit('metric');
    viewer.setTextures(false);
    viewer.setLevelMode('stacked');
    viewer.setWallMode('cutaway');
    viewer.setCameraMode('perspective');
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
        useViewer.getState().setSelection({ selectedIds: Array.isArray(ids) ? ids : [] });
        return true;
      },
    };
    createRoot(target).render(<PascalScene payload={payload} />);
  } catch {
    document.body.dataset.viewerState = 'fallback';
    if (fallback) fallback.hidden = false;
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
