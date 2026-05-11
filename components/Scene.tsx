"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useProgress } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { KernelSize } from "postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import Shelf, {
  SHELF_CELL,
  SHELF_CELL_H,
  SHELF_INNER_W,
  SHELF_WALL,
  SHELF_BOTTOM_Y,
  shelfCellCenter,
} from "./Shelf";
import { setPaperOpen, setRemoteOpen, useLedState } from "@/lib/ledStore";
import VinylRecord from "./VinylRecord";
import Room from "./Room";
import RoomProps from "./RoomProps";
import DustMotes from "./DustMotes";
import Lights from "./Lights";
import RainShadow from "./RainShadow";
import RGBStrip from "./RGBStrip";
import Remote from "./Remote";
import Paper from "./Paper";
import Turntable from "./Turntable";
import { ACCENT_COLOR } from "@/lib/accent";
import { demoRecords, type DemoRecord } from "@/lib/covers";
import InfoPanel from "./InfoPanel";
import HoverTooltip from "./HoverTooltip";
import { clearHover, muteHoverFor, setHoverPos } from "@/lib/hoverStore";
import type { HoverNote } from "@/lib/hoverStore";
import { useNowPlaying } from "@/lib/nowPlaying";

const MAX_COLS = 5;

// Perspective camera FOV bounds. BASE_FOV must match the value passed to
// <Canvas camera={...}> below; ZOOM_MIN_FOV is the tightest zoom-in the
// user can reach while inspecting an active jacket (scroll up to zoom).
const BASE_FOV = 36;
const ZOOM_MIN_FOV = 18;
type WallArtFocus = "left" | "right" | null;

// Which cell, if any, holds the turntable when the shelf is multi-row?
// On a multi-row unit the turntable lives INSIDE one cell — dead center
// of row 1 (immediately above the bottom row). The two cells flanking it
// stay empty too, giving the player visual breathing room ("shelf · blank
// · player · blank · shelf"). For single-row units the turntable sits on
// TOP of the cabinet, so no cells are reserved.
function playerSlot(cols: number, rows: number): { col: number; row: number } | null {
  if (rows < 2) return null;
  return { col: Math.floor((cols - 1) / 2), row: 1 };
}

function isReservedCell(col: number, row: number, slot: { col: number; row: number } | null): boolean {
  if (!slot) return false;
  if (row !== slot.row) return false;
  return col >= slot.col - 1 && col <= slot.col + 1;
}

type Props = {
  /** Records to lay out on the shelf. Defaults to the synthetic demo set. */
  records?: DemoRecord[];
  /** Discogs username, shown in the header. Falls back to "demo" if absent. */
  username?: string;
  /** Source label for the header ("discogs" or "demo"). */
  source?: "discogs" | "demo";
  wallArtUrls?: {
    left?: string;
    right?: string;
  };
  wallArtNotes?: {
    left?: HoverNote;
    right?: HoverNote;
  };
  onReady?: () => void;
};

export default function Scene({
  records = demoRecords,
  username = "demo",
  source = "demo",
  wallArtUrls,
  wallArtNotes,
  onReady,
}: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [flipRequest, setFlipRequest] = useState({ recordId: "", signal: 0 });
  const pendingActiveIdRef = useRef<string | null>(null);
  const ledState = useLedState();
  // Polled Ryan-is-currently-listening state from /api/nowplaying. Drives
  // the turntable platter spin + its hover tooltip.
  const nowPlaying = useNowPlaying();
  // When true, the camera smoothly dollies in to a ¾-down closeup of the
  // turntable (same critically-damped chase the active-record view uses).
  // Clicking the turntable toggles this; clicking empty space or activating
  // a record clears it.
  const [turntableFocused, setTurntableFocused] = useState(false);
  const [focusedArt, setFocusedArt] = useState<WallArtFocus>(null);
  const hoverTransitionKeyRef = useRef<string | null>(null);

  const clearTurntableFocus = () => setTurntableFocused(false);
  const clearWallArtFocus = () => setFocusedArt(null);

  const clearActiveRecord = () => {
    pendingActiveIdRef.current = null;
    setActiveId(null);
  };

  const requestActiveRecord = (nextId: string) => {
    // Activating a record is mutually exclusive with turntable focus —
    // the record view wants the camera centered on the jacket, not on
    // the player — so any pending focus collapses the instant a record
    // is selected. Same for the picked-up paper / open remote: anything
    // that takes the foreground gets put down so the InfoPanel has the
    // viewport to itself.
    if (turntableFocused) setTurntableFocused(false);
    if (focusedArt) setFocusedArt(null);
    if (ledState.remoteOpen) setRemoteOpen(false);
    if (ledState.paperOpen) setPaperOpen(false);
    if (pendingActiveIdRef.current) {
      pendingActiveIdRef.current = nextId;
      return;
    }
    if (activeId && activeId !== nextId) {
      pendingActiveIdRef.current = nextId;
      setActiveId(null);
      return;
    }
    setActiveId(activeId === nextId ? null : nextId);
  };

  const toggleTurntableFocus = () => {
    // If a record is currently pulled out, retract it first so the
    // camera's follow-through doesn't fight the InfoPanel slide-out.
    if (activeId) clearActiveRecord();
    if (focusedArt) setFocusedArt(null);
    if (ledState.paperOpen) setPaperOpen(false);
    setTurntableFocused((v) => !v);
  };

  const toggleWallArtFocus = (which: "left" | "right") => {
    if (activeId) clearActiveRecord();
    if (turntableFocused) setTurntableFocused(false);
    if (ledState.paperOpen) setPaperOpen(false);
    setFocusedArt((v) => (v === which ? null : which));
  };

  const handleRecordRetracted = () => {
    const nextId = pendingActiveIdRef.current;
    if (!nextId) return;
    pendingActiveIdRef.current = null;
    setActiveId(nextId);
  };

  const flipActiveRecordToBack = () => {
    if (!activeId) return;
    setFlipRequest((v) => ({ recordId: activeId, signal: v.signal + 1 }));
  };

  useEffect(() => {
    const key = `${activeId ?? ""}|${turntableFocused ? "turntable" : ""}|${focusedArt ?? ""}`;
    if (hoverTransitionKeyRef.current === null) {
      hoverTransitionKeyRef.current = key;
      return;
    }
    if (hoverTransitionKeyRef.current === key) return;
    hoverTransitionKeyRef.current = key;
    muteHoverFor(950);
  }, [activeId, turntableFocused, focusedArt]);

  // Arrow-key traversal between records while one is being inspected.
  // ArrowLeft / ArrowRight step the active record one slot back/forward in
  // the shelf order. We read from `activeId ?? pendingActiveIdRef.current`
  // so that rapid arrow presses during the brief retract handoff (when
  // activeId is momentarily null) still register and update the pending
  // target — matching the way pointer clicks behave through the same
  // handoff path. Modifier-combos and form-field focus are skipped so we
  // never fight with Cmd+Left (browser back), text editing, etc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const sourceId = activeId ?? pendingActiveIdRef.current;
      if (!sourceId) return;
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      let delta = 0;
      if (e.key === "ArrowLeft") delta = -1;
      else if (e.key === "ArrowRight") delta = 1;
      else return;
      const m = /-(\d+)$/.exec(sourceId);
      if (!m) return;
      const idx = parseInt(m[1], 10);
      const nextIdx = idx + delta;
      if (nextIdx < 0 || nextIdx >= records.length) return;
      e.preventDefault();
      requestActiveRecord(`${records[nextIdx].id}-${nextIdx}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, records]);

  // pack records along the X axis, INSIDE fixed-size Kallax cells. Records
  // are LEFT-aligned: the first record's left edge sits ~1mm off the inner
  // left wall, with each subsequent spine packed right next to the previous.
  // Once a cell fills, we move into the next cell (rightward), then once we
  // hit MAX_COLS wide we stack a new row above.
  const spineThickness = 0.006;
  const gap = 0.0006;
  const stride = spineThickness + gap;
  // Use the full cell interior width — only 2mm of total breathing room
  // (1mm at each end) so records fill the cell wall-to-wall.
  const RECORDS_PER_CELL = Math.floor((SHELF_INNER_W - 0.002) / stride);

  const total = records.length;
  const recordCellsNeeded = Math.max(1, Math.ceil(total / RECORDS_PER_CELL));

  // Provisional layout (no player slot yet). If this fits in one row,
  // we're done — single-row units put the turntable ON TOP, no reserved
  // cells. Otherwise we add 3 extra cells (player slot + 2 flank) and
  // recompute.
  let cols = Math.min(MAX_COLS, recordCellsNeeded);
  let rows = Math.ceil(recordCellsNeeded / cols);
  if (rows >= 2) {
    const cellsWithSlot = recordCellsNeeded + 3;
    cols = Math.min(MAX_COLS, cellsWithSlot);
    rows = Math.ceil(cellsWithSlot / cols);
  }
  const slot = playerSlot(cols, rows);

  // The bottom row fills left → right (how a real Kallax gets filled).
  // Every row ABOVE the bottom fills *outside-in symmetrically*:
  // outermost pair of cells alternates spine-by-spine, then the next pair
  // inward, etc. The middle cell (for odd cols) fills last. This keeps
  // every partial row visually balanced around the center — no lone shelf
  // hanging off to one side. Left-half cells pack against the left wall;
  // right-half cells pack against the right wall, so the spines actually
  // mirror.
  function buildRowCells(row: number): { col: number; align: "left" | "right" }[] {
    // Available cells in this row (skipping player-slot reservations).
    const available: number[] = [];
    for (let c = 0; c < cols; c++) {
      if (!isReservedCell(c, row, slot)) available.push(c);
    }
    if (row === 0) {
      // bottom: plain left-to-right
      return available.map((c) => ({ col: c, align: "left" as const }));
    }
    // outside-in pair-aware ordering. Interleave the outermost pair first,
    // so within a pair, records alternate spine-by-spine between the left
    // and right cell (rather than filling one cell before the other).
    const left = available.filter((c) => c < cols / 2);     // left half
    const right = available.filter((c) => c > (cols - 1) / 2).reverse(); // right half, outermost first
    const mid = available.filter((c) => c === (cols - 1) / 2); // only for odd cols
    const out: { col: number; align: "left" | "right" }[] = [];
    const pairs = Math.max(left.length, right.length);
    for (let i = 0; i < pairs; i++) {
      if (i < left.length) out.push({ col: left[i], align: "left" });
      if (i < right.length) out.push({ col: right[i], align: "right" });
    }
    for (const c of mid) out.push({ col: c, align: "left" });
    return out;
  }

  // Expand the row's cell ordering into a record-by-record sequence.
  // - Bottom row: fill each cell COMPLETELY before moving to the next,
  //   so the leftmost cells pack edge-to-edge with no internal gap. Only
  //   the very last (partial) cell has slack on its right side.
  // - Non-bottom rows: interleave — one record per cell per "round" — so
  //   each pair of cells fills at the same rate. Combined with
  //   buildRowCells's outside-in pair ordering, this keeps every partial
  //   row visually balanced around the center.
  function buildRowSequence(row: number): { col: number; align: "left" | "right"; inCellIdx: number }[] {
    const cells = buildRowCells(row);
    const seq: { col: number; align: "left" | "right"; inCellIdx: number }[] = [];
    if (row === 0) {
      for (const c of cells) {
        for (let i = 0; i < RECORDS_PER_CELL; i++) seq.push({ ...c, inCellIdx: i });
      }
    } else {
      for (let i = 0; i < RECORDS_PER_CELL; i++) {
        for (const c of cells) seq.push({ ...c, inCellIdx: i });
      }
    }
    return seq;
  }

  function recordCell(idx: number): {
    col: number;
    row: number;
    inCellIdx: number;
    align: "left" | "right";
  } {
    let placed = 0;
    for (let r = 0; r < rows; r++) {
      const seq = buildRowSequence(r);
      if (idx < placed + seq.length) {
        const s = seq[idx - placed];
        return { col: s.col, row: r, inCellIdx: s.inCellIdx, align: s.align };
      }
      placed += seq.length;
    }
    return { col: cols - 1, row: rows - 1, inCellIdx: 0, align: "left" };
  }

  // Count how many records actually land in each cell. We need this so a
  // partial cell stretches its spines edge-to-edge (no awkward right-side
  // gap) instead of packing them at the standard 6.6 mm stride and leaving
  // the remainder visibly empty. Computed once per render.
  const cellCounts = (() => {
    const counts = new Map<string, number>();
    for (let i = 0; i < records.length; i++) {
      const { col, row } = recordCell(i);
      const k = `${col},${row}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
  })();

  // For a cell with `count` records, how far apart do consecutive spines sit?
  // If the cell is FULL (count >= RECORDS_PER_CELL) we use the standard
  // 6.6 mm stride. Otherwise we stretch so the first spine's left edge sits
  // on the left wall and the last spine's right edge sits on the right wall.
  function cellStride(count: number): number {
    if (count >= RECORDS_PER_CELL) return stride;
    if (count <= 1) return stride;
    return (SHELF_INNER_W - spineThickness - 0.002) / (count - 1);
  }

  function placeRecord(idx: number): { x: number; y: number } {
    const { col, row, inCellIdx, align } = recordCell(idx);
    const center = shelfCellCenter(col, row, cols, rows);
    const count = cellCounts.get(`${col},${row}`) ?? 1;
    const s = cellStride(count);
    if (align === "right") {
      // Right-align: pack against the right wall, growing leftward. The
      // rightmost spine sits 1 mm off the right interior wall.
      const cellRightEdge = center.x + SHELF_INNER_W / 2 - 0.001;
      const x = cellRightEdge - inCellIdx * s - spineThickness / 2;
      return { x, y: center.y };
    }
    // Left-align (default): pack against the left wall, growing rightward.
    const cellLeftEdge = center.x - SHELF_INNER_W / 2 + 0.001;
    const x = cellLeftEdge + inCellIdx * s + spineThickness / 2;
    return { x, y: center.y };
  }

  // Half-width of the shelf in world units — used to position props clear of it
  const shelfHalfWidth = (cols * SHELF_CELL) / 2;
  const shelfTopY = SHELF_BOTTOM_Y + rows * SHELF_CELL_H;
  // LED strip sits just below the top board interior surface, at the very top
  // of the unit. Same offset that worked for v0.0.6, now derived from the
  // dynamic shelf top instead of hardcoded.
  const ledStripY = shelfTopY - SHELF_WALL - 0.004;

  // World-space position of the turntable's plinth base. Shared by the
  // <Turntable> render and the IdleCamera focus-target so they can't
  // disagree about where the player sits (which would make the camera
  // miss its anchor).
  const turntablePos: [number, number, number] = slot
    ? (() => {
        const cellCenter = shelfCellCenter(slot.col, slot.row, cols, rows);
        // Sit it on the floor of that cell (top of the shelf-below board).
        const slotFloorY = cellCenter.y - SHELF_CELL_H / 2 + SHELF_WALL / 2;
        return [cellCenter.x, slotFloorY, cellCenter.z + 0.04];
      })()
    : [0, shelfTopY, -0.16];

  // activeId is in the form `<release_id>-<index>` (see VinylRecord key below).
  // Look up the underlying record by parsing back the trailing index.
  const active = (() => {
    if (!activeId) return null;
    const m = /-(\d+)$/.exec(activeId);
    if (!m) return null;
    const idx = parseInt(m[1], 10);
    return records[idx] ?? null;
  })();

  return (
    <div
      className="fixed inset-0"
      onPointerMove={(e) => {
        // tooltip position follows the cursor; pixel-space, with the tooltip
        // offset to the lower-right of the cursor in HoverTooltip.
        setHoverPos(e.clientX, e.clientY);
      }}
      onPointerLeave={clearHover}
    >
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [0.05, 0.52, 1.05], fov: BASE_FOV, near: 0.01, far: 50 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.6 }}
        onPointerMissed={() => {
          clearHover();
          clearActiveRecord();
          clearTurntableFocus();
          clearWallArtFocus();
          // dismiss any picked-up UI when the user clicks empty space —
          // both the remote and the paper scrap behave the same way.
          if (ledState.remoteOpen) setRemoteOpen(false);
          if (ledState.paperOpen) setPaperOpen(false);
        }}
      >
        {/* dusky warm cream — dimmer than midday, like dusk indoor light */}
        <color attach="background" args={["#3a2e22"]} />
        {/* warm fog softens the back wall and adds depth */}
        <fog attach="fog" args={["#2a1f15", 0.8, 3.2]} />

        <Lights />
        <SceneReadySignal onReady={onReady} />

        {/* No HDRI environment — kills the bright IBL that was washing out the wall */}

        <Room />
        <RoomProps
          shelfHalfWidth={shelfHalfWidth}
          wallArtUrls={wallArtUrls}
          wallArtNotes={wallArtNotes}
          focusedArt={focusedArt}
          onSelectArt={toggleWallArtFocus}
        />
        <RainShadow />
        <Shelf cols={cols} rows={rows} />

        {/* Turntable — on TOP of the shelf for single-row units (where it
            sits as a centerpiece), inside the reserved cell for multi-row
            units (where the shelf has been built around the player slot).
            The turntable's click handler toggles a camera focus mode
            (handled in IdleCamera) so hitting the player brings the
            camera up to a ¾-down closeup. `turntablePos` is computed
            once and shared with IdleCamera below so the camera aims at
            the exact same anchor. */}
        <Turntable
          position={turntablePos}
          accent={ACCENT_COLOR}
          nowPlaying={nowPlaying.loaded ? nowPlaying.data : null}
          focused={turntableFocused}
          onClick={toggleTurntableFocus}
        />


        {/* Addressable RGB LED strip — tucked into the inside-top cove of the
            TOP row of the shelf. Only one strip across the entire unit (the
            rest of the cells don't get cove lighting). Recessed behind the
            front lip so the camera can't see the LEDs directly — you only
            see the COLORED GLOW washing the front of the records, back wall,
            and forward onto the rug. */}
        <RGBStrip
          position={[0, ledStripY, -0.012]}
          size={[cols * SHELF_CELL - SHELF_WALL * 2 - 0.002, 0.0035, 0.008]}
          count={32 * cols}
          withLight
          lightDistance={0.65}
          lightMultiplier={1.3}
        />
        {/* matte-black cove ceiling — blocks any stray bounce/bloom from
            spilling UP through the shelf top */}
        <mesh position={[0, ledStripY + 0.007, -0.012]}>
          <boxGeometry args={[cols * SHELF_CELL - SHELF_WALL * 2 + 0.004, 0.003, 0.04]} />
          <meshStandardMaterial color="#08060a" roughness={1.0} />
        </mesh>

        {/* RGB remote — rests flat on the rug just in front of the shelf, off
            to the right. Long axis runs LEFT–RIGHT (parallel to the shelf
            front, like a real chinesium IR remote would be set down), with
            only a tiny back-edge lift so the camera can still pick up the
            buttons. Click anywhere on it to summon it; click empty space
            outside to dismiss. */}
        <Remote
          position={[shelfHalfWidth + 0.10, -0.176, 0.20]}
          rotation={[-0.05, Math.PI / 2, 0]}
        />

        {/* Paper scrap — a small note from me to the visitor, tucked on the
            floor just in front of the book stack on the LEFT. Same pick-up
            interaction as the remote: click it to summon, click empty space
            to put it back. The two are mutually exclusive (handled in
            ledStore) so picking one up dismisses the other.
            Position: x just to the right of the stack (so the scrap reads
            as fallen out of one of the books, not stacked under them),
            y on the rug, z a touch in front of the stack toward camera. */}
        <Paper
          position={[-(shelfHalfWidth + 0.05), -0.176, 0.48]}
          rotation={[0, -0.32, 0]}
        />

        {records.map((rec, i) => {
          const p = placeRecord(i);
          const recordId = `${rec.id}-${i}`;
          // Index-suffix the key so duplicates in the source collection
          // (Discogs sometimes returns the same release_id twice) don't
          // trigger React's "duplicate key" reconciliation bug.
          return (
            <VinylRecord
              key={recordId}
              rec={rec}
              shelfX={p.x}
              shelfY={p.y}
              active={activeId === recordId}
              disabled={turntableFocused || focusedArt !== null}
              onSelect={() => requestActiveRecord(recordId)}
              onRetracted={handleRecordRetracted}
              flipSignal={flipRequest.recordId === recordId ? flipRequest.signal : 0}
            />
          );
        })}

        <DustMotes />

        <ActiveSpotlight active={!!activeId} />
        <TurntableSpotlight focused={turntableFocused} target={turntablePos} />
        <WallArtSpotlight focusedArt={focusedArt} shelfHalfWidth={shelfHalfWidth} />

        <IdleCamera
          active={activeId}
          cols={cols}
          rows={rows}
          turntableFocused={turntableFocused}
          turntablePos={turntablePos}
          focusedArt={focusedArt}
          shelfHalfWidth={shelfHalfWidth}
        />

        <EffectComposer multisampling={0}>
          {/* bloom — picks up the emissive LED strips so they actually glow.
              Lowered threshold so the high-emissive strips bloom but the dim
              wall plaster still does not. */}
          <Bloom
            intensity={0.7}
            luminanceThreshold={0.55}
            luminanceSmoothing={0.5}
            kernelSize={KernelSize.LARGE}
          />
          {/* deeper vignette = the corners fall into dim cozy shadow */}
          <Vignette eskil={false} offset={0.28} darkness={0.85} />
        </EffectComposer>
      </Canvas>

      <InfoPanel rec={active} onClose={clearActiveRecord} onFlipBack={flipActiveRecordToBack} />
      <HoverTooltip />
      <Header total={total} username={username} source={source} />
      <Footer />
    </div>
  );
}

function SceneReadySignal({ onReady }: { onReady?: () => void }) {
  const { active } = useProgress();
  const readyFrames = useRef(0);
  const called = useRef(false);
  const startTime = useRef<number | null>(null);

  useFrame((state) => {
    if (!onReady || called.current) return;
    if (startTime.current === null) startTime.current = state.clock.elapsedTime;
    if (active) {
      readyFrames.current = 0;
      return;
    }
    readyFrames.current += 1;
    const elapsed = state.clock.elapsedTime - startTime.current;
    if (readyFrames.current >= 3 && elapsed > 0.8) {
      called.current = true;
      onReady();
    }
  });

  return null;
}

// Subtle camera idle drift + active-state offset so the info panel doesn't
// cover the pulled-out record. When a record is active we slide the camera
// LEFT and pan the lookAt LEFT so the shelf shifts into the un-paneled area.
// Also dollies BACK + UP as the shelf grows (more cells = need wider FOV).
//
// Plus the user-driven "look around" controls:
//   - mouse position drives a subtle parallax (±~4cm) so the room feels alive
//   - scroll wheel dollies the camera closer/further (clamped)
// Both are critically damped so they never feel twitchy.
function IdleCamera({
  active,
  cols,
  rows,
  turntableFocused,
  turntablePos,
  focusedArt,
  shelfHalfWidth,
}: {
  active: string | null;
  cols: number;
  rows: number;
  /** True while the user has clicked the turntable and the camera should
   *  be dollied in on it. Blends independently of the record view so we
   *  can transition smoothly between the two. */
  turntableFocused: boolean;
  /** World-space plinth base of the turntable, same one the <Turntable>
   *  component is rendered at. Used as the anchor the closeup camera
   *  aims at. */
  turntablePos: [number, number, number];
  focusedArt: WallArtFocus;
  shelfHalfWidth: number;
}) {
  const { camera } = useThree();
  // scrollDolly: user-driven dolly offset (added on top of size-derived dolly)
  const scrollDolly = useRef(0);
  // Stashed scroll-dolly value at the moment a record was activated, so we
  // can SMOOTHLY restore the user's prior viewing pose when they dismiss.
  // null = nothing stashed yet.
  const stashedScrollDolly = useRef<number | null>(null);
  // zoomT: user-driven zoom-into-active-jacket value, 0..1. Only meaningful
  // while a record is active; scroll up = zoom in, scroll down = zoom out.
  // Resets to 0 on every activation change so each new record opens at the
  // default head-on FOV instead of inheriting the previous zoom level.
  const zoomT = useRef(0);
  // Mirror of `active` so the wheel-handler effect doesn't have to be
  // re-attached on every active change (which would briefly drop scroll
  // events during the active transition).
  const activeRef = useRef<string | null>(null);
  const lastFocusedArtRef = useRef<Exclude<WallArtFocus, null> | null>(null);
  const offset = useRef({
    x: 0, vX: 0,
    y: 0, vY: 0,
    z: 0, vZ: 0,
    lookX: 0, vLookX: 0,
    lookY: 0, vLookY: 0,
    parX: 0, vParX: 0,         // mouse parallax X
    parY: 0, vParY: 0,         // mouse parallax Y
    dollyZ: 0, vDollyZ: 0,     // scroll dolly position
    fov: BASE_FOV, vFov: 0,    // perspective FOV (zoom-into-jacket)
    ttBlend: 0, vTtBlend: 0,   // turntable-focus blend (0 = normal, 1 = closeup)
    artBlend: 0, vArtBlend: 0,
  });

  // Side-view forces the user into a foreshortened pose that's great for
  // peeking down rows of spines but awful for actually reading a pulled-out
  // album. So: any time a record IS active, we force scrollDolly to 0
  // (head-on view). On the FIRST activation we stash whatever scroll the
  // user was at; on dismiss we restore it. Record-to-record switches keep
  // the stash (and re-force scroll to 0 in case anything else moved it).
  useEffect(() => {
    if (active) {
      if (!activeRef.current) {
        // first activation in this session — stash the user's prior pose
        stashedScrollDolly.current = scrollDolly.current;
      }
      // force scroll to 0 on every active change, including record-to-record
      // switches; the critically-damped chase in useFrame handles the easing.
      scrollDolly.current = 0;
      // every new activation also opens at full head-on view — the smoothed
      // FOV chase will ease back to BASE_FOV automatically.
      zoomT.current = 0;
    } else if (activeRef.current) {
      // dismissing — restore the user to their prior view
      if (stashedScrollDolly.current !== null) {
        scrollDolly.current = stashedScrollDolly.current;
        stashedScrollDolly.current = null;
      }
      zoomT.current = 0;
    }
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      // If the wheel event originated inside a region that opted into native
      // scroll (currently the InfoPanel sidebar), let the browser scroll it
      // and don't hijack for zoom or dolly. Without this the global handler
      // calls preventDefault on every wheel tick and the sidebar's
      // overflow-y-auto never gets a chance to fire.
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest("[data-allow-native-scroll]")
      ) {
        return;
      }

      muteHoverFor(450);

      // While a record is active, hijack the wheel for zoom-into-jacket:
      // scroll UP (negative deltaY) zooms in, scroll DOWN zooms out. zoomT
      // is clamped to [0, 1] and drives a perspective-FOV interpolation in
      // the frame loop (BASE_FOV → ZOOM_MIN_FOV).
      if (activeRef.current) {
        e.preventDefault();
        const step = -e.deltaY * 0.0018;
        zoomT.current = Math.max(0, Math.min(1, zoomT.current + step));
        return;
      }

      // Lean in/out (positive deltaY = scroll DOWN = lean BACK from shelf).
      // Scroll UP → scrollDolly goes NEGATIVE → camera closer to shelf.
      // Range extended to [-1.5, 0.6]: past ~-0.35 the camera additionally
      // swings around to the SIDE VIEW (see sideBlend in the frame loop).
      e.preventDefault();
      const step = e.deltaY * 0.0008;
      scrollDolly.current = Math.max(-1.5, Math.min(0.6, scrollDolly.current + step));
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  // Target dolly: derived from the shelf grid size so the whole unit stays
  // in frame. Baseline (cols=1, rows=1): camera at (0.05, 0.52, 1.05).
  // Each extra col adds a bit of horizontal field; each extra row pushes
  // camera back + up to keep the top of the shelf in view.
  const dolly = useMemo(() => {
    const baseX = 0.05;
    const baseY = 0.52;
    const baseZ = 1.05;
    const dollyZ = baseZ + Math.max(0, cols - 1) * 0.28 + Math.max(0, rows - 1) * 0.32;
    const dollyY = baseY + Math.max(0, rows - 1) * 0.18;
    return { x: baseX, y: dollyY, z: dollyZ };
  }, [cols, rows]);

  // Lookat height creeps up so the camera stays pointed at the middle of the
  // grid instead of the bottom row.
  const lookYBase = useMemo(() => -0.02 + Math.max(0, rows - 1) * 0.16, [rows]);

  useFrame((state, rawDt) => {
    const t = state.clock.elapsedTime;
    const dt = Math.min(rawDt, 0.05);
    if (focusedArt) lastFocusedArtRef.current = focusedArt;

    // Centering model: we deliberately do NOT pan the camera when a record
    // is active. Instead, the record's world-x is offset LEFT
    // (FLOAT_TARGET.x = −0.10 in VinylRecord.tsx) so it projects onto the
    // visual center of the LEFT ~60% of the viewport (the right ~40% is
    // the info panel). Panning the camera + offsetting the record was
    // double-counting and made the centering finicky.
    const targetX = 0;
    const targetLookX = 0;
    const targetY = active ? 0 : 0;
    const targetLookY = 0;

    const omega = 4.5;
    const o = offset.current;
    const step = (val: number, vel: number, target: number, w = omega) => {
      const a = -2 * w * vel + w * w * (target - val);
      return { v: vel + a * dt, p: val + (vel + a * dt) * dt };
    };
    const sX = step(o.x, o.vX, targetX); o.x = sX.p; o.vX = sX.v;
    const sLX = step(o.lookX, o.vLookX, targetLookX); o.lookX = sLX.p; o.vLookX = sLX.v;
    const sY = step(o.y, o.vY, targetY); o.y = sY.p; o.vY = sY.v;
    const sLY = step(o.lookY, o.vLookY, targetLookY); o.lookY = sLY.p; o.vLookY = sLY.v;

    // Z dolly — smoothly chases the computed dolly distance.
    const targetZ = dolly.z;
    const sZ = step(o.z, o.vZ, targetZ - 1.05); o.z = sZ.p; o.vZ = sZ.v;

    // Mouse parallax: r3f exposes pointer in NDC space (-1 to +1). We map
    // it to a small world offset. Slower omega so the gaze drift feels
    // natural and not snappy. Magnitude is intentionally tiny — this is
    // about the room "breathing with you", not free orbiting.
    //
    // While a record is being inspected we PIN the parallax to 0 so any
    // pointer drift across the scene or over the InfoPanel doesn't sway
    // the camera and knock the head-on jacket view out of alignment. The
    // existing critically-damped chase eases the camera smoothly back to
    // its center pose on activation and back into pointer-follow on
    // dismissal — no snap.
    const pX = state.pointer.x;       // -1 (left) … +1 (right)
    const pY = state.pointer.y;       // -1 (bottom) … +1 (top)
    const focusLocked = Boolean(active || focusedArt);
    const parTargetX = focusLocked ? 0 : pX * 0.06;     // ±6cm camera-X parallax
    const parTargetY = focusLocked ? 0 : -pY * 0.04;    // INVERTED: mouse-up → camera dips down to peek up at the top of shelf
    const sParX = step(o.parX, o.vParX, parTargetX, 2.6); o.parX = sParX.p; o.vParX = sParX.v;
    const sParY = step(o.parY, o.vParY, parTargetY, 2.6); o.parY = sParY.p; o.vParY = sParY.v;

    // Turntable-focus blend: eases 0 → 1 when the user clicks the player,
    // 1 → 0 when they dismiss. Slightly snappier than the main omega so
    // the "dolly up to the player" feels deliberate rather than drifty.
    const sTt = step(o.ttBlend, o.vTtBlend, turntableFocused ? 1 : 0, 5.6);
    o.ttBlend = sTt.p; o.vTtBlend = sTt.v;

    const sArt = step(o.artBlend, o.vArtBlend, focusedArt ? 1 : 0, 5.2);
    o.artBlend = sArt.p; o.vArtBlend = sArt.v;

    // Scroll dolly: user-driven lean-in/lean-out, critically damped chase
    const sDoll = step(o.dollyZ, o.vDollyZ, scrollDolly.current, 3.2);
    o.dollyZ = sDoll.p; o.vDollyZ = sDoll.v;

    // Side-view blend: 0 = front view, 1 = looking down the shelf from
    // the right end. Activates as the user scrolls past the "lean in"
    // range (scrollDolly < -0.35). Critically damped via o.dollyZ smoothing
    // already (since sideBlend reads from o.dollyZ, not raw scrollDolly).
    const sideBlend = Math.max(0, Math.min(1, (-0.35 - o.dollyZ) / 0.65));

    // Front pose (sideBlend = 0): camera near the front of the shelf,
    // looking at its center.
    const sway = active ? 0.008 : 0.022;
    const frontPos = new THREE.Vector3(
      dolly.x + o.x + o.parX + Math.sin(t * 0.18) * sway,
      dolly.y + o.y + o.parY + Math.cos(t * 0.13) * sway * 0.5,
      1.05 + o.z + o.dollyZ,
    );
    const frontLook = new THREE.Vector3(
      o.lookX + o.parX * 0.5,
      lookYBase + o.lookY + o.parY * 0.4,
      0,
    );

    // Side pose (sideBlend = 1): a 3/4 view from off the right end of the
    // shelf — camera is BOTH offset to the right AND pulled forward from
    // the shelf face, so the resulting look angle is ~55° from the front
    // (not 90° / straight-side, which was too steep for traversing the
    // collection). Reads as "leaning in from the right" rather than
    // "fully side-on."
    //
    // Tradeoff: with the previous 90° side angle, you could see the front
    // covers of records that tipped out on hover but the records along
    // the shelf foreshortened HARD. At 55° they don't foreshorten as
    // much, you can scan across them comfortably, AND the front-cover
    // peek on hover still reads clearly.
    const shelfRightEdge = cols * 0.5 * 0.33 + 0.28;     // SHELF_CELL ≈ 0.33m
    const sidePos = new THREE.Vector3(
      shelfRightEdge + o.parX * 0.5,
      dolly.y * 0.95 + o.parY,
      0.5 + o.z * 0.3,
    );
    const sideLook = new THREE.Vector3(
      -0.05 + o.parX * 0.3,
      lookYBase * 0.9 + o.parY * 0.4,
      0.05,
    );

    const shelfPos = frontPos.clone().lerp(sidePos, sideBlend);
    const shelfLook = frontLook.clone().lerp(sideLook, sideBlend);

    // Turntable closeup pose: hovering ~22cm above the platter and ~35cm
    // in front of it, angled down at ~32° so you see the platter top,
    // the record label art, AND the tonearm sweeping inward all in one
    // frame. Parallax is retained at a reduced amplitude so the view
    // still breathes without knocking the closeup out of alignment.
    const ttBlend = o.ttBlend;
    let finalPos = shelfPos;
    let finalLook = shelfLook;
    if (ttBlend > 0.0005) {
      const ttSway = 0.005;
      const ttClosePos = new THREE.Vector3(
        turntablePos[0] + o.parX * 0.25 + Math.sin(t * 0.22) * ttSway,
        turntablePos[1] + 0.28 + o.parY * 0.15 + Math.cos(t * 0.17) * ttSway * 0.5,
        turntablePos[2] + 0.35,
      );
      const ttCloseLook = new THREE.Vector3(
        turntablePos[0] + o.parX * 0.08,
        turntablePos[1] + 0.06 + o.parY * 0.08,
        turntablePos[2],
      );
      finalPos = shelfPos.clone().lerp(ttClosePos, ttBlend);
      finalLook = shelfLook.clone().lerp(ttCloseLook, ttBlend);
    }

    const artBlend = o.artBlend;
    const artTarget = focusedArt ?? lastFocusedArtRef.current;
    if (artTarget && artBlend > 0.0005) {
      const padding = 0.22;
      const artX = artTarget === "left"
        ? -(shelfHalfWidth + padding + 0.25)
        : shelfHalfWidth + padding + 0.34;
      const artY = artTarget === "left" ? 0.215 : 0.275;
      const artZ = -0.49;
      // Left frame is ~1.5× the size of the right one (see RoomProps.tsx
      // small flag), so it needs a proportionally further camera offset to
      // fill the same comfortable portion of the viewport. Without this the
      // left painting gets cropped/zoomed in too tight while the right
      // painting reads as intended.
      const artCameraZ = artTarget === "left" ? 0.75 : 0.46;
      const artClosePos = new THREE.Vector3(
        artX + (artTarget === "left" ? 0.02 : -0.02) + o.parX * 0.12,
        artY + 0.02 + o.parY * 0.08,
        artZ + artCameraZ,
      );
      const artCloseLook = new THREE.Vector3(
        artX,
        artY,
        artZ,
      );
      finalPos = finalPos.clone().lerp(artClosePos, artBlend);
      finalLook = finalLook.clone().lerp(artCloseLook, artBlend);
    }

    camera.position.copy(finalPos);
    camera.lookAt(finalLook);

    // FOV zoom — only active when a record is pulled out. Smoothly chases
    // the user's zoomT (0..1) toward ZOOM_MIN_FOV; when no record is
    // active the target snaps back to BASE_FOV, easing the camera
    // "unzoom" automatically on dismiss. We only push the new FOV to the
    // camera if it materially changed, to avoid recalculating the
    // projection matrix every frame for a no-op.
    const targetFov = active
      ? BASE_FOV - zoomT.current * (BASE_FOV - ZOOM_MIN_FOV)
      : BASE_FOV;
    const sFov = step(o.fov, o.vFov, targetFov, 4.6);
    o.fov = sFov.p; o.vFov = sFov.v;
    if ("fov" in camera) {
      const persp = camera as THREE.PerspectiveCamera;
      if (Math.abs(persp.fov - o.fov) > 0.01) {
        persp.fov = o.fov;
        persp.updateProjectionMatrix();
      }
    }
  });
  return null;
}

// Soft warm spotlight that fades in whenever a record is active, aimed at
// the floating album. Darker covers (Yeezus, Korn, Joy Division etc.) were
// reading as black silhouettes against the dim room — this gives the
// album a dedicated key light without disturbing the rest of the scene.
//
// Constants match VinylRecord.FLOAT_TARGET; the spotlight sits 0.5m above
// and slightly toward the camera from the float point, angled down at it.
function ActiveSpotlight({ active }: { active: boolean }) {
  const spotRef = useRef<THREE.SpotLight>(null);
  const targetRef = useRef<THREE.Object3D>(null);
  const intensity = useRef(0);

  useEffect(() => {
    // Wire the spotlight's `target` to our managed Object3D so it aims at
    // a precise world point rather than the default (0,0,0) parent space.
    if (spotRef.current && targetRef.current) {
      spotRef.current.target = targetRef.current;
    }
  }, []);

  useFrame((_, rawDt) => {
    if (!spotRef.current) return;
    const dt = Math.min(rawDt, 0.05);
    const target = active ? 3.0 : 0;
    // ease over ~250ms
    intensity.current += (target - intensity.current) * Math.min(1, dt * 8);
    spotRef.current.intensity = intensity.current;
  });

  // Float-target coordinates (must stay in sync with VinylRecord.FLOAT_TARGET)
  const fx = -0.10;
  const fy = 0.17;
  const fz = 0.55;

  return (
    <>
      <spotLight
        ref={spotRef}
        position={[fx, fy + 0.55, fz + 0.35]}
        angle={Math.PI / 6}
        penumbra={0.75}
        distance={2.2}
        decay={1.6}
        color={"#ffe6c4"}
        intensity={0}
        castShadow={false}
      />
      <object3D ref={targetRef} position={[fx, fy, fz]} />
    </>
  );
}

// Soft cozy overhead light that warms up the turntable while the camera
// is dollied in on it. Sits ~50cm directly above the plinth, angled
// straight down at the platter, and fades in/out to match
// `turntableFocused`. Distinct from the room's ambient lights: this
// is a focus spotlight that gives the closeup a "now playing" vibe.
function TurntableSpotlight({
  focused,
  target,
}: {
  focused: boolean;
  /** Plinth-base world position, same anchor used by the camera. */
  target: [number, number, number];
}) {
  const spotRef = useRef<THREE.SpotLight>(null);
  const targetRef = useRef<THREE.Object3D>(null);
  const intensity = useRef(0);

  useEffect(() => {
    if (spotRef.current && targetRef.current) {
      spotRef.current.target = targetRef.current;
    }
  }, []);

  useFrame((_, rawDt) => {
    if (!spotRef.current) return;
    const dt = Math.min(rawDt, 0.05);
    // Lower peak than the record spotlight so the platter gets a warm
    // focus wash without blowing out the album-art label. Eases over
    // ~400ms so the light blooms in gently rather than snapping on.
    const want = focused ? 1.25 : 0;
    intensity.current += (want - intensity.current) * Math.min(1, dt * 5);
    spotRef.current.intensity = intensity.current;
  });

  const [tx, ty, tz] = target;

  return (
    <>
      <spotLight
        ref={spotRef}
        // 50cm above the plinth, nudged 8cm forward so the cone aims at
        // the front of the platter (closer to the camera) instead of the
        // far back edge, which would leave the tonearm in shadow.
        position={[tx, ty + 0.50, tz + 0.08]}
        angle={Math.PI / 5.5}
        penumbra={0.85}
        distance={1.4}
        decay={1.4}
        color={"#ffd9a8"}
        intensity={0}
        castShadow={false}
      />
      {/* Aim target sits a few cm above the plinth top so the cone's
          center lands on the platter label rather than the plinth wood. */}
      <object3D ref={targetRef} position={[tx, ty + 0.06, tz]} />
    </>
  );
}

function WallArtSpotlight({
  focusedArt,
  shelfHalfWidth,
}: {
  focusedArt: WallArtFocus;
  shelfHalfWidth: number;
}) {
  const spotRef = useRef<THREE.SpotLight>(null);
  const targetRef = useRef<THREE.Object3D>(null);
  const intensity = useRef(0);

  useEffect(() => {
    if (spotRef.current && targetRef.current) {
      spotRef.current.target = targetRef.current;
    }
  }, []);

  useFrame((_, rawDt) => {
    if (!spotRef.current || !targetRef.current) return;
    const dt = Math.min(rawDt, 0.05);
    const want = focusedArt ? 1.45 : 0;
    intensity.current += (want - intensity.current) * Math.min(1, dt * 5.5);
    spotRef.current.intensity = intensity.current;
  });

  const padding = 0.22;
  const tx = focusedArt === "left"
    ? -(shelfHalfWidth + padding + 0.25)
    : shelfHalfWidth + padding + 0.34;
  const ty = focusedArt === "left" ? 0.215 : 0.275;
  const tz = -0.49;

  return (
    <>
      <spotLight
        ref={spotRef}
        position={[tx, ty + 0.22, tz + 0.34]}
        angle={Math.PI / 7}
        penumbra={0.82}
        distance={1.1}
        decay={1.4}
        color={"#ffd9a8"}
        intensity={0}
        castShadow={false}
      />
      <object3D ref={targetRef} position={[tx, ty, tz]} />
    </>
  );
}

function Header({
  total,
}: {
  total: number;
  // username/source props are accepted by callers but no longer rendered —
  // the HUD now shows only the wordmark on the left and the record-count on
  // the right, all in the same warm-cream tone for a calmer top edge.
  username?: string;
  source?: "discogs" | "demo";
}) {
  return (
    <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 flex items-center justify-between p-7">
      <div className="font-sans text-[10px] uppercase tracking-[0.32em] text-inkSoft/80">
        <span className="serif italic text-inkSoft/80 text-sm normal-case tracking-normal">rycord</span>
      </div>
      <div className="font-sans text-[10px] uppercase tracking-[0.32em] text-inkSoft/80">
        {total} records · sort: a–z
      </div>
    </div>
  );
}

function Footer() {
  return (
    <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-10 flex items-center justify-between p-7">
      <div className="font-sans text-[10px] uppercase tracking-[0.32em] text-inkSoft/80">
        click any spine to pull out · scroll to zoom · click out to slide back
      </div>
      <div className="font-sans text-[10px] uppercase tracking-[0.32em] text-inkSoft/80">
        v0.1.14
      </div>
    </div>
  );
}
