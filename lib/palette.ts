// Server-side palette extraction from an image buffer.
//
// We feed the image through sharp, downsample to 48x48, and pick three colors:
//   bg     — dark average (background of the spine + cover-tinting)
//   ink    — light average (lettering, accents)
//   accent — most-saturated pixel from the mid-luminance band
// These are the same three slots the procedural covers/spines already use,
// so we can drop real-image-derived palettes into the existing pipeline with
// zero changes downstream.

import "server-only";
import sharp from "sharp";

export type Palette = { bg: string; ink: string; accent: string };

export async function paletteFromImage(buf: ArrayBuffer | Buffer): Promise<Palette> {
  const input = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const { data, info } = await sharp(input)
    .resize(48, 48, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  const N = info.width * info.height;
  type Px = [number, number, number, number]; // r,g,b,lum
  const pixels: Px[] = new Array(N);
  for (let i = 0; i < N; i++) {
    const o = i * channels;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    pixels[i] = [r, g, b, lum];
  }

  pixels.sort((a, b) => a[3] - b[3]);

  // Average the bottom 30% for bg (the deepest shadows of the cover).
  const bgEnd = Math.max(1, Math.floor(N * 0.30));
  const bg = avgColor(pixels.slice(0, bgEnd));

  // Average the top 20% for ink. Cap brightness so very-blown highlights
  // don't push it to pure white (looks too clinical on a paper cover).
  const inkStart = Math.floor(N * 0.80);
  let ink = avgColor(pixels.slice(inkStart));
  ink = clampBrightness(ink, 235);

  // Accent: highest-saturation pixel in the mid-luminance band.
  const midStart = Math.floor(N * 0.30);
  const midEnd = Math.floor(N * 0.80);
  const mid = pixels.slice(midStart, midEnd);
  mid.sort((a, b) => sat(b[0], b[1], b[2]) - sat(a[0], a[1], a[2]));
  // Pick top-3 most saturated and average — single most-saturated pixel can
  // be noise.
  const accent = avgColor(mid.slice(0, 3).length ? mid.slice(0, 3) : [pixels[Math.floor(N / 2)]]);

  return {
    bg: toHex(bg),
    ink: toHex(ink),
    accent: toHex(accent),
  };
}

type RGB = { r: number; g: number; b: number };

function avgColor(px: [number, number, number, number][]): RGB {
  if (px.length === 0) return { r: 0, g: 0, b: 0 };
  let r = 0, g = 0, b = 0;
  for (const p of px) {
    r += p[0]; g += p[1]; b += p[2];
  }
  return { r: r / px.length, g: g / px.length, b: b / px.length };
}

function sat(r: number, g: number, b: number): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function clampBrightness(c: RGB, max: number): RGB {
  const m = Math.max(c.r, c.g, c.b);
  if (m <= max) return c;
  const s = max / m;
  return { r: c.r * s, g: c.g * s, b: c.b * s };
}

function toHex({ r, g, b }: RGB): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}
