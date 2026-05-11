// Runtime state for the hover tooltip. Two input channels feed the same
// floating label:
//   - setHoveredRecord:  VinylRecord spines push a DemoRecord when hovered
//   - setHoveredNote:    generic "eyebrow / main / sub" triple for anything
//                        that isn't a record (e.g. the turntable showing
//                        now-playing). Records take priority if both are set.
// HoverTooltip reads + renders the label. Mouse position is tracked at the
// Scene root so the tooltip can follow the cursor.

"use client";

import { useSyncExternalStore } from "react";
import type { DemoRecord } from "./covers";

export type HoverNote = {
  eyebrow: string;
  main: string;
  sub?: string;
};

type State = {
  record: DemoRecord | null;
  note: HoverNote | null;
  x: number;
  y: number;
  muted: boolean;
};

let state: State = { record: null, note: null, x: 0, y: 0, muted: false };
let mutedUntil = 0;
let muteTimer: ReturnType<typeof setTimeout> | null = null;

const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}

function scheduleMuteEnd() {
  if (muteTimer) clearTimeout(muteTimer);
  const delay = Math.max(0, mutedUntil - Date.now());
  muteTimer = setTimeout(() => {
    muteTimer = null;
    if (Date.now() < mutedUntil) {
      scheduleMuteEnd();
      return;
    }
    mutedUntil = 0;
    if (!state.muted) return;
    state = { ...state, muted: false };
    emit();
  }, delay);
}

export function clearHover() {
  if (!state.record && !state.note) return;
  state = { ...state, record: null, note: null };
  emit();
}

export function muteHoverFor(ms: number) {
  mutedUntil = Math.max(mutedUntil, Date.now() + ms);
  scheduleMuteEnd();
  if (state.muted && !state.record && !state.note) return;
  state = { ...state, record: null, note: null, muted: true };
  emit();
}

export function setHoveredRecord(rec: DemoRecord | null) {
  if (state.muted && rec) return;
  if (state.record === rec) return;
  state = { ...state, record: rec };
  emit();
}

export function setHoveredNote(note: HoverNote | null) {
  if (state.muted && note) return;
  // Shallow-equality short-circuit so repeated pointermove events don't
  // spam listeners with the same note object.
  const prev = state.note;
  if (
    prev === note ||
    (prev !== null &&
      note !== null &&
      prev.eyebrow === note.eyebrow &&
      prev.main === note.main &&
      prev.sub === note.sub)
  ) {
    return;
  }
  state = { ...state, note };
  emit();
}

export function setHoverPos(x: number, y: number) {
  state = { ...state, x, y };
  emit();
}

export function getHoverState(): State {
  return state;
}

export function useHoverState(): State {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getHoverState,
    getHoverState,
  );
}
