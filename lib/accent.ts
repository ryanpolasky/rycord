// =============================================================================
// rycord accent — single source of truth for the addressable LED strip
// tucked under the top of the shelf. Each LED is independently colored
// every frame, which lets us drive patterns (chase, rainbow, breath, etc.)
// without any extra plumbing.
// =============================================================================

import type { Color as ThreeColor } from "three";
import { getActiveColor, getActiveIntensity } from "./ledStore";

// Base accent color used by static / breath / chase patterns. Swap freely.
//   #2dd4ff — cyan/teal (default)
//   #a855f7 — violet
//   #f06aa8 — hot pink
//   #4ade80 — neon mint
//   #ff8a3d — sodium orange (warm-on-warm, very subtle)
export const ACCENT_COLOR = "#2dd4ff";

// Secondary color used by the "split" pattern (and some cycle modes).
export const ACCENT_SECONDARY = "#f06aa8";

// 0..3-ish — bloom-glow intensity multiplier on the LEDs.
export const ACCENT_INTENSITY = 1.4;

// How many addressable LEDs to draw per shelf cell.
export const LEDS_PER_CELL = 32;

// Which pattern to render. "cycle" rotates through the named modes every
// `PATTERN_CYCLE_SECONDS` so you see them all without picking one. The
// default is "rainbow" — a fixed left-to-right red→violet gradient that
// reads like a cheap chinesium RGB strip's rainbow preset. The user can
// switch via the on-shelf-rug remote.
// Pattern set — the four "specialty" categories on the remote each cycle
// through PALETTE-flavored variants when you press the same key repeatedly.
// The user's mental model is: pick a vibe (FLASH/STROBE/FADE/SMOOTH),
// then mash the button to cycle through warm/cool/pastel/etc. versions
// of that vibe.
//
//   FLASH variants:  hard on/off strobing
//     strobeWhite  — bright white blink
//     strobeWarm   — cycles red/orange/yellow per pulse (sunset disco)
//     strobeCool   — cycles cyan/blue/violet per pulse (rave)
//
//   STROBE variants: bright moving pulse waves
//     pulseRainbow — pulse running L→R, rainbow-tinted
//     pulsePastel  — same wave with pastel palette (washed pinks/mints/blues)
//     pulseNeon    — same wave with high-sat neon palette
//
//   FADE variants:   slowly-sliding spatial gradients
//     fadeRainbow  — full red→violet gradient sliding (the original room default)
//     fadeWarm     — red→orange→yellow gradient sliding
//     fadeCool     — cyan→blue→violet gradient sliding
//     fadeSunset   — peach→amber→rose→peach loop (warm pastels)
//
//   SMOOTH variants: rainbow ANIMATIONS (kinetic)
//     rainbow         — classic spatial rainbow with slow hue drift [room default]
//     rainbowBand     — denser hue wraps, faster slide
//     rainbowBreath   — rainbow with strip-wide breath in/out
//     rainbowChase    — rainbow comet bouncing across the strip
//     rainbowPastel   — pastel rainbow (lo-sat) drifting
//
// Plus the base modes used by `cycle`:
//   static, chase, breath, split, rainbow
export type Pattern =
  | "static"
  | "chase"
  | "rainbow"
  | "rainbowBand"
  | "rainbowBreath"
  | "rainbowChase"
  | "rainbowPastel"
  | "breath"
  | "split"
  | "cycle"
  | "strobeWhite"
  | "strobeWarm"
  | "strobeCool"
  | "pulseRainbow"
  | "pulsePastel"
  | "pulseNeon"
  | "fadeRainbow"
  | "fadeWarm"
  | "fadeCool"
  | "fadeSunset";
export const PATTERN: Pattern = "rainbow";

// Seconds spent on each pattern in "cycle" mode before the next one.
export const PATTERN_CYCLE_SECONDS = 16;

// =============================================================================
// Pattern evaluator — pure function, runs once per LED per frame.
// =============================================================================

// HSL→RGB used for the rainbow pattern. (Three's color.setHSL works fine here.)
function setHSL(out: ThreeColor, h: number, s: number, l: number) {
  out.setHSL(h, s, l);
}

// hex → number triple so we can multiply scalars cheaply
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const SECONDARY_RGB = hexToRgb(ACCENT_SECONDARY);

// modes used by `cycle` (kept short so the demo loop covers all of them)
const CYCLE_ORDER: Pattern[] = ["static", "breath", "chase", "rainbow", "split"];

/**
 * Fill `out` with the color this LED should be at this time.
 *
 * The primary accent + intensity are read from the runtime LED store every
 * call, so when the user clicks a color on the remote the strip updates on
 * the next frame.
 *
 * @param i      LED index in this strip
 * @param n      total LEDs in this strip
 * @param t      time in seconds since scene start
 * @param mode   pattern mode (or "cycle" to rotate through them)
 */
export function evalPattern(out: ThreeColor, i: number, n: number, t: number, mode: Pattern = PATTERN) {
  const accentRgb = hexToRgb(getActiveColor());
  const intensity = getActiveIntensity();

  if (mode === "cycle") {
    const idx = Math.floor(t / PATTERN_CYCLE_SECONDS) % CYCLE_ORDER.length;
    // smooth crossfade across pattern boundaries so it doesn't snap
    const local = (t % PATTERN_CYCLE_SECONDS) / PATTERN_CYCLE_SECONDS;
    const fade = local > 0.92 ? 1 - (local - 0.92) / 0.08 : local < 0.08 ? local / 0.08 : 1;
    evalPattern(out, i, n, t, CYCLE_ORDER[idx]);
    out.multiplyScalar(fade);
    return;
  }

  const u = n > 1 ? i / (n - 1) : 0.5;

  if (mode === "static") {
    out.setRGB(accentRgb[0], accentRgb[1], accentRgb[2]);
    out.multiplyScalar(intensity);
    return;
  }

  if (mode === "breath") {
    const b = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 1.4));
    out.setRGB(accentRgb[0], accentRgb[1], accentRgb[2]);
    out.multiplyScalar(b * intensity * 1.1);
    return;
  }

  if (mode === "chase") {
    // a comet of light running back and forth across the strip
    const p = 0.5 + 0.5 * Math.sin(t * 1.1);
    const d = Math.abs(u - p);
    const g = Math.exp(-d * d * 80) * 1.4 + 0.05;
    out.setRGB(accentRgb[0], accentRgb[1], accentRgb[2]);
    out.multiplyScalar(g * intensity);
    return;
  }

  if (mode === "rainbow") {
    // Animated spatial rainbow — the gradient (red at left, violet at
    // right) slides across the strip over time. ~10s per hue rotation.
    // Faster than the FADE variants so SMOOTH reads as the more
    // kinetic, alive sibling of the slower drift on FADE.
    const hue = (u * 0.83 + t * 0.11) % 1;
    setHSL(out, hue, 0.85, 0.55);
    out.multiplyScalar(intensity);
    return;
  }

  if (mode === "split") {
    // a wiping boundary moves left/right, primary on left, secondary on right
    const split = 0.5 + 0.35 * Math.sin(t * 0.7);
    const blend = smooth01((u - split) * 18 + 0.5);
    out.setRGB(
      accentRgb[0] * (1 - blend) + SECONDARY_RGB[0] * blend,
      accentRgb[1] * (1 - blend) + SECONDARY_RGB[1] * blend,
      accentRgb[2] * (1 - blend) + SECONDARY_RGB[2] * blend,
    );
    out.multiplyScalar(intensity);
    return;
  }

  // ===== FLASH category — hard on/off transitions, palette varies =====

  if (mode === "strobeWhite") {
    // hard white strobe; the entire strip flips on/off at ~5Hz
    const on = (Math.floor(t * 10) % 2) === 0;
    const v = on ? 1.6 : 0.04;
    out.setRGB(v, v, v);
    out.multiplyScalar(intensity);
    return;
  }

  if (mode === "strobeWarm") {
    // hard strobe; each pulse picks a random WARM hue (red/orange/yellow).
    // bucket pulses by time so all LEDs flash the same color per beat.
    const bucket = Math.floor(t * 9);
    const on = bucket % 2 === 0;
    const hue = pickPaletteHue(WARM_HUES, bucket);
    if (on) {
      setHSL(out, hue, 1.0, 0.6);
      out.multiplyScalar(1.6 * intensity);
    } else {
      out.setRGB(0.04, 0.02, 0.02);
      out.multiplyScalar(intensity);
    }
    return;
  }

  if (mode === "strobeCool") {
    // same as strobeWarm but COOL hues (cyan/blue/violet/magenta)
    const bucket = Math.floor(t * 9);
    const on = bucket % 2 === 0;
    const hue = pickPaletteHue(COOL_HUES, bucket);
    if (on) {
      setHSL(out, hue, 1.0, 0.6);
      out.multiplyScalar(1.6 * intensity);
    } else {
      out.setRGB(0.02, 0.02, 0.04);
      out.multiplyScalar(intensity);
    }
    return;
  }

  // ===== STROBE category — bright moving pulse waves, palette varies =====

  if (mode === "pulseRainbow") {
    // bright pulse runs L→R with rainbow tint
    const p = (t * 0.85) % 1.2 - 0.1;
    const d = Math.abs(u - p);
    const g = Math.exp(-d * d * 50) * 1.8;
    const hue = (p + t * 0.15) % 1;
    setHSL(out, hue, 1.0, 0.55);
    const strobe = (Math.floor(t * 14) % 2) === 0 ? 1.0 : 0.4;
    out.multiplyScalar(g * strobe * intensity);
    return;
  }

  if (mode === "pulsePastel") {
    // same pulse wave, washed pastel palette (low saturation)
    const p = (t * 0.85) % 1.2 - 0.1;
    const d = Math.abs(u - p);
    const g = Math.exp(-d * d * 50) * 1.7;
    const hue = (p + t * 0.10) % 1;
    setHSL(out, hue, 0.45, 0.72);   // low S + high L = pastel
    const strobe = (Math.floor(t * 14) % 2) === 0 ? 1.0 : 0.55;
    out.multiplyScalar(g * strobe * intensity * 1.1);
    return;
  }

  if (mode === "pulseNeon") {
    // same pulse wave, hot neon palette — pinks, cyans, limes, magenta
    const bucket = Math.floor(t * 1.4);
    const hue = pickPaletteHue(NEON_HUES, bucket);
    const p = (t * 0.85) % 1.2 - 0.1;
    const d = Math.abs(u - p);
    const g = Math.exp(-d * d * 40) * 1.9;
    setHSL(out, hue, 1.0, 0.55);
    const strobe = (Math.floor(t * 14) % 2) === 0 ? 1.0 : 0.45;
    out.multiplyScalar(g * strobe * intensity * 1.15);
    return;
  }

  // ===== FADE category — slowly-sliding spatial gradients =====

  if (mode === "fadeRainbow") {
    // full red→violet gradient sliding L→R, ~30s cycle. Identical to the
    // base "rainbow" but with a slower drift for FADE feel.
    const hue = (u * 0.83 + t * 0.033) % 1;
    setHSL(out, hue, 0.85, 0.55);
    out.multiplyScalar(intensity);
    return;
  }

  if (mode === "fadeWarm") {
    // warm gradient: hue stays in red (0) → orange (0.08) → yellow (0.17)
    // band, sliding so the band drifts L→R
    const drift = (u + t * 0.04) % 1;
    const hue = 0.0 + 0.17 * drift;
    setHSL(out, hue, 0.95, 0.55);
    out.multiplyScalar(intensity);
    return;
  }

  if (mode === "fadeCool") {
    // cool gradient: cyan (0.5) → blue (0.65) → violet (0.78), drift
    const drift = (u + t * 0.04) % 1;
    const hue = 0.5 + 0.28 * drift;
    setHSL(out, hue, 0.95, 0.55);
    out.multiplyScalar(intensity);
    return;
  }

  if (mode === "fadeSunset") {
    // peach → amber → rose → peach loop. Crossfade between three keyed
    // colors with smooth blending.
    const drift = (u + t * 0.05) % 1;
    // 3-stop palette (peach, amber, rose) — sample with wrap
    const stops: [number, number, number][] = [
      [1.00, 0.66, 0.48],   // peach
      [1.00, 0.78, 0.32],   // amber
      [0.95, 0.42, 0.55],   // rose
    ];
    const f = drift * stops.length;
    const i0 = Math.floor(f) % stops.length;
    const i1 = (i0 + 1) % stops.length;
    const frac = f - Math.floor(f);
    const c0 = stops[i0];
    const c1 = stops[i1];
    out.setRGB(
      c0[0] * (1 - frac) + c1[0] * frac,
      c0[1] * (1 - frac) + c1[1] * frac,
      c0[2] * (1 - frac) + c1[2] * frac,
    );
    out.multiplyScalar(intensity);
    return;
  }

  // ===== SMOOTH category — animated rainbow variants (kinetic) =====

  if (mode === "rainbowBand") {
    // 2× hue wraps across the strip, sliding faster than default rainbow
    const hue = (u * 1.8 + t * 0.22) % 1;
    setHSL(out, hue, 0.9, 0.55);
    out.multiplyScalar(intensity);
    return;
  }

  if (mode === "rainbowBreath") {
    // the default rainbow gradient breathes — intensity rises and falls
    // smoothly over ~3s. Hue drifts at SMOOTH-tempo (~10s/rotation).
    const hue = (u * 0.83 + t * 0.11) % 1;
    setHSL(out, hue, 0.85, 0.55);
    const breath = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 1.1));
    out.multiplyScalar(breath * intensity * 1.1);
    return;
  }

  if (mode === "rainbowChase") {
    // a bright rainbow comet runs back and forth across the strip
    const p = 0.5 + 0.5 * Math.sin(t * 1.4);
    const d = Math.abs(u - p);
    const g = Math.exp(-d * d * 60) * 1.6 + 0.05;
    const hue = (p + t * 0.18) % 1;
    setHSL(out, hue, 0.95, 0.6);
    out.multiplyScalar(g * intensity);
    return;
  }

  if (mode === "rainbowPastel") {
    // pastel rainbow — low saturation, high lightness. Reads as a soft
    // dreamy sweep instead of the saturated default. SMOOTH-tempo drift.
    const hue = (u * 0.83 + t * 0.11) % 1;
    setHSL(out, hue, 0.45, 0.72);
    out.multiplyScalar(intensity * 1.1);
    return;
  }
}

// Hue palettes used by the strobe color variants. Sampled per-bucket so
// every LED on a given pulse agrees on the color.
const WARM_HUES = [0.00, 0.05, 0.08, 0.12, 0.16];     // red → yellow
const COOL_HUES = [0.50, 0.58, 0.65, 0.72, 0.78];     // cyan → violet
const NEON_HUES = [0.92, 0.50, 0.32, 0.85, 0.18];     // pink, cyan, lime, magenta, gold

function pickPaletteHue(palette: number[], bucket: number): number {
  return palette[((bucket | 0) + palette.length * 1000) % palette.length];
}

// Deterministic noise — good enough for stochastic timing on the strobe
// variants. Same input always returns the same output, so we can sample
// "is this time bucket firing?" without storing state per LED.
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function smooth01(x: number) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * (3 - 2 * x);
}
