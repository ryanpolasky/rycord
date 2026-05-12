"use client";

import * as THREE from "three";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { LEDS_PER_CELL, evalPattern, ACCENT_INTENSITY } from "@/lib/accent";
import { getLedState } from "@/lib/ledStore";

// An "addressable" LED strip rendered as an InstancedMesh of small bright
// boxes. Each LED gets its own color every frame, fed by the pattern
// evaluator in `lib/accent.ts`. Visually the strip reads like a thin RGB
// bar tucked under the top of the shelf; functionally it's WS2812-style
// — we set N independent colors and the bloom pass blooms them.
//
// Two dim colored point lights at fixed positions along the strip sample
// the LED colors at those positions, so the bounce light onto nearby
// surfaces matches the current pattern (instead of being a static color).

type Props = {
  /** World-space center of the strip. */
  position: [number, number, number];
  /** Strip dimensions [length, height, depth] in meters. */
  size: [number, number, number];
  /** How many LEDs in this strip (override LEDS_PER_CELL). */
  count?: number;
  /** If true, also place 2 bounce point lights along the strip. */
  withLight?: boolean;
  /** Bounce light intensity multiplier (light is sampled from pattern). */
  lightMultiplier?: number;
  /** Bounce light distance. */
  lightDistance?: number;
};

export default function RGBStrip({
  position,
  size,
  count = LEDS_PER_CELL,
  withLight = true,
  lightMultiplier = 1.0,
  lightDistance = 0.8,
}: Props) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const lightA = useRef<THREE.PointLight>(null);
  const lightB = useRef<THREE.PointLight>(null);

  const [length, height, depth] = size;

  // per-LED footprint: divide the strip length into `count` slots, then
  // make each LED box slightly smaller than the slot so there's a tiny
  // gap between them (so you can SEE the LEDs as discrete units, not one bar).
  const slot = length / count;
  const ledW = slot * 0.78;
  const ledH = height;
  const ledD = depth;

  // pre-build the instance matrices so we don't re-allocate every frame
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorScratch = useMemo(() => new THREE.Color(), []);

  // Snapshot of the last paint so we can skip the per-LED loop when nothing
  // has changed AND the active pattern doesn't need a time-axis update. With
  // 32-160 LEDs per strip this is the single largest per-frame allocation in
  // the scene by call count. `static`/disabled patterns repaint exactly once
  // after a state change and then idle at zero cost; time-dependent patterns
  // (breath, chase, rainbow, strobes, etc.) keep painting every frame.
  const lastPaintRef = useRef({
    pattern: "" as string,
    enabled: false,
    color: "",
    intensity: 0,
    initialized: false,
  });

  useEffect(() => {
    if (!ref.current) return;
    const startX = -length / 2 + slot / 2;
    for (let i = 0; i < count; i++) {
      dummy.position.set(startX + i * slot, 0, 0);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      ref.current.setMatrixAt(i, dummy.matrix);
    }
    ref.current.instanceMatrix.needsUpdate = true;
  }, [count, length, slot, dummy]);

  useFrame((sceneState) => {
    if (!ref.current) return;
    const t = sceneState.clock.elapsedTime;
    const ledState = getLedState();
    const { pattern, enabled, color, intensity } = ledState;

    // Time-axis dependence: every pattern except `static` animates over t.
    // When disabled we treat the strip as static-off (one final paint to
    // black, then nothing more until something changes).
    const isTimeDependent = enabled && pattern !== "static";

    const last = lastPaintRef.current;
    const stateChanged =
      !last.initialized ||
      last.pattern !== pattern ||
      last.enabled !== enabled ||
      last.color !== color ||
      last.intensity !== intensity;

    // Skip the entire paint + light update if nothing changed AND the
    // pattern doesn't need temporal updates. This is the hot path when the
    // user has the strip on a solid color or off — the loop was burning
    // 32-160 setColorAt() calls every frame for no visible benefit.
    if (!stateChanged && !isTimeDependent) return;

    // recompute color for every LED this frame
    for (let i = 0; i < count; i++) {
      if (enabled) {
        evalPattern(colorScratch, i, count, t, pattern);
      } else {
        colorScratch.setRGB(0, 0, 0);
      }
      ref.current.setColorAt(i, colorScratch);
    }
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;

    // bounce lights sample the LED color at fixed positions (25% and 75%)
    if (withLight && lightA.current && lightB.current) {
      if (!enabled) {
        lightA.current.intensity = 0;
        lightB.current.intensity = 0;
      } else {
        const sampleA = Math.floor(count * 0.25);
        const sampleB = Math.floor(count * 0.75);
        evalPattern(colorScratch, sampleA, count, t, pattern);
        const iA = colorScratch.r + colorScratch.g + colorScratch.b;
        lightA.current.color.set(colorScratch.r / Math.max(iA, 0.01), colorScratch.g / Math.max(iA, 0.01), colorScratch.b / Math.max(iA, 0.01));
        lightA.current.intensity = Math.min(iA, 3) * 0.35 * lightMultiplier;

        evalPattern(colorScratch, sampleB, count, t, pattern);
        const iB = colorScratch.r + colorScratch.g + colorScratch.b;
        lightB.current.color.set(colorScratch.r / Math.max(iB, 0.01), colorScratch.g / Math.max(iB, 0.01), colorScratch.b / Math.max(iB, 0.01));
        lightB.current.intensity = Math.min(iB, 3) * 0.35 * lightMultiplier;
      }
    }

    last.pattern = pattern;
    last.enabled = enabled;
    last.color = color;
    last.intensity = intensity;
    last.initialized = true;
  });

  return (
    <group position={position}>
      <instancedMesh ref={ref} args={[undefined, undefined, count]} frustumCulled={false}>
        <boxGeometry args={[ledW, ledH, ledD]} />
        {/* meshBasicMaterial: not lit by the scene, so per-LED color reads
            cleanly and bright colors push into bloom thresholds. */}
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      {withLight && (
        <>
          <pointLight
            ref={lightA}
            position={[-length * 0.25, -0.02, 0.03]}
            intensity={ACCENT_INTENSITY * 0.5 * lightMultiplier}
            distance={lightDistance}
            decay={1.7}
          />
          <pointLight
            ref={lightB}
            position={[length * 0.25, -0.02, 0.03]}
            intensity={ACCENT_INTENSITY * 0.5 * lightMultiplier}
            distance={lightDistance}
            decay={1.7}
          />
        </>
      )}
    </group>
  );
}
