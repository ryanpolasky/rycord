"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// Tiny floating dust particles backlit by the imaginary lamp — almost
// invisible, but lend a "there's air in this room" feeling.

const COUNT = 60;

// Dust drift is intentionally slow (per-mote speeds top out at ~0.12 rad/s),
// so a smooth 60fps update is wasted budget on this many particles. Cap at
// ~30fps: the eye reads slow particle drift just as cleanly at 30 as 60,
// but we halve the per-frame matrix-write work + instanceMatrix uploads.
const DUST_UPDATE_INTERVAL = 1 / 30;

export default function DustMotes() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const accum = useRef(0);
  const seeds = useMemo(() => {
    return Array.from({ length: COUNT }, () => ({
      x: (Math.random() - 0.5) * 1.0,
      y: -0.16 + Math.random() * 0.45,
      z: 0.08 + Math.random() * 0.32,
      phase: Math.random() * Math.PI * 2,
      speed: 0.04 + Math.random() * 0.08,
      drift: 0.04 + Math.random() * 0.05,
    }));
  }, []);

  useFrame((state, rawDt) => {
    if (!mesh.current) return;
    accum.current += Math.min(rawDt, 0.1);
    if (accum.current < DUST_UPDATE_INTERVAL) return;
    accum.current = 0;
    const t = state.clock.elapsedTime;
    for (let i = 0; i < COUNT; i++) {
      const s = seeds[i];
      const x = s.x + Math.sin(t * s.speed + s.phase) * s.drift;
      const y = s.y + Math.cos(t * s.speed * 0.7 + s.phase) * 0.03;
      const z = s.z + Math.sin(t * s.speed * 0.5 + s.phase * 1.4) * 0.02;
      dummy.position.set(x, y, z);
      // very subtle dust — tiny sub-millimetre scale, gently pulsing
      dummy.scale.setScalar(0.00025 + Math.sin(t + s.phase) * 0.00008 + 0.00015);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, COUNT]}>
      <sphereGeometry args={[1, 6, 6]} />
      <meshBasicMaterial color="#fff2d6" transparent opacity={0.4} toneMapped={false} />
    </instancedMesh>
  );
}
