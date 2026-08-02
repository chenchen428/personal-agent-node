import React, { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { useDeliveryStyle } from './pascal-materials.jsx';

export function DesignLighting({ payload }) {
  const style = useDeliveryStyle();
  const exposure = style?.lighting?.exposure || payload.designQuality?.rendering?.exposure || 1;
  const renderer = useThree((state) => state.gl);
  useEffect(() => {
    const previous = renderer.toneMappingExposure;
    renderer.toneMappingExposure = exposure;
    return () => { renderer.toneMappingExposure = previous; };
  }, [exposure, renderer]);
  return <group name="personal-agent-design-lighting">
    <hemisphereLight
      args={[style?.lighting?.skyColor || '#edf3ef', style?.lighting?.groundColor || '#897f72', 0.52]}
    />
    {(payload.designQuality?.lights || []).map((light) => <DesignLight key={light.lightId} light={light} style={style} />)}
  </group>;
}

function DesignLight({ light, style }) {
  const lighting = style?.lighting || {};
  const ambientScale = lighting.ambientScale || 1;
  const keyScale = lighting.keyScale || 1;
  if (light.kind === 'ambient' || light.kind === 'hemisphere') {
    return <ambientLight color={lighting.ambientColor || light.color} intensity={Math.min(light.intensity * ambientScale, 2.8)} />;
  }
  if (light.kind === 'point') {
    return <pointLight
      color={lighting.keyColor || light.color}
      decay={2}
      distance={14}
      intensity={Math.min(light.intensity * keyScale, 120)}
      position={light.position || [0, 3, 0]}
    />;
  }
  return <DirectedLight light={light} lighting={lighting} />;
}

function DirectedLight({ light, lighting }) {
  const source = useRef(null);
  const target = useRef(null);
  useEffect(() => {
    if (!source.current || !target.current) return;
    source.current.target = target.current;
    source.current.target.updateMatrixWorld();
  }, []);
  const position = light.position || [4, 8, 4];
  const targetPosition = light.target || [0, 0, 0];
  if (light.kind === 'spot' || light.kind === 'area') return <>
    <object3D position={targetPosition} ref={target} />
    <spotLight angle={Math.PI / 5} color={lighting.keyColor || light.color} decay={2} distance={18}
      intensity={Math.min(light.intensity * (lighting.keyScale || 1), 160)} penumbra={0.55} position={position} ref={source} />
  </>;
  return <>
    <object3D position={targetPosition} ref={target} />
    <directionalLight castShadow color={lighting.keyColor || light.color}
      intensity={Math.min(light.intensity * (lighting.keyScale || 1), 8)} position={position} ref={source}
      shadow-bias={-0.0004} shadow-mapSize-height={2048} shadow-mapSize-width={2048} />
  </>;
}
