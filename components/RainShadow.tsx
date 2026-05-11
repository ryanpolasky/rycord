"use client";

import * as THREE from "three";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";

// A translucent ripple-textured plane just in front of the wall, slowly
// drifting upward and offsetting horizontally — reads as the shadow of
// rain running down a window, cast onto the back wall. Almost invisible
// but breaks the static "baked" feel of the scene.
//
// Uses straight NormalBlending of an RGBA texture with a transparent
// background and dark streaks. MultiplyBlending was leaking the texture's
// background color through and washing the wall out.

export default function RainShadow() {
  const meshRef = useRef<THREE.Mesh>(null);
  const tex = useMemo(() => makeRainTexture(), []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    tex.offset.set(Math.sin(t * 0.04) * 0.03, -t * 0.018);
  });

  return (
    <mesh ref={meshRef} position={[-0.4, 0.6, -0.48]} renderOrder={1}>
      <planeGeometry args={[5.5, 3]} />
      <meshBasicMaterial
        map={tex}
        transparent
        opacity={0.35}
        depthWrite={false}
      />
    </mesh>
  );
}

function makeRainTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext("2d")!;

  // Fully transparent background — alpha 0 everywhere by default.
  // We DRAW only the dark streaks + drops, which become a darkening overlay
  // on whatever's behind them.
  ctx.clearRect(0, 0, 512, 512);

  // vertical streaks at varying widths, like water trails on glass
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * 512;
    const w = 1 + Math.random() * 2.5;
    const startY = Math.random() * 512;
    const len = 40 + Math.random() * 180;
    const grad = ctx.createLinearGradient(x, startY, x, startY + len);
    grad.addColorStop(0, "rgba(8,6,4,0)");
    grad.addColorStop(0.5, `rgba(8,6,4,${0.55 + Math.random() * 0.3})`);
    grad.addColorStop(1, "rgba(8,6,4,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(x, startY, w, len);
  }

  // a few crisp drops
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    ctx.fillStyle = "rgba(8,6,4,0.55)";
    ctx.beginPath();
    ctx.ellipse(x, y, 1.5, 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  tex.needsUpdate = true;
  return tex;
}
