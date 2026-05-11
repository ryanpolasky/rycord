// Runtime state for the LED strip. The in-scene RGB remote mutates this; the
// strip + bounce-lights read it every frame via `getLedState()`. Default values
// come from `lib/accent.ts`.

"use client";

import { useSyncExternalStore } from "react";
import { ACCENT_COLOR, ACCENT_INTENSITY, PATTERN, type Pattern } from "./accent";

type State = {
  pattern: Pattern;
  enabled: boolean;
  color: string;          // hex (#rrggbb) — the primary accent
  intensity: number;      // brightness multiplier, ~0.4 to 2.5
  remoteOpen: boolean;    // whether the remote is "summoned" to the foreground
  paperOpen: boolean;     // whether the paper scrap is "picked up" to read
};

let state: State = {
  pattern: PATTERN,
  enabled: true,
  color: ACCENT_COLOR,
  intensity: ACCENT_INTENSITY,
  remoteOpen: false,
  paperOpen: false,
};

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getLedState(): State {
  return state;
}

// Used by accent.ts so per-frame color math doesn't have to round-trip through
// React. These return raw values; if the store doesn't exist on the server,
// callers fall back to the static defaults.
export function getActiveColor(): string {
  return state.color;
}

export function getActiveIntensity(): number {
  return state.intensity;
}

export function setLedPattern(p: Pattern) {
  state = { ...state, pattern: p, enabled: true };
  emit();
}

// Advance to the next pattern in a fixed sequence — used by the FADE
// specialty button on the remote, which acts like a "next preset" button
// on a real chinesium RGB controller. Each press steps once.
const STEP_SEQUENCE: Pattern[] = ["rainbow", "static", "breath", "chase", "split", "cycle"];
export function stepLedPattern() {
  const i = STEP_SEQUENCE.indexOf(state.pattern);
  const next = STEP_SEQUENCE[(i + 1) % STEP_SEQUENCE.length];
  state = { ...state, pattern: next, enabled: true };
  emit();
}

// ============================================================================
// Specialty-button variant cycling.
//
// Each of FLASH / STROBE / FADE / SMOOTH on the remote cycles through
// PALETTE-flavored variants. Pressing the same button advances; pressing
// a different specialty button resets back to that category's variant 0.
// We store one index per category so each button remembers where it is.
//
// 15 distinct LED looks across the four buttons.
// ============================================================================
const FLASH_VARIANTS: Pattern[] = ["strobeWhite", "strobeWarm", "strobeCool"];
const STROBE_VARIANTS: Pattern[] = ["pulseRainbow", "pulsePastel", "pulseNeon"];
const FADE_VARIANTS: Pattern[] = ["fadeRainbow", "fadeWarm", "fadeCool", "fadeSunset"];
const SMOOTH_VARIANTS: Pattern[] = ["rainbow", "rainbowBand", "rainbowBreath", "rainbowChase", "rainbowPastel"];

const variantIdx: Record<"flash" | "strobe" | "fade" | "smooth", number> = {
  flash: -1,
  strobe: -1,
  fade: -1,
  smooth: -1,
};

function stepCategory(cat: "flash" | "strobe" | "fade" | "smooth", variants: Pattern[]) {
  const i = variantIdx[cat];
  const cur = i >= 0 ? variants[i] : null;
  const next = cur !== state.pattern ? variants[0] : variants[(i + 1) % variants.length];
  variantIdx[cat] = variants.indexOf(next);
  state = { ...state, pattern: next, enabled: true };
  emit();
}

export function stepFlash() { stepCategory("flash", FLASH_VARIANTS); }
export function stepStrobe() { stepCategory("strobe", STROBE_VARIANTS); }
export function stepFade() { stepCategory("fade", FADE_VARIANTS); }
export function stepSmooth() { stepCategory("smooth", SMOOTH_VARIANTS); }

export function setLedEnabled(enabled: boolean) {
  state = { ...state, enabled };
  emit();
}

export function setLedColor(color: string) {
  state = { ...state, color, enabled: true };
  emit();
}

export function bumpIntensity(delta: number) {
  state = { ...state, intensity: Math.max(0.2, Math.min(2.6, state.intensity + delta)) };
  emit();
}

// The remote and the paper scrap are both "picked up" pieces of UI that
// float in front of the camera; only one can be held at a time. Opening
// either one automatically dismisses the other so they don't overlap.
export function setRemoteOpen(open: boolean) {
  state = {
    ...state,
    remoteOpen: open,
    paperOpen: open ? false : state.paperOpen,
  };
  emit();
}

export function setPaperOpen(open: boolean) {
  state = {
    ...state,
    paperOpen: open,
    remoteOpen: open ? false : state.remoteOpen,
  };
  emit();
}

export function useLedState(): State {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getLedState,
    getLedState,
  );
}
