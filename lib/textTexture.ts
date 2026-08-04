import * as THREE from "three";

// troika renders text by generating SDFs in its own private WebGL1 context,
// which hard-requires ANGLE_instanced_arrays. anti-fingerprinting browsers
// refuse that extension, and troika's "JS fallback" still needs WebGL for the
// final blit, so it dies too. canvas 2d has no such dependency.

// rasterised height of one line; world size is derived from this
const FONT_PX = 64;
const PAD_PX = 8;
const MAX_CANVAS_PX = 2048;

const DEFAULT_FONT_FAMILY =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export type TextTextureOptions = {
  text: string;
  // world units per line
  fontSize: number;
  color: string;
  // world units; enables word wrapping when set
  maxWidth?: number;
  lineHeight?: number;
  // em, matching troika's units
  letterSpacing?: number;
  fontFamily?: string;
  fontWeight?: string | number;
  textAlign?: "left" | "center" | "right";
};

export type TextTextureResult = {
  texture: THREE.CanvasTexture;
  width: number;
  height: number;
};

// not in every lib.dom version yet
type SpacingCtx = CanvasRenderingContext2D & { letterSpacing?: string };

function applyFont(
  ctx: SpacingCtx,
  fontWeight: string | number,
  fontFamily: string,
  spacingPx: number,
) {
  ctx.font = `${fontWeight} ${FONT_PX}px ${fontFamily}`;
  if (spacingPx !== 0) ctx.letterSpacing = `${spacingPx}px`;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidthPx: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push("");
      continue;
    }
    if (!Number.isFinite(maxWidthPx)) {
      out.push(words.join(" "));
      continue;
    }
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const candidate = `${line} ${words[i]}`;
      if (ctx.measureText(candidate).width <= maxWidthPx) {
        line = candidate;
      } else {
        out.push(line);
        line = words[i];
      }
    }
    out.push(line);
  }
  return out;
}

export function makeTextTexture(opts: TextTextureOptions): TextTextureResult | null {
  if (typeof document === "undefined") return null;

  const {
    text,
    fontSize,
    color,
    maxWidth,
    lineHeight = 1.2,
    letterSpacing = 0,
    fontFamily = DEFAULT_FONT_FAMILY,
    fontWeight = 400,
    textAlign = "left",
  } = opts;

  if (!text || fontSize <= 0) return null;

  const canvas = document.createElement("canvas");
  const measureCtx = canvas.getContext("2d") as SpacingCtx | null;
  if (!measureCtx) return null;

  const spacingPx = letterSpacing * FONT_PX;
  applyFont(measureCtx, fontWeight, fontFamily, spacingPx);

  // canvas pixels per world unit
  const ppu = FONT_PX / fontSize;
  const maxWidthPx = maxWidth ? maxWidth * ppu : Number.POSITIVE_INFINITY;
  const lines = wrapLines(measureCtx, text, maxWidthPx);

  const lineHeightPx = FONT_PX * lineHeight;
  let widest = 0;
  for (const line of lines) {
    if (line === "") continue;
    widest = Math.max(widest, measureCtx.measureText(line).width);
  }

  const canvasW = Math.min(MAX_CANVAS_PX, Math.max(1, Math.ceil(widest + PAD_PX * 2)));
  const canvasH = Math.min(
    MAX_CANVAS_PX,
    Math.max(1, Math.ceil(lines.length * lineHeightPx + PAD_PX * 2)),
  );

  // resizing wipes all context state, so the font has to be reapplied after
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d") as SpacingCtx | null;
  if (!ctx) return null;
  applyFont(ctx, fontWeight, fontFamily, spacingPx);
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.textAlign = textAlign;

  const originX = textAlign === "center" ? canvasW / 2 : textAlign === "right" ? canvasW - PAD_PX : PAD_PX;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === "") continue;
    ctx.fillText(lines[i], originX, PAD_PX + lineHeightPx * (i + 0.5));
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // NPOT without mipmaps is the one combination that is always safe, including
  // on a WebGL1 fallback context
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;

  return { texture, width: canvasW / ppu, height: canvasH / ppu };
}
