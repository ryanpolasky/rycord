"use client";

import * as THREE from "three";
import { useMemo } from "react";

// The "cozy room" — wood floor in front, plaster wall behind, baseboard
// between, area rug under the shelf. Visible at the edges of the frame, gives
// the shelf somewhere to LIVE.

const FLOOR_W = 24;
const FLOOR_D = 24;
const WALL_W = 24;
const WALL_H = 10;

export default function Room() {
  // Darker walnut floor — one continuous texture across the full plane.
  const floorTex = useMemo(
    () => makeFloorWoodTexture("#5e3a23", "#3a2010"),
    [],
  );
  const wallTex = useMemo(() => makePlasterTexture("#7a6452"), []);
  const rugTex = useMemo(() => makeRugTexture(), []);

  // Clamp instead of repeating so the plank pattern cannot stamp visible bands.
  const floorTexTiled = useMemo(() => {
    const t = floorTex.clone();
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.repeat.set(1, 1);
    t.needsUpdate = true;
    return t;
  }, [floorTex]);

  // Same mirror+integer idea for the wall plaster — much less visible
  // since plaster has no oriented structure, but free defense against the
  // same class of "I can see the tile" issue.
  const wallTexTiled = useMemo(() => {
    const t = wallTex.clone();
    t.wrapS = THREE.MirroredRepeatWrapping;
    t.wrapT = THREE.MirroredRepeatWrapping;
    t.repeat.set(3, 3);
    t.needsUpdate = true;
    return t;
  }, [wallTex]);

  return (
    <group>
      {/* Wood floor — oversized so the side view never sees its edge. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.18, 0.4]} receiveShadow>
        <planeGeometry args={[FLOOR_W, FLOOR_D]} />
        <meshStandardMaterial map={floorTexTiled} roughness={0.82} metalness={0.04} />
      </mesh>

      {/* Back wall — dusty deep plaster with a hint of texture, behind everything */}
      <mesh position={[0, 0.5, -0.5]} receiveShadow>
        <planeGeometry args={[WALL_W, WALL_H]} />
        <meshStandardMaterial map={wallTexTiled} color="#5a4332" roughness={1.0} />
      </mesh>

      {/* baseboard trim — thin warm-painted strip along the floor/wall seam */}
      <mesh position={[0, -0.16, -0.485]} receiveShadow>
        <boxGeometry args={[WALL_W, 0.05, 0.012]} />
        <meshStandardMaterial color="#6b5240" roughness={0.9} />
      </mesh>

      {/* Area rug — sits just in front of the shelf, parallel to the wall so
          it actually looks placed (vs. crooked). Wider than it is deep, which
          matches how a real rug under a shelf is laid. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.179, 0.35]}
        receiveShadow
      >
        <planeGeometry args={[1.2, 0.62]} />
        <meshStandardMaterial map={rugTex} roughness={1.0} />
      </mesh>
    </group>
  );
}

function makeFloorWoodTexture(base: string, dark: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 2048;
  c.height = 2048;
  const ctx = c.getContext("2d")!;

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, c.width, c.height);

  const plankRows = 56;
  const plankH = c.height / plankRows;
  for (let row = 0; row < plankRows; row++) {
    const y = Math.floor(row * plankH);
    const h = Math.ceil((row + 1) * plankH) - y;
    ctx.fillStyle = shade(base, (Math.random() - 0.5) * 0.05);
    ctx.fillRect(0, y, c.width, h);

    if (row > 0) {
      ctx.fillStyle = dark;
      ctx.globalAlpha = 0.16;
      ctx.fillRect(0, y, c.width, 1);
      ctx.globalAlpha = 1;
    }

    let x = ((row % 3) / 3) * c.width * 0.22 + Math.random() * c.width * 0.05;
    while (x < c.width) {
      const seamH = Math.max(8, h - 8);
      ctx.fillStyle = dark;
      ctx.globalAlpha = 0.08;
      ctx.fillRect(Math.floor(x), y + 4, 1, seamH);
      ctx.globalAlpha = 1;
      x += c.width * (0.14 + Math.random() * 0.08);
    }
  }

  ctx.strokeStyle = "rgba(0,0,0,0.045)";
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 420; i++) {
    const y = Math.random() * c.height;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= c.width; x += 18) {
      ctx.lineTo(x, y + (Math.random() - 0.5) * 1.4);
    }
    ctx.stroke();
  }

  for (let i = 0; i < 28; i++) {
    const x = Math.random() * c.width;
    const y = Math.random() * c.height;
    const r = 10 + Math.random() * 20;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, shade(dark, 0.04));
    g.addColorStop(0.72, shade(dark, 0.1));
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.8, r, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(1, 1);
  tex.anisotropy = 16;
  tex.needsUpdate = true;
  return tex;
}

// soft mottled plaster — wash from upper-left
function makePlasterTexture(base: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 512);

  // mottled noise
  const img = ctx.getImageData(0, 0, 512, 512);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 22;
    d[i] = clamp255(d[i] + n);
    d[i + 1] = clamp255(d[i + 1] + n);
    d[i + 2] = clamp255(d[i + 2] + n);
  }
  ctx.putImageData(img, 0, 0);

  // dim from upper-right toward lower-left, like the room falls into shadow
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, "rgba(40, 30, 20, 0.05)");
  grad.addColorStop(1, "rgba(20, 10, 5, 0.32)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// dusty rose + sage wool rug with subtle striped pattern
function makeRugTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 320;
  const ctx = c.getContext("2d")!;

  // wool base — warm dusty pink
  ctx.fillStyle = "#b8806f";
  ctx.fillRect(0, 0, 512, 320);

  // horizontal weave stripes (like a kilim)
  for (let y = 0; y < 320; y += 18) {
    ctx.fillStyle = y % 36 === 0 ? "#a86c5c" : "#c79284";
    ctx.globalAlpha = 0.32;
    ctx.fillRect(0, y, 512, 9);
    ctx.globalAlpha = 1;
  }

  // sage accent border
  ctx.fillStyle = "#7e9078";
  ctx.fillRect(0, 0, 512, 14);
  ctx.fillRect(0, 306, 512, 14);
  ctx.fillRect(0, 0, 18, 320);
  ctx.fillRect(494, 0, 18, 320);

  // diamond pattern in the middle
  ctx.strokeStyle = "rgba(60, 40, 30, 0.35)";
  ctx.lineWidth = 1;
  for (let x = 60; x < 460; x += 50) {
    ctx.beginPath();
    ctx.moveTo(x, 160);
    ctx.lineTo(x + 25, 130);
    ctx.lineTo(x + 50, 160);
    ctx.lineTo(x + 25, 190);
    ctx.closePath();
    ctx.stroke();
  }

  // wool noise — speckled fibre
  const img = ctx.getImageData(0, 0, 512, 320);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 30;
    d[i] = clamp255(d[i] + n);
    d[i + 1] = clamp255(d[i + 1] + n);
    d[i + 2] = clamp255(d[i + 2] + n);
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function clamp255(v: number) {
  return Math.max(0, Math.min(255, v));
}

function shade(hex: string, amt: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + 255 * amt)));
  const hh = (v: number) => f(v).toString(16).padStart(2, "0");
  return `#${hh(r)}${hh(g)}${hh(b)}`;
}
