import React, { Component, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import useScene from '@pascal-app/core/store';
import { Viewer, useViewer } from '@pascal-app/viewer';
import { ArchitectureEnvelope } from './pascal-architecture.jsx';
import { DesignLighting } from './pascal-design-lighting.jsx';
import { LandscapeViewportBridge } from './pascal-landscape-viewport.jsx';
import { ProjectCamera } from './pascal-project-camera.jsx';
import { DeliveryRenderBudget } from './pascal-render-budget.jsx';
import { ProceduralFurniture } from './pascal-furniture.jsx';
import { SceneLabels } from './pascal-scene-labels.jsx';
import { showViewerFallback, ViewerLifecycle } from './pascal-viewer-lifecycle.jsx';

class ViewerBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    showViewerFallback();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function PascalScene({ payload }) {
  const [highlighted, setHighlighted] = useState(new Set());
  useEffect(() => {
    document.body.dataset.renderProfile = 'professional-archviz-v2';
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
      renderContext="viewer"
      sceneReadyKey={payload.sceneHash || payload.revision}
      sceneReadyMaxWaitMs={12_000}
      onSceneReadyChange={(ready) => {
        if (!ready) return;
        const restoreCamera = () => {
          window.dispatchEvent(new CustomEvent('pascal-reset-camera', {
            detail: { automatic: true },
          }));
          window.dispatchEvent(new CustomEvent('pascal-viewer-warmup'));
        };
        restoreCamera();
        requestAnimationFrame(() => {
          restoreCamera();
          requestAnimationFrame(restoreCamera);
        });
        window.setTimeout(restoreCamera, 180);
        window.setTimeout(restoreCamera, 520);
        window.setTimeout(restoreCamera, 1_100);
        window.setTimeout(restoreCamera, 1_800);
      }}
    >
      <DeliveryRenderBudget />
      <ViewerLifecycle />
      <LandscapeViewportBridge />
      <DesignLighting payload={payload} />
      <ProjectCamera payload={payload} />
      <ArchitectureEnvelope payload={payload} />
      <ProceduralFurniture highlighted={highlighted} items={payload.furniture || []} materials={payload.designQuality?.materials || []} />
      <SceneLabels payload={payload} />
    </Viewer>
  </ViewerBoundary>;
}

function start() {
  const source = document.getElementById('pascal-scene');
  const target = document.getElementById('scene');
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
      colorPreset: 'clay', edges: 'off', shadows: true, sceneTheme: 'paper',
      transparentBackground: true, unit: 'metric', unitExplicit: true, textures: false,
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
        window.dispatchEvent(new CustomEvent('pascal-camera-mode', { detail: mode }));
        return true;
      },
      setCameraShot(cameraId) {
        if (!payload.designQuality?.cameras?.some((entry) => entry.cameraId === cameraId)) return false;
        useViewer.getState().setCameraMode('perspective');
        window.dispatchEvent(new CustomEvent('pascal-camera-shot', { detail: cameraId }));
        return true;
      },
      resetCamera() {
        useViewer.getState().setCameraMode('perspective');
        window.dispatchEvent(new CustomEvent('pascal-camera-mode', { detail: 'perspective' }));
        window.dispatchEvent(new CustomEvent('pascal-reset-camera'));
        return true;
      },
      warmup() {
        window.dispatchEvent(new CustomEvent('pascal-viewer-warmup'));
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
    showViewerFallback();
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
