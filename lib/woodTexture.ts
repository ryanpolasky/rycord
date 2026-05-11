"use client";

import * as THREE from "three";

// Procedural wood textures shared across the room. Generated once, cached
// per (base, dark, planks, repeat) key so we don't burn canvas time per mesh.

const cache = new Map<string, THREE.CanvasTexture>();

export function makeWoodTexture(opts: {
  base: string;
  dark: string;
  repeatX?: number;
  repeatY?: number;
  planks?: number;
  size?: number;
}): THREE.CanvasTexture {
  const base = opts.base;
  const dark = opts.dark;
  const repeatX = opts.repeatX ?? 1;
  const repeatY = opts.repeatY ?? 1;
  const planks = opts.planks ?? 6;
  const size = opts.size ?? 1024;
  const key = `${base}|${dark}|${planks}|${repeatX}|${repeatY}|${size}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  const plankH = size / planks;
  for (let i = 0; i < planks; i++) {
    const y = i * plankH;
    const shadeAmt = (Math.random() - 0.5) * 0.16;
    ctx.fillStyle = shade(base, shadeAmt);
    ctx.fillRect(0, y, size, plankH);
    // dark seam
    ctx.fillStyle = dark;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(0, y, size, 1.5);
    ctx.globalAlpha = 1;
  }

  // long grain lines
  ctx.strokeStyle = "rgba(0,0,0,0.06)";
  ctx.lineWidth = 0.7;
  const grainCount = Math.round((size / 4) * 0.9);
  for (let i = 0; i < grainCount; i++) {
    const y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x < size; x += 12) {
      ctx.lineTo(x, y + (Math.random() - 0.5) * 1.2);
    }
    ctx.stroke();
  }

  // knots
  const knotCount = Math.max(3, Math.round(planks * 0.8));
  for (let i = 0; i < knotCount; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 6 + Math.random() * 14;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, dark);
    g.addColorStop(0.7, shade(dark, 0.08));
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.4, r, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
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
