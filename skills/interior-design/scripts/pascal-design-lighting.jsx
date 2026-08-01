import React, { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';

export function DesignLighting({ payload }) {
  const exposure = payload.designQuality?.rendering?.exposure || 1;
  const renderer = useThree((state) => state.gl);
  useEffect(() => {
    const previous = renderer.toneMappingExposure;
    renderer.toneMappingExposure = exposure;
    return () => { renderer.toneMappingExposure = previous; };
  }, [exposure, renderer]);
  return <group name="personal-agent-design-lighting">
    {(payload.designQuality?.lights || []).map((light) => <DesignLight key={light.lightId} light={light} />)}
  </group>;
}

function DesignLight({ light }) {
  if (light.kind === 'ambient' || light.kind === 'hemisphere') {
    return <ambientLight color={light.color} intensity={Math.min(light.intensity, 2.5)} />;
  }
  if (light.kind === 'point') {
    return <pointLight
      color={light.color}
      decay={2}
      distance={14}
      intensity={Math.min(light.intensity, 120)}
      position={light.position || [0, 3, 0]}
    />;
  }
  return <DirectedLight light={light} />;
}

function DirectedLight({ light }) {
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
    <spotLight angle={Math.PI / 5} color={light.color} decay={2} distance={18}
      intensity={Math.min(light.intensity, 160)} penumbra={0.55} position={position} ref={source} />
  </>;
  return <>
    <object3D position={targetPosition} ref={target} />
    <directionalLight color={light.color} intensity={Math.min(light.intensity, 8)} position={position} ref={source} />
  </>;
}
