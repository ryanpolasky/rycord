"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { PerformanceTier } from "@/lib/performance";

// every oscillator here is under 1hz, so 20fps is indistinguishable from 60
const LIGHTS_UPDATE_INTERVAL = 1 / 20;

export default function Lights({ tier = "high" }: { tier?: PerformanceTier }) {
  const lamp = useRef<THREE.PointLight>(null);
  const lampFill = useRef<THREE.PointLight>(null);
  const key = useRef<THREE.DirectionalLight>(null);
  const accum = useRef(0);

  useFrame((state, rawDt) => {
    accum.current += Math.min(rawDt, 0.1);
    if (accum.current < LIGHTS_UPDATE_INTERVAL) return;
    accum.current = 0;
    const t = state.clock.elapsedTime;

    // incandescent flicker: slow drift plus a faster wobble
    if (lamp.current) {
      const lampBase = tier === "low" ? 2.15 : 1.75;
      const slow = Math.sin(t * 0.55) * 0.08;
      const fast = Math.sin(t * 4.3 + 1.5) * 0.03 + Math.sin(t * 9.1 + 0.3) * 0.014;
      lamp.current.intensity = lampBase + slow + fast;
      lamp.current.position.x = 0.55 + Math.sin(t * 0.3) * 0.012;
    }

    if (lampFill.current) {
      const fillBase = tier === "low" ? 0.55 : tier === "medium" ? 0.25 : 0.4;
      lampFill.current.intensity = fillBase + Math.sin(t * 0.55 + 1.3) * 0.05;
    }

    if (key.current) {
      const keyBase = tier === "low" ? 0.48 : 0.32;
      key.current.intensity = keyBase + Math.sin(t * 0.18) * 0.07 + Math.sin(t * 0.07) * 0.04;
    }
  });

  return (
    <>
      {/* 1024² shadow map; 2048² is invisible in a sub-1m room and 4x the cost */}
      <directionalLight
        ref={key}
        position={[-2.2, 2.0, 1.4]}
        intensity={tier === "low" ? 0.48 : 0.32}
        color="#b8c1d0"
        castShadow={tier !== "low"}
        shadow-mapSize-width={tier === "high" ? 1024 : 512}
        shadow-mapSize-height={tier === "high" ? 1024 : 512}
        shadow-camera-near={0.1}
        shadow-camera-far={12}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={3}
        shadow-camera-bottom={-3}
        shadow-bias={-0.0006}
        shadow-radius={6}
      />

      {/* no castShadow: point light shadows need a 6-face cube map */}
      <pointLight
        ref={lamp}
        position={[0.55, 0.0, 0.35]}
        intensity={tier === "low" ? 2.15 : 1.75}
        color="#f5a655"
        distance={1.8}
        decay={1.35}
      />

      {/* warm fill bouncing off the facing pages */}
      <pointLight
        ref={lampFill}
        position={[-0.45, 0.0, 0.4]}
        intensity={tier === "low" ? 0.55 : tier === "medium" ? 0.25 : 0.4}
        color="#f4cc92"
        distance={tier === "low" ? 1.6 : 1.1}
        decay={1.5}
      />

      {/* wall-sconce rim */}
      {tier === "high" && (
        <pointLight
          position={[-1.1, 0.55, 0.4]}
          intensity={0.32}
          color="#e8b06a"
          distance={1.8}
          decay={1.4}
        />
      )}

      <hemisphereLight color="#a47450" groundColor="#1a0f08" intensity={tier === "low" ? 1.05 : 0.55} />

      {/* just enough that deep shadows aren't pure black */}
      <ambientLight intensity={tier === "low" ? 0.36 : 0.14} color="#f0d2a2" />
    </>
  );
}
