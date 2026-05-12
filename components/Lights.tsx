"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// All the room lighting in one place, with subtle animation so the scene
// reads as "alive" not "baked." Cozy moody mix:
//
//   1. cool rainy-window key from upper-left (soft, gentle pulse)
//   2. warm lamp point light from off-camera right (subtle flicker, like
//      incandescent + slight position drift, like the lamp is rocking)
//   3. warm fill from front-left (lamp bounce off facing pages of records)
//   4. dim warm ambient
//
// The rain-shadow swipe (translucent ripple plane on the wall) lives in
// Scene.tsx because it's a mesh; this file is lights only.

// All the oscillators below are slow (<1Hz on average, fastest is 9Hz on the
// lamp's micro-wobble). Updating their intensities every frame at 60fps is
// wasteful — the human eye can't distinguish a smooth 60fps sine from a
// 20fps stepped one at these frequencies. Throttling the body of useFrame
// to ~20fps (every ~50ms) gives us a 3× reduction in light-update work
// without any perceptible difference to the room's "breathing" feel.
const LIGHTS_UPDATE_INTERVAL = 1 / 20;

export default function Lights() {
  const lamp = useRef<THREE.PointLight>(null);
  const lampFill = useRef<THREE.PointLight>(null);
  const key = useRef<THREE.DirectionalLight>(null);
  // Accumulator for the 20fps throttle. We hold off applying the next
  // intensity update until at least LIGHTS_UPDATE_INTERVAL has elapsed.
  const accum = useRef(0);

  useFrame((state, rawDt) => {
    accum.current += Math.min(rawDt, 0.1);
    if (accum.current < LIGHTS_UPDATE_INTERVAL) return;
    accum.current = 0;
    const t = state.clock.elapsedTime;

    // Warm lamp — incandescent flicker (slow + a tiny faster wobble)
    if (lamp.current) {
      const slow = Math.sin(t * 0.55) * 0.08;
      const fast = Math.sin(t * 4.3 + 1.5) * 0.03 + Math.sin(t * 9.1 + 0.3) * 0.014;
      lamp.current.intensity = 1.75 + slow + fast;
      lamp.current.position.x = 0.55 + Math.sin(t * 0.3) * 0.012;
    }

    if (lampFill.current) {
      lampFill.current.intensity = 0.4 + Math.sin(t * 0.55 + 1.3) * 0.05;
    }

    if (key.current) {
      // rainy-window key — almost just a fill now, slow cloud pulse
      key.current.intensity = 0.32 + Math.sin(t * 0.18) * 0.07 + Math.sin(t * 0.07) * 0.04;
    }
  });

  return (
    <>
      {/* dim cool rainy-window fill. Shadow map at 1024² — the previous
          2048² was overkill for a sub-1m room and quadrupled the shadow
          fragment work every frame for no visible gain. */}
      <directionalLight
        ref={key}
        position={[-2.2, 2.0, 1.4]}
        intensity={0.32}
        color="#b8c1d0"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={0.1}
        shadow-camera-far={12}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={3}
        shadow-camera-bottom={-3}
        shadow-bias={-0.0006}
        shadow-radius={6}
      />

      {/* warm lamp from off-camera right — closer to the shelf so the cell
          interior gets lit. This is the "cozy" centerpiece light.
          NOTE: castShadow intentionally OMITTED here. PointLight shadow
          maps require a cube map (6 faces), so enabling shadows on this
          light alone costs 6× a directional. The DirectionalLight key
          above already handles the room's primary shadow language; the
          lamp's role is warmth/glow, not silhouette definition. */}
      <pointLight
        ref={lamp}
        position={[0.55, 0.0, 0.35]}
        intensity={1.75}
        color="#f5a655"
        distance={1.8}
        decay={1.35}
      />

      {/* warm fill from front-left — bouncing off facing pages */}
      <pointLight
        ref={lampFill}
        position={[-0.45, 0.0, 0.4]}
        intensity={0.4}
        color="#f4cc92"
        distance={1.1}
        decay={1.5}
      />

      {/* a tiny rim from the upper-left, like a wall sconce */}
      <pointLight
        position={[-1.1, 0.55, 0.4]}
        intensity={0.32}
        color="#e8b06a"
        distance={1.8}
        decay={1.4}
      />

      {/* Warm hemisphere fill — lifts the floor evenly across its full extent
          so we don't get the dark-edge / bright-under-the-rug split caused by
          the warm lamp's point-light falloff. Because hemisphere lights weight
          by surface normal, this hits the FLOOR (normal +Y) at full strength
          while only contributing half to the back wall (normal +Z, side-on),
          which preserves the moody contrast on the wall behind the shelf.
          Sky color matches the floor's wood tone so the fill reads as
          "ambient wood bounce" rather than an obvious extra lamp. */}
      <hemisphereLight color="#8c5d3e" groundColor="#0e0805" intensity={0.55} />

      {/* very dim warm ambient — just enough so deep shadows aren't pure black */}
      <ambientLight intensity={0.14} color="#e8c89a" />
    </>
  );
}
