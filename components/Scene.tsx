"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerformanceMonitor, useProgress } from "@react-three/drei";
import { EffectComposer, Bloom, Noise, Vignette } from "@react-three/postprocessing";
import { BlendFunction, KernelSize } from "postprocessing";
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
import { tierDpr, usePerformanceTier, type PerformanceMode, type PerformanceTier } from "@/lib/performance";

const MAX_COLS = 5;

// BASE_FOV must match the <Canvas camera> fov
const BASE_FOV = 36;
const ZOOM_MIN_FOV = 18;
type WallArtFocus = "left" | "right" | null;
const QUALITY_MODES: PerformanceMode[] = ["auto", "low", "medium", "high"];
const ADMIN_COG_DOUBLE_TAP_MS = 180;
type LibraryMode = "collection" | "wantlist";
type WantlistStatus = "idle" | "loading" | "ready" | "error";

// multi-row shelves build around the turntable in row 1, with a blank cell either side
function playerSlot(cols: number, rows: number): { col: number; row: number } | null {
  if (rows < 2) return null;
  return { col: Math.floor((cols - 1) / 2), row: 1 };
}

function isReservedCell(col: number, row: number, slot: { col: number; row: number } | null): boolean {
  if (!slot) return false;
  if (row !== slot.row) return false;
  return col >= slot.col - 1 && col <= slot.col + 1;
}

function recordIndexFromId(recordId: string | null, total: number): number | null {
  if (!recordId) return null;
  const match = /-(\d+)$/.exec(recordId);
  if (!match) return null;
  const index = parseInt(match[1], 10);
  if (!Number.isInteger(index) || index < 0 || index >= total) return null;
  return index;
}

type Props = {
  // Records to lay out on the shelf. Defaults to the synthetic demo set.
  records?: DemoRecord[];
  // Discogs username, shown in the header. Falls back to "demo" if absent.
  username?: string;
  // Source label for the header ("discogs" or "demo").
  source?: "discogs" | "demo";
  wallArtUrls?: {
    left?: string;
    right?: string;
  };
  wallArtNotes?: {
    left?: HoverNote;
    right?: HoverNote;
  };
  wantlistRecords?: DemoRecord[];
  wantlistStatus?: WantlistStatus;
  onWantlistRequest?: () => void | Promise<void>;
  onReady?: () => void;
};

export default function Scene({
  records = demoRecords,
  username = "demo",
  source = "demo",
  wallArtUrls,
  wallArtNotes,
  wantlistRecords = [],
  wantlistStatus = "idle",
  onWantlistRequest,
  onReady,
}: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [flipRequest, setFlipRequest] = useState({ recordId: "", signal: 0 });
  const [libraryMode, setLibraryMode] = useState<LibraryMode>("collection");
  const pendingActiveIdRef = useRef<string | null>(null);
  const ledState = useLedState();
  const nowPlaying = useNowPlaying();
  const [turntableFocused, setTurntableFocused] = useState(false);
  const [focusedArt, setFocusedArt] = useState<WallArtFocus>(null);
  const hoverTransitionKeyRef = useRef<string | null>(null);
  const { tier, mode, setMode } = usePerformanceTier();
  const [dprMin, dprMax] = tierDpr(tier);
  const [dprFactor, setDprFactor] = useState(1);
  const dpr: [number, number] = mode === "auto" ? [dprMin, dprMin + (dprMax - dprMin) * dprFactor] : [dprMin, dprMax];
  const activeRecords = libraryMode === "wantlist" ? (wantlistStatus === "ready" ? wantlistRecords : []) : records;

  const clearTurntableFocus = () => setTurntableFocused(false);
  const clearWallArtFocus = () => setFocusedArt(null);

  const clearActiveRecord = () => {
    pendingActiveIdRef.current = null;
    setActiveId(null);
  };

  const changeLibraryMode = (next: LibraryMode) => {
    if (next === "wantlist") void onWantlistRequest?.();
    if (next === libraryMode) return;
    clearActiveRecord();
    clearTurntableFocus();
    clearWallArtFocus();
    if (ledState.remoteOpen) setRemoteOpen(false);
    if (ledState.paperOpen) setPaperOpen(false);
    muteHoverFor(650);
    setLibraryMode(next);
  };

  const requestActiveRecord = (nextId: string) => {
    // anything else in the foreground gets put down so the InfoPanel has the view
    if (turntableFocused) setTurntableFocused(false);
    if (focusedArt) setFocusedArt(null);
    if (ledState.remoteOpen) setRemoteOpen(false);
    if (ledState.paperOpen) setPaperOpen(false);
    if (pendingActiveIdRef.current) {
      pendingActiveIdRef.current = nextId;
      return;
    }
    if (activeId && activeId !== nextId) {
      if (recordIndexFromId(activeId, activeRecords.length) === null) {
        setActiveId(nextId);
        return;
      }
      pendingActiveIdRef.current = nextId;
      setActiveId(null);
      return;
    }
    setActiveId(activeId === nextId ? null : nextId);
  };

  const toggleTurntableFocus = () => {
    if (activeId) clearActiveRecord();
    if (focusedArt) setFocusedArt(null);
    if (ledState.remoteOpen) setRemoteOpen(false);
    if (ledState.paperOpen) setPaperOpen(false);
    setTurntableFocused((v) => !v);
  };

  const toggleWallArtFocus = (which: "left" | "right") => {
    if (activeId) clearActiveRecord();
    if (turntableFocused) setTurntableFocused(false);
    if (ledState.remoteOpen) setRemoteOpen(false);
    if (ledState.paperOpen) setPaperOpen(false);
    setFocusedArt((v) => (v === which ? null : which));
  };

  const handleRecordRetracted = () => {
    const nextId = pendingActiveIdRef.current;
    if (!nextId) return;
    pendingActiveIdRef.current = null;
    if (recordIndexFromId(nextId, activeRecords.length) === null) {
      setActiveId(null);
      return;
    }
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

  // arrow keys step through records, reading the pending id so presses mid-handoff still land
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
      const idx = recordIndexFromId(sourceId, activeRecords.length);
      if (idx === null) {
        clearActiveRecord();
        return;
      }
      const nextIdx = idx + delta;
      if (nextIdx < 0 || nextIdx >= activeRecords.length) return;
      e.preventDefault();
      requestActiveRecord(`${activeRecords[nextIdx].id}-${nextIdx}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, activeRecords]);

  const spineThickness = 0.006;
  const gap = 0.0006;
  const stride = spineThickness + gap;
  const RECORDS_PER_CELL = Math.floor((SHELF_INNER_W - 0.002) / stride);

  const total = activeRecords.length;
  const recordCellsNeeded = Math.max(1, Math.ceil(total / RECORDS_PER_CELL));

  // single-row shelves put the turntable on top; taller ones reserve 3 cells for it
  let cols = Math.min(MAX_COLS, recordCellsNeeded);
  let rows = Math.ceil(recordCellsNeeded / cols);
  if (rows >= 2) {
    const cellsWithSlot = recordCellsNeeded + 3;
    cols = Math.min(MAX_COLS, cellsWithSlot);
    rows = Math.ceil(cellsWithSlot / cols);
  }
  const slot = playerSlot(cols, rows);

  // bottom row fills left to right; rows above fill outside-in so partial rows stay balanced
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

  // upper rows interleave one record per cell so paired cells fill at the same rate
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

  const cellCounts = (() => {
    const counts = new Map<string, number>();
    for (let i = 0; i < activeRecords.length; i++) {
      const { col, row } = recordCell(i);
      const k = `${col},${row}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
  })();

  // partial cells stretch their spines wall to wall instead of leaving a gap
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
      const cellRightEdge = center.x + SHELF_INNER_W / 2 - 0.001;
      const x = cellRightEdge - inCellIdx * s - spineThickness / 2;
      return { x, y: center.y };
    }
    // Left-align (default): pack against the left wall, growing rightward.
    const cellLeftEdge = center.x - SHELF_INNER_W / 2 + 0.001;
    const x = cellLeftEdge + inCellIdx * s + spineThickness / 2;
    return { x, y: center.y };
  }

  // Half-width of the shelf in world units, used to position props clear of it
  const shelfHalfWidth = (cols * SHELF_CELL) / 2;
  const shelfTopY = SHELF_BOTTOM_Y + rows * SHELF_CELL_H;
  const ledStripY = shelfTopY - SHELF_WALL - 0.004;

  // shared with IdleCamera so the closeup can't miss its anchor
  const turntablePos: [number, number, number] = slot
    ? (() => {
        const cellCenter = shelfCellCenter(slot.col, slot.row, cols, rows);
        // Sit it on the floor of that cell (top of the shelf-below board).
        const slotFloorY = cellCenter.y - SHELF_CELL_H / 2 + SHELF_WALL / 2;
        return [cellCenter.x, slotFloorY, cellCenter.z + 0.04];
      })()
    : [0, shelfTopY, -0.16];

  const active = (() => {
    const idx = recordIndexFromId(activeId, activeRecords.length);
    if (idx === null) return null;
    return activeRecords[idx] ?? null;
  })();

  return (
    <div
      className="fixed inset-0"
      onPointerMove={(e) => {
        setHoverPos(e.clientX, e.clientY);
      }}
      onPointerLeave={clearHover}
    >
      <Canvas
        shadows={tier !== "low"}
        dpr={dpr}
        camera={{ position: [0.05, 0.52, 1.05], fov: BASE_FOV, near: 0.01, far: 50 }}
        gl={{ antialias: false, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: tier === "low" ? 0.82 : 0.6 }}
        onPointerMissed={() => {
          clearHover();
          clearActiveRecord();
          clearTurntableFocus();
          clearWallArtFocus();
          if (ledState.remoteOpen) setRemoteOpen(false);
          if (ledState.paperOpen) setPaperOpen(false);
        }}
      >
        {/* dusky warm cream, dimmer than midday, like dusk indoor light */}
        <color attach="background" args={[tier === "low" ? "#4a3a2a" : "#3a2e22"]} />
        {/* warm fog softens the back wall and adds depth */}
        <fog attach="fog" args={[tier === "low" ? "#3a2b1e" : "#2a1f15", 0.8, tier === "low" ? 3.8 : 3.2]} />

        {mode === "auto" && (
          <PerformanceMonitor factor={1} flipflops={3} onChange={({ factor }) => setDprFactor(Math.round(factor * 10) / 10)} />
        )}
        <Lights tier={tier} />
        <SceneReadySignal onReady={onReady} />

        {/* No HDRI environment, kills the bright IBL that was washing out the wall */}

        <Room />
        <RoomProps
          shelfHalfWidth={shelfHalfWidth}
          wallArtUrls={wallArtUrls}
          wallArtNotes={wallArtNotes}
          focusedArt={focusedArt}
          onSelectArt={toggleWallArtFocus}
        />
        {tier !== "low" && <RainShadow />}
        <Shelf cols={cols} rows={rows} />

        <Turntable
          position={turntablePos}
          accent={ACCENT_COLOR}
          nowPlaying={nowPlaying.loaded ? nowPlaying.data : null}
          focused={turntableFocused}
          onClick={toggleTurntableFocus}
        />

        {/* recessed behind the front lip so you see the glow, not the leds */}
        <RGBStrip
          position={[0, ledStripY, -0.012]}
          size={[cols * SHELF_CELL - SHELF_WALL * 2 - 0.002, 0.0035, 0.008]}
          count={(tier === "low" ? 12 : tier === "medium" ? 20 : 32) * cols}
          withLight={tier !== "low"}
          lightDistance={0.65}
          lightMultiplier={tier === "medium" ? 0.75 : 1.3}
          tier={tier}
        />
        {/* stops bloom bleeding up through the shelf top */}
        <mesh position={[0, ledStripY + 0.007, -0.012]}>
          <boxGeometry args={[cols * SHELF_CELL - SHELF_WALL * 2 + 0.004, 0.003, 0.04]} />
          <meshStandardMaterial color="#08060a" roughness={1.0} />
        </mesh>

        <Remote
          position={[shelfHalfWidth + 0.10, -0.176, 0.20]}
          rotation={[-0.05, Math.PI / 2, 0]}
        />

        <Paper
          position={[-(shelfHalfWidth + 0.05), -0.176, 0.48]}
          rotation={[0, -0.32, 0]}
        />

        {activeRecords.map((rec, i) => {
          const p = placeRecord(i);
          const recordId = `${rec.id}-${i}`;
          // discogs can return the same release twice, so keys get the index
          return (
            <VinylRecord
              key={recordId}
              rec={rec}
              shelfX={p.x}
              shelfY={p.y}
              active={activeId === recordId}
              disabled={turntableFocused || focusedArt !== null}
              quality={tier}
              onSelect={() => requestActiveRecord(recordId)}
              onRetracted={handleRecordRetracted}
              flipSignal={flipRequest.recordId === recordId ? flipRequest.signal : 0}
            />
          );
        })}

        {tier !== "low" && <DustMotes tier={tier} />}

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

        {tier === "high" ? (
          <EffectComposer multisampling={4}>
            <Bloom
              intensity={0.7}
              luminanceThreshold={0.55}
              luminanceSmoothing={0.5}
              kernelSize={KernelSize.LARGE}
            />
            {/* deeper vignette = the corners fall into dim cozy shadow */}
            <Vignette eskil={false} offset={0.28} darkness={0.85} />
            <Noise premultiply blendFunction={BlendFunction.SCREEN} opacity={0.35} />
          </EffectComposer>
        ) : tier === "medium" ? (
          <EffectComposer multisampling={0}>
            <Bloom
              intensity={0.45}
              luminanceThreshold={0.7}
              luminanceSmoothing={0.45}
              kernelSize={KernelSize.MEDIUM}
            />
            <Vignette eskil={false} offset={0.28} darkness={0.72} />
          </EffectComposer>
        ) : null}
      </Canvas>

      <InfoPanel rec={active} onClose={clearActiveRecord} onFlipBack={flipActiveRecordToBack} />
      <HoverTooltip />
      <Header total={total} username={username} source={source} mode={libraryMode} wantlistStatus={wantlistStatus} />
      <LibraryToggle
        mode={libraryMode}
        source={source}
        wantlistStatus={wantlistStatus}
        onModeChange={changeLibraryMode}
      />
      <Footer />
      <QualityGear mode={mode} tier={tier} username={username} source={source} hidden={active !== null} onModeChange={setMode} />
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

// idle drift, mouse parallax, scroll dolly, and the focus closeups, all critically damped
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
  turntableFocused: boolean;
  turntablePos: [number, number, number];
  focusedArt: WallArtFocus;
  shelfHalfWidth: number;
}) {
  const { camera } = useThree();
  // scrollDolly: user-driven dolly offset (added on top of size-derived dolly)
  const scrollDolly = useRef(0);
  // restored when the record is dismissed
  const stashedScrollDolly = useRef<number | null>(null);
  // 0..1 zoom into the active jacket, reset on every activation
  const zoomT = useRef(0);
  // mirrored so the wheel listener doesn't re-attach and drop events mid-transition
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

  // scratch vectors so the camera rig allocates nothing per frame
  const scratch = useRef({
    frontPos: new THREE.Vector3(),
    frontLook: new THREE.Vector3(),
    sidePos: new THREE.Vector3(),
    sideLook: new THREE.Vector3(),
    ttClosePos: new THREE.Vector3(),
    ttCloseLook: new THREE.Vector3(),
    artClosePos: new THREE.Vector3(),
    artCloseLook: new THREE.Vector3(),
    finalPos: new THREE.Vector3(),
    finalLook: new THREE.Vector3(),
  });

  // activation forces the head-on view and restores your scroll on dismiss
  useEffect(() => {
    if (active) {
      if (!activeRef.current) {
        // first activation in this session, stash the user's prior pose
        stashedScrollDolly.current = scrollDolly.current;
      }
      scrollDolly.current = 0;
      zoomT.current = 0;
    } else if (activeRef.current) {
      // dismissing, restore the user to their prior view
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
      // let opted-in regions like the InfoPanel scroll natively
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest("[data-allow-native-scroll]")
      ) {
        return;
      }

      muteHoverFor(450);

      if (activeRef.current) {
        e.preventDefault();
        const step = -e.deltaY * 0.0018;
        zoomT.current = Math.max(0, Math.min(1, zoomT.current + step));
        return;
      }

      // past -0.35 the camera swings round to the side view
      e.preventDefault();
      const step = e.deltaY * 0.0008;
      scrollDolly.current = Math.max(-1.5, Math.min(0.6, scrollDolly.current + step));
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  // pull back as the shelf grows, never framing tighter than 3 columns
  const cameraCols = Math.max(cols, 3);
  const dolly = useMemo(() => {
    const baseX = 0.05;
    const baseY = 0.52;
    const baseZ = 1.05;
    const dollyZ = baseZ + Math.max(0, cameraCols - 1) * 0.28 + Math.max(0, rows - 1) * 0.32;
    const dollyY = baseY + Math.max(0, rows - 1) * 0.18;
    return { x: baseX, y: dollyY, z: dollyZ };
  }, [cameraCols, rows]);

  const lookYBase = useMemo(() => -0.02 + Math.max(0, rows - 1) * 0.16, [rows]);

  useFrame((state, rawDt) => {
    const t = state.clock.elapsedTime;
    const dt = Math.min(rawDt, 0.05);
    if (focusedArt) lastFocusedArtRef.current = focusedArt;

    // the camera doesn't pan for an active record; FLOAT_TARGET.x offsets the record instead
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

    // Z dolly, smoothly chases the computed dolly distance.
    const targetZ = dolly.z;
    const sZ = step(o.z, o.vZ, targetZ - 1.05); o.z = sZ.p; o.vZ = sZ.v;

    // parallax is pinned to 0 while inspecting so pointer drift can't knock the view off
    const pX = state.pointer.x;       // -1 (left) … +1 (right)
    const pY = state.pointer.y;       // -1 (bottom) … +1 (top)
    const focusLocked = Boolean(active || focusedArt);
    const parTargetX = focusLocked ? 0 : pX * 0.06;     // ±6cm camera-X parallax
    const parTargetY = focusLocked ? 0 : -pY * 0.04;    // INVERTED: mouse-up → camera dips down to peek up at the top of shelf
    const sParX = step(o.parX, o.vParX, parTargetX, 2.6); o.parX = sParX.p; o.vParX = sParX.v;
    const sParY = step(o.parY, o.vParY, parTargetY, 2.6); o.parY = sParY.p; o.vParY = sParY.v;

    const sTt = step(o.ttBlend, o.vTtBlend, turntableFocused ? 1 : 0, 5.6);
    o.ttBlend = sTt.p; o.vTtBlend = sTt.v;

    const sArt = step(o.artBlend, o.vArtBlend, focusedArt ? 1 : 0, 5.2);
    o.artBlend = sArt.p; o.vArtBlend = sArt.v;

    // Scroll dolly: user-driven lean-in/lean-out, critically damped chase
    const sDoll = step(o.dollyZ, o.vDollyZ, scrollDolly.current, 3.2);
    o.dollyZ = sDoll.p; o.vDollyZ = sDoll.v;

    const sideBlend = Math.max(0, Math.min(1, (-0.35 - o.dollyZ) / 0.65));

    const sc = scratch.current;
    const sway = active ? 0.008 : 0.022;
    sc.frontPos.set(
      dolly.x + o.x + o.parX + Math.sin(t * 0.18) * sway,
      dolly.y + o.y + o.parY + Math.cos(t * 0.13) * sway * 0.5,
      1.05 + o.z + o.dollyZ,
    );
    sc.frontLook.set(
      o.lookX + o.parX * 0.5,
      lookYBase + o.lookY + o.parY * 0.4,
      0,
    );

    // ~55 degrees off the front; 90 foreshortened the spines too hard
    const shelfRightEdge = cameraCols * 0.5 * 0.33 + 0.28;     // SHELF_CELL ≈ 0.33m
    sc.sidePos.set(
      shelfRightEdge + o.parX * 0.5,
      dolly.y * 0.95 + o.parY,
      0.5 + o.z * 0.3,
    );
    sc.sideLook.set(
      -0.05 + o.parX * 0.3,
      lookYBase * 0.9 + o.parY * 0.4,
      0.05,
    );

    sc.finalPos.copy(sc.frontPos).lerp(sc.sidePos, sideBlend);
    sc.finalLook.copy(sc.frontLook).lerp(sc.sideLook, sideBlend);

    // high enough to see the label and the tonearm in one frame
    const ttBlend = o.ttBlend;
    if (ttBlend > 0.0005) {
      const ttSway = 0.005;
      sc.ttClosePos.set(
        turntablePos[0] + o.parX * 0.25 + Math.sin(t * 0.22) * ttSway,
        turntablePos[1] + 0.28 + o.parY * 0.15 + Math.cos(t * 0.17) * ttSway * 0.5,
        turntablePos[2] + 0.35,
      );
      sc.ttCloseLook.set(
        turntablePos[0] + o.parX * 0.08,
        turntablePos[1] + 0.06 + o.parY * 0.08,
        turntablePos[2],
      );
      sc.finalPos.lerp(sc.ttClosePos, ttBlend);
      sc.finalLook.lerp(sc.ttCloseLook, ttBlend);
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
      // the left frame is ~1.5x bigger, so it needs more distance
      const artCameraZ = artTarget === "left" ? 0.75 : 0.46;
      sc.artClosePos.set(
        artX + (artTarget === "left" ? 0.02 : -0.02) + o.parX * 0.12,
        artY + 0.02 + o.parY * 0.08,
        artZ + artCameraZ,
      );
      sc.artCloseLook.set(
        artX,
        artY,
        artZ,
      );
      sc.finalPos.lerp(sc.artClosePos, artBlend);
      sc.finalLook.lerp(sc.artCloseLook, artBlend);
    }

    camera.position.copy(sc.finalPos);
    camera.lookAt(sc.finalLook);

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

// key light for the floating jacket, dark covers were reading as silhouettes
function ActiveSpotlight({ active }: { active: boolean }) {
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

function TurntableSpotlight({
  focused,
  target,
}: {
  focused: boolean;
  // Plinth-base world position, same anchor used by the camera.
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
    const want = focused ? 1.25 : 0;
    intensity.current += (want - intensity.current) * Math.min(1, dt * 5);
    spotRef.current.intensity = intensity.current;
  });

  const [tx, ty, tz] = target;

  return (
    <>
      <spotLight
        ref={spotRef}
        // nudged forward or the tonearm ends up in shadow
        position={[tx, ty + 0.50, tz + 0.08]}
        angle={Math.PI / 5.5}
        penumbra={0.85}
        distance={1.4}
        decay={1.4}
        color={"#ffd9a8"}
        intensity={0}
        castShadow={false}
      />
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

function QualityGear({
  mode,
  tier,
  username,
  source,
  hidden = false,
  onModeChange,
}: {
  mode: PerformanceMode;
  tier: PerformanceTier;
  username: string;
  source?: "discogs" | "demo";
  hidden?: boolean;
  onModeChange: (mode: PerformanceMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [hiddenInput, setHiddenInput] = useState("");
  const [coverReleaseId, setCoverReleaseId] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [adminStatus, setAdminStatus] = useState("");
  const [adminBusy, setAdminBusy] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const lastCogClickAtRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      lastCogClickAtRef.current = 0;
      setOpen(false);
      setAdminOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const authHeaders = {
    Authorization: `Bearer ${adminPassword}`,
    "Content-Type": "application/json",
  };

  const authOnlyHeaders = {
    Authorization: `Bearer ${adminPassword}`,
  };

  const unlockAdmin = async () => {
    setAdminBusy("unlock");
    setAdminStatus("");
    try {
      const res = await fetch("/api/admin/hidden-releases", { headers: authOnlyHeaders });
      const data = await res.json().catch(() => ({})) as { ids?: string[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "admin unlock failed");
      setHiddenInput((data.ids ?? []).join("\n"));
      setAdminUnlocked(true);
      setAdminStatus("admin unlocked");
    } catch (err) {
      setAdminUnlocked(false);
      setAdminStatus(err instanceof Error ? err.message : "admin unlock failed");
    } finally {
      setAdminBusy(null);
    }
  };

  const refreshLibrary = async (kind: "collection" | "wantlist") => {
    setAdminBusy(kind);
    setAdminStatus("");
    try {
      const res = await fetch(`/api/${kind}?user=${encodeURIComponent(username)}&refresh=1`, { headers: authOnlyHeaders });
      const data = await res.json().catch(() => ({})) as { items?: unknown[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `${kind} refresh failed`);
      setAdminStatus(`${kind} refreshed · ${data.items?.length ?? 0} visible`);
    } catch (err) {
      setAdminStatus(err instanceof Error ? err.message : `${kind} refresh failed`);
    } finally {
      setAdminBusy(null);
    }
  };

  const saveHidden = async () => {
    setAdminBusy("hidden");
    setAdminStatus("");
    try {
      const res = await fetch("/api/admin/hidden-releases", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ input: hiddenInput, mode: "replace" }),
      });
      const data = await res.json().catch(() => ({})) as { ids?: string[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "hidden list save failed");
      setHiddenInput((data.ids ?? []).join("\n"));
      setAdminStatus("hidden list saved · reload room to apply");
    } catch (err) {
      setAdminStatus(err instanceof Error ? err.message : "hidden list save failed");
    } finally {
      setAdminBusy(null);
    }
  };

  const saveCover = async (remove = false) => {
    setAdminBusy("cover");
    setAdminStatus("");
    try {
      const res = await fetch("/api/admin/cover-overrides", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ releaseId: coverReleaseId, url: coverUrl, remove }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "cover override failed");
      setAdminStatus(remove ? "cover override removed · reload room to apply" : "cover override saved · reload room to apply");
      if (!remove) setCoverUrl("");
    } catch (err) {
      setAdminStatus(err instanceof Error ? err.message : "cover override failed");
    } finally {
      setAdminBusy(null);
    }
  };

  const handleCogClick = () => {
    const now = performance.now();
    const quickSecondTap = now - lastCogClickAtRef.current <= ADMIN_COG_DOUBLE_TAP_MS;
    lastCogClickAtRef.current = now;

    if (quickSecondTap) {
      setOpen(true);
      setAdminOpen(true);
      setAdminStatus("");
      return;
    }

    const nextOpen = !open;
    setOpen(nextOpen);
    if (!nextOpen) {
      lastCogClickAtRef.current = 0;
      setAdminOpen(false);
      setAdminStatus("");
    }
  };

  const inputClass = "w-full rounded-xl border border-ink/15 bg-white/55 px-2.5 py-2 font-sans text-[11px] text-ink outline-none transition placeholder:text-inkSoft/45 focus:border-ink/35 focus:bg-white/70";
  const buttonClass = "rounded-full border border-ink/15 bg-ink/[0.04] px-3 py-1.5 font-sans text-[9px] uppercase tracking-[0.2em] text-inkSoft transition hover:border-ink/25 hover:bg-ink/10 hover:text-ink disabled:cursor-not-allowed disabled:opacity-45";
  const activeButtonClass = "rounded-full border border-ink/70 bg-ink px-3 py-1.5 font-sans text-[9px] uppercase tracking-[0.2em] text-paper shadow-[0_8px_20px_rgba(45,37,28,0.16)] transition disabled:cursor-not-allowed disabled:opacity-45";

  return (
    <div
      ref={rootRef}
      aria-hidden={hidden || undefined}
      className={`absolute bottom-16 right-7 z-50 flex flex-col items-end gap-2 transition-opacity duration-300 ${hidden ? "pointer-events-none opacity-0" : "pointer-events-auto opacity-100"}`}
    >
      {open && (
        <div data-allow-native-scroll="true" className={`${adminOpen ? "w-[24rem]" : "w-56"} max-h-[72vh] overflow-y-auto rounded-2xl border border-ink/15 bg-paper/95 p-3 text-ink shadow-[0_18px_70px_rgba(0,0,0,0.34)] backdrop-blur-md`}>
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="font-sans text-[9px] uppercase tracking-[0.3em] text-inkSoft/80">quality</div>
            <div className="rounded-full bg-ink/10 px-2 py-0.5 font-sans text-[9px] uppercase tracking-[0.22em] text-ink/80">
              {tier}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {QUALITY_MODES.map((item) => {
              const active = mode === item;
              return (
                <button
                  key={item}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onModeChange(item)}
                  className={[
                    "rounded-full border px-2 py-1.5 font-sans text-[9px] uppercase tracking-[0.2em] transition",
                    active
                      ? "border-ink/70 bg-ink text-paper shadow-[0_8px_20px_rgba(45,37,28,0.16)]"
                      : "border-ink/15 bg-ink/[0.04] text-inkSoft hover:border-ink/25 hover:bg-ink/10 hover:text-ink",
                  ].join(" ")}
                >
                  {item === "auto" ? `auto · ${tier}` : item}
                </button>
              );
            })}
          </div>
          {adminOpen ? (
            <div className="mt-4 border-t border-ink/10 pt-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="font-sans text-[9px] uppercase tracking-[0.3em] text-inkSoft/80">admin</div>
                <button
                  type="button"
                  onClick={() => {
                    setAdminOpen(false);
                    setAdminStatus("");
                  }}
                  className="font-sans text-[9px] uppercase tracking-[0.2em] text-inkSoft/55 transition hover:text-ink"
                >
                  close
                </button>
              </div>
              {!adminUnlocked ? (
                <form
                  className="space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void unlockAdmin();
                  }}
                >
                  <input
                    type="password"
                    value={adminPassword}
                    onChange={(event) => setAdminPassword(event.target.value)}
                    placeholder="admin password"
                    className={inputClass}
                  />
                  <button type="submit" disabled={adminBusy !== null || adminPassword.trim() === ""} className={activeButtonClass}>
                    {adminBusy === "unlock" ? "checking" : "unlock"}
                  </button>
                </form>
              ) : (
                <div className="space-y-4">
                  <div>
                    <div className="mb-2 font-sans text-[9px] uppercase tracking-[0.24em] text-inkSoft/70">refresh</div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={adminBusy !== null || source !== "discogs"}
                        onClick={() => void refreshLibrary("collection")}
                        className={buttonClass}
                      >
                        {adminBusy === "collection" ? "refreshing" : "collection"}
                      </button>
                      <button
                        type="button"
                        disabled={adminBusy !== null || source !== "discogs"}
                        onClick={() => void refreshLibrary("wantlist")}
                        className={buttonClass}
                      >
                        {adminBusy === "wantlist" ? "refreshing" : "wantlist"}
                      </button>
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 font-sans text-[9px] uppercase tracking-[0.24em] text-inkSoft/70">hidden releases</div>
                    <textarea
                      value={hiddenInput}
                      onChange={(event) => setHiddenInput(event.target.value)}
                      rows={5}
                      placeholder={"12345\nhttps://www.discogs.com/release/67890-album"}
                      className={`${inputClass} resize-y leading-relaxed`}
                    />
                    <button type="button" disabled={adminBusy !== null} onClick={() => void saveHidden()} className={`mt-2 ${activeButtonClass}`}>
                      {adminBusy === "hidden" ? "saving" : "save hidden list"}
                    </button>
                  </div>
                  <div>
                    <div className="mb-2 font-sans text-[9px] uppercase tracking-[0.24em] text-inkSoft/70">cover override</div>
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={coverReleaseId}
                        onChange={(event) => setCoverReleaseId(event.target.value)}
                        placeholder="release id or discogs release URL"
                        className={inputClass}
                      />
                      <input
                        type="url"
                        value={coverUrl}
                        onChange={(event) => setCoverUrl(event.target.value)}
                        placeholder="replacement image URL"
                        className={inputClass}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={adminBusy !== null || coverReleaseId.trim() === "" || coverUrl.trim() === ""} onClick={() => void saveCover(false)} className={activeButtonClass}>
                          {adminBusy === "cover" ? "saving" : "save cover"}
                        </button>
                        <button type="button" disabled={adminBusy !== null || coverReleaseId.trim() === ""} onClick={() => void saveCover(true)} className={buttonClass}>
                          remove
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {adminStatus ? (
                <div className="mt-3 rounded-xl bg-ink/[0.06] px-3 py-2 font-sans text-[10px] leading-relaxed text-inkSoft">
                  {adminStatus}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
      <button
        type="button"
        aria-label="Quality settings"
        aria-expanded={open}
        onClick={handleCogClick}
        className="grid h-9 w-9 place-items-center rounded-full border border-paper/10 bg-[#120d09]/45 text-paper/50 shadow-[0_10px_34px_rgba(0,0,0,0.22)] backdrop-blur-md transition hover:border-paper/20 hover:bg-[#120d09]/65 hover:text-paper/85"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
        </svg>
      </button>
    </div>
  );
}

function LibraryToggle({
  mode,
  source,
  wantlistStatus,
  onModeChange,
}: {
  mode: LibraryMode;
  source?: "discogs" | "demo";
  wantlistStatus: WantlistStatus;
  onModeChange: (mode: LibraryMode) => void;
}) {
  if (source !== "discogs") return null;

  const options: LibraryMode[] = ["collection", "wantlist"];

  return (
    <div className="pointer-events-auto absolute left-1/2 top-7 z-20 flex -translate-x-1/2 rounded-full border border-paper/10 bg-[#120d09]/55 p-1 shadow-[0_12px_44px_rgba(0,0,0,0.24)] backdrop-blur-md">
      {options.map((item) => {
        const active = mode === item;
        const loading = item === "wantlist" && wantlistStatus === "loading";
        return (
          <button
            key={item}
            type="button"
            aria-pressed={active}
            onClick={() => onModeChange(item)}
            className={[
              "rounded-full px-3 py-1.5 font-sans text-[9px] uppercase tracking-[0.24em] transition",
              active
                ? "bg-paper/90 text-[#160f09] shadow-[0_0_18px_rgba(236,219,184,0.12)]"
                : "text-paper/60 hover:bg-paper/10 hover:text-paper",
            ].join(" ")}
          >
            {loading ? "loading" : item}
          </button>
        );
      })}
    </div>
  );
}

function Header({
  total,
  mode,
  wantlistStatus,
}: {
  total: number;
  username?: string;
  source?: "discogs" | "demo";
  mode: LibraryMode;
  wantlistStatus: WantlistStatus;
}) {
  const countLabel = mode === "wantlist"
    ? wantlistStatus === "loading"
      ? "loading wantlist..."
      : wantlistStatus === "error"
        ? "wantlist unavailable"
        : `${total} wanted · sort: a-z`
    : `${total} records · sort: a-z`;

  return (
    <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 flex items-center justify-between p-7">
      <span className="serif text-lg italic text-paper/75">rycord</span>
      <div className="font-sans text-[10px] uppercase tracking-[0.32em] text-paper/50 tabular-nums">
        {countLabel}
      </div>
    </div>
  );
}

function Footer() {
  return (
    <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-10 flex items-center justify-between p-7">
      <div className="font-sans text-[10px] uppercase tracking-[0.32em] text-paper/35">
        click any spine to pull out · scroll to zoom · click out to slide back
      </div>
      <div className="font-sans text-[10px] uppercase tracking-[0.32em] text-paper/30">
        v0.2.0
      </div>
    </div>
  );
}
