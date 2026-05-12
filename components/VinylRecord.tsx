"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { generateCoverCanvas, generateSpineCanvas, generateBackCanvas, type BackTrack } from "@/lib/generateCover";
import type { DemoRecord } from "@/lib/covers";
import { setHoveredRecord } from "@/lib/hoverStore";
import { loadReleaseDetails } from "@/lib/releaseDetails";

// Geometry orientation for a vinyl jacket on a shelf:
//   X = thin axis     (spine thickness ~6mm) — how records pack along the shelf
//   Y = vertical       (sleeve height ~31cm)
//   Z = into the shelf (sleeve depth ~31cm, narrow edge faces +Z = camera)
//
// box face indices in Three.js are PX, NX, PY, NY, PZ, NZ. With the jacket
// oriented as above:
//   material-0 (+X face) = cover front
//   material-1 (-X face) = cover back
//   material-2 (+Y face) = top edge (white paper)
//   material-3 (-Y face) = bottom edge
//   material-4 (+Z face) = spine (faces camera when nested in shelf)
//   material-5 (-Z face) = back edge
//
// IMPORTANT: when nested in shelf the spine faces +Z (camera). When the
// jacket pulls out and floats, we rotate Y so the front face (+X) sweeps
// past camera, then -X (back), then back to spine. That gives the
// "rotating to show front and back" effect.
const SX = 0.006;   // spine thickness
const SY = 0.308;   // jacket height
const SZ = 0.30;    // jacket depth/width (the visible "square" face dimensions)

// Resting position inside the cell. Shelf z=-0.16, cell front lip at +0.005
// world. Center the jacket at z=-0.151 so spine is right at the front opening.
const SHELF_REST_Z = -0.151;

// Float target: where the record floats while the sidebar is open. We want it
// horizontally centered in the LEFT 2/3 of the screen (since the right ~360px
// of the screen is the panel). In world space, that's a small negative x.
// y is lifted ABOVE the shelf top board (~0.18m), z forward toward camera so
// the user has a clean unobstructed view of the album art.
// The floating record sits at this world position once fully pulled out.
//   x  = horizontal offset; the side panel covers the right ~40% of the
//        viewport, so the visible-canvas center sits at viewport NDC ≈ −0.4.
//        With the camera aimed at world x=0, a record at world x ≈ −0.10
//        projects to that visual center (math depends on FOV + distance,
//        derived empirically at the standard 1024-wide layout).
//   y  = eye-line height (sits above the shelf top).
//   z  = distance from the shelf face; smaller value = CLOSER to camera =
//        BIGGER on screen. 0.62 is ~25% closer than the original 0.50.
// z=0.55 brings the record even closer than v0.1.6's 0.62 (~12% bigger
// still). This is now safe to do because v0.1.7 force-snaps scrollDolly
// to 0 on activate (see Scene.tsx) — meaning the camera is GUARANTEED
// to be at its default head-on pose when a record floats out. Previously
// we kept z=0.62 as a safety margin in case the user was zoomed-in
// when they clicked, which would have over-cropped the record.
const FLOAT_TARGET = { x: -0.10, y: 0.17, z: 0.55 };

// Hover preview: tip the TOP of the jacket DOWN and toward the user
// (like flicking forward through a crate of records — you peek by
// pulling the top edge toward you). Positive X rotation here rotates
// local +Y → +Z, so the top edge comes toward camera.
const HOVER_TILT_X = 0.14;    // radians; top corner comes DOWN + OUT toward camera
const HOVER_NUDGE_Z = 0.020;  // meters of forward nudge

// Once the record is fully extracted and facing front, hold for this long
// before letting it start spinning. Gives the user a clean look at the
// album art before motion begins.
const FRONT_HOLD_S = 0.8;

// Ambient rocking (when active + no user drag): the record gently sways
// ±ROCK_AMP radians around the front-face axis at ROCK_FREQ Hz. Reads as
// "the record is settling / breathing" rather than the previous full
// auto-spin, which made album art unreadable after the first few seconds.
const ROCK_AMP = 0.16;     // radians (~9°)
const ROCK_FREQ = 0.32;    // Hz (one cycle every ~3.1s)

// Drag-to-spin: 1 px of horizontal pointer drag rotates the record by
// this many radians. ~80px to flip cover→back, ~320px for a full spin.
const DRAG_RAD_PER_PX = 0.012;

// Pixels of motion during a pointerdown before we treat it as a drag (and
// suppress the would-be onClick that dismisses the record).
const DRAG_PX_THRESHOLD = 3;

// Friction on user-imparted angular momentum after they release. The
// velocity halves every ~0.85s (e^{-FRICTION_HZ * t}). Slow enough that a
// good flick keeps spinning for ~2-3 full revolutions.
const FRICTION_HZ = 0.82;

// Below this angular velocity we drop momentum entirely and resume the
// ambient rocking. Prevents the rocking from being permanently nudged off
// center by tiny residual velocity.
const MOMENTUM_CUTOFF = 0.05;

const PULL_OPEN_OMEGA = 5.5;
const PULL_CLOSE_OMEGA = 9.5;
const CLOSE_SPIN_SETTLE_RATE = 12;
const CLOSE_ROT_SETTLED_EPS = 0.09;
const CLOSE_HANDOFF_P = 0.18;

// Front-face Y rotation: rotating the jacket -π/2 about Y maps local +X
// (cover front) to world +Z (toward camera).
const FRONT_FACE_Y = -Math.PI / 2;

// Shared jacket geometry. Every record has the EXACT same box dimensions
// (SX × SY × SZ), so it would be wasteful for R3F to allocate a separate
// BufferGeometry per <VinylRecord/> instance. With ~16-50 records, sharing
// one BoxGeometry across all of them saves 15-49 redundant geometry
// uploads to the GPU and corresponding allocations in JS-land. Materials
// stay per-instance (each record has unique cover/spine/back maps).
const JACKET_GEOMETRY = new THREE.BoxGeometry(SX, SY, SZ);

type Props = {
  rec: DemoRecord;
  shelfX: number;
  /** Y of the cell center this record sits in. Defaults to 0 (single-row shelf). */
  shelfY?: number;
  active: boolean;
  disabled?: boolean;
  onSelect: () => void;
  onRetracted?: () => void;
  flipSignal?: number;
};

export default function VinylRecord({ rec, shelfX, shelfY = 0, active, disabled = false, onSelect, onRetracted, flipSignal = 0 }: Props) {
  const group = useRef<THREE.Group>(null);
  const [hover, setHover] = useState(false);

  // Springs:
  //   pull:   0 = nested in shelf, 1 = fully floating + spinning
  //   hover:  0 = nothing, 1 = leaned-back preview pose
  //   spin:   accumulator. We rotate Y by `spinAngle` continuously while
  //           the record is past the hold window, and decelerates back to a
  //           multiple of 2π on close so the jacket ends spine-forward.
  //
  // The OPEN flow is now phased:
  //   1. slide forward + lift out of cell, ramping rotation toward -π/2
  //      so the FRONT COVER ends up facing the camera once fully extracted
  //   2. hold front-face for FRONT_HOLD_S so the user sees the album art
  //      cleanly before any spin starts
  //   3. begin spinning around the front-face center
  //
  // The CLOSE flow is also phased — we don't start retracting position
  // until the spin has fully decayed AND the rotation has wrapped to 0,
  // so the spine is always forward-facing when it re-enters the cell.
  const pullState = useRef({ p: 0, v: 0 });
  const hoverState = useRef({ p: 0, v: 0 });
  const wasPulledOut = useRef(false);
  // spinAngle: accumulated offset from front-face (FRONT_FACE_Y baseline).
  // Drives both ambient rocking (eased toward ROCK_AMP * sin(t)) and user
  // drag/momentum (set directly by pointer-move handler).
  const spinAngle = useRef(0);
  // spinVel: angular velocity in rad/s. Only nonzero when user is dragging
  // or when momentum is still decaying after release. Ambient rocking does
  // NOT use this — it eases spinAngle directly so it can't be permanently
  // offset by residual velocity.
  const spinVel = useRef(0);
  const spinRestCenter = useRef(0);
  const commandedSpinTarget = useRef<number | null>(null);
  const lastFlipSignal = useRef(flipSignal);
  const frontHoldStart = useRef<number | null>(null);
  const closing = useRef(false);
  // Drag state. `active` while pointer is held down on the floating record;
  // `moved` is set the moment the cumulative pointer delta exceeds
  // DRAG_PX_THRESHOLD, and is used to suppress the would-be onClick on
  // pointerup (so dragging doesn't accidentally dismiss the record).
  const dragRef = useRef({
    active: false,
    moved: false,
    lastX: 0,
    lastT: 0,
  });
  const flipDirection = useRef(1);

  // Procedural fallback texture (used as immediate placeholder while the
  // real cover image loads, and as the only texture if no coverUrl is set).
  const { proceduralCoverMap, spineMap, backMap: proceduralBackMap, edgeColor, topEdgeColor } = useMemo(() => {
    if (typeof document === "undefined") {
      return {
        proceduralCoverMap: null,
        spineMap: null,
        backMap: null,
        edgeColor: rec.palette.bg,
        topEdgeColor: rec.palette.bg,
      };
    }
    const cover = generateCoverCanvas(rec, 1024);
    const spine = generateSpineCanvas(rec, 48, 2400);
    const back = generateBackCanvas(rec, 1024);
    const t = (c: HTMLCanvasElement) => {
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      tex.needsUpdate = true;
      return tex;
    };
    return {
      proceduralCoverMap: t(cover),
      spineMap: t(spine),
      backMap: t(back),
      edgeColor: shadeHex(rec.palette.bg, -0.18),
      // top edge is a near-black matte so the LED cove glow doesn't reflect
      // bright stripes across the top of the records. real vinyl jackets are
      // dark fiberboard at the cut edge anyway — this matches.
      topEdgeColor: shadeHex(rec.palette.bg, -0.7),
    };
  }, [rec]);

  // Real cover image (Discogs). Loaded async, falls back to procedural if
  // it's missing or fails to load.
  const [realCoverMap, setRealCoverMap] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!rec.coverUrl) {
      setRealCoverMap(null);
      return;
    }
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(
      rec.coverUrl,
      (tex) => {
        if (cancelled) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        tex.needsUpdate = true;
        setRealCoverMap(tex);
      },
      undefined,
      () => {
        // load failed — keep procedural fallback
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rec.coverUrl]);

  const coverMap = realCoverMap ?? proceduralCoverMap;

  // Real release details (Discogs). Lazy-loaded the first time this record
  // is activated. Once loaded we regenerate the back-cover canvas + texture
  // so the spinning back face shows real song titles AND the right country
  // (Discogs doesn't ship country on the collection endpoint, only on the
  // full release endpoint, so this is the moment we get to fill it in).
  const [realBackMap, setRealBackMap] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!active) return;
    if (typeof document === "undefined") return;
    let cancelled = false;
    loadReleaseDetails(rec.id).then((details) => {
      if (cancelled) return;
      if (details.tracks.length === 0 && !details.country && details.year <= 0) return;
      // Build a synthesized record that overlays the freshly-fetched country
      // onto the original rec, so the back-cover metadata band renders the
      // real country instead of the empty string we got from the collection.
      const enriched: DemoRecord = {
        ...rec,
        country: details.country || rec.country,
        year: details.year > 0 ? details.year : rec.year,
      };
      const tracks: BackTrack[] = details.tracks.map((t) => ({
        title: t.title,
        position: t.position,
        duration: t.duration,
      }));
      const canvas = generateBackCanvas(enriched, 1024, tracks.length > 0 ? tracks : undefined);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      tex.needsUpdate = true;
      setRealBackMap(tex);
    });
    return () => {
      cancelled = true;
    };
  }, [active, rec]);

  const backMap = realBackMap ?? proceduralBackMap;

  useEffect(() => {
    if (flipSignal === lastFlipSignal.current) return;
    lastFlipSignal.current = flipSignal;
    if (!active) return;
    const current = spinAngle.current;
    const target = current + Math.PI * flipDirection.current;
    flipDirection.current *= -1;
    spinRestCenter.current = target;
    commandedSpinTarget.current = target;
    spinVel.current = 0;
  }, [active, flipSignal]);

  useEffect(() => {
    if (active) return;
    spinRestCenter.current = 0;
    commandedSpinTarget.current = null;
  }, [active]);

  useFrame((state, rawDt) => {
    if (!group.current) return;
    const dt = Math.min(rawDt, 0.05);
    const t = state.clock.elapsedTime;

    // Idle early-out: when this record is fully nested in the shelf,
    // unhovered, inactive, AND all its spring state has fully settled, the
    // entire body below is a no-op against the existing position/rotation.
    // Skipping it costs only a few comparisons but saves the spring math +
    // group.position.set / spin integration on every other record that
    // isn't actively being interacted with. With a 50-record shelf this is
    // ~49 records doing nothing every frame.
    if (
      !active &&
      !hover &&
      !closing.current &&
      pullState.current.p < 0.001 &&
      Math.abs(pullState.current.v) < 0.001 &&
      hoverState.current.p < 0.001 &&
      Math.abs(hoverState.current.v) < 0.001 &&
      Math.abs(spinAngle.current) < 0.001 &&
      Math.abs(spinVel.current) < 0.001 &&
      commandedSpinTarget.current === null
    ) {
      return;
    }

    // Track open / closing transitions. We "close" through an explicit
    // spin-down phase (see below) before retracting position.
    if (active) {
      closing.current = false;
    } else if (pullState.current.p > 0.05 && !closing.current) {
      closing.current = true;
    } else if (pullState.current.p < 0.02) {
      closing.current = false;
    }

    // === phase 1 of close: hold position floating while spin decays ===
    // While closing, target=p (i.e. don't move) until the spin angle has
    // wrapped to ~0 and the angular velocity is near zero. Once both
    // conditions are met, target snaps to 0 and the position retracts.
    let pullTarget = active ? 1 : 0;
    if (closing.current) {
      // wrap the current spin angle into [-π, π] (shortest path back to 0)
      const wrap = (a: number) => {
        let x = ((a + Math.PI) % (Math.PI * 2));
        if (x < 0) x += Math.PI * 2;
        return x - Math.PI;
      };
      const wrappedAngle = wrap(spinAngle.current);
      const rotSettled = Math.abs(wrappedAngle) < CLOSE_ROT_SETTLED_EPS && Math.abs(spinVel.current) < 0.08;
      if (!rotSettled) {
        // hold position; just keep spinning down
        pullTarget = pullState.current.p;
      }
    }

    spring(pullState.current, pullTarget, dt, active ? PULL_OPEN_OMEGA : PULL_CLOSE_OMEGA);
    // hover preview spring (only when not pulled out)
    spring(hoverState.current, hover && !active ? 1 : 0, dt, /* omega */ 12);

    const p = pullState.current.p;
    const h = hoverState.current.p;
    if (p > 0.12) wasPulledOut.current = true;
    if (!active && wasPulledOut.current && p < CLOSE_HANDOFF_P) {
      wasPulledOut.current = false;
      onRetracted?.();
    }

    // PHASED stages of the pull animation:
    //   0    .. 0.45  — slide forward + up out of the cell
    //   0.20 .. 0.85  — continue forward, ROTATE Y toward FRONT_FACE_Y so
    //                   the cover front ends up facing the camera at p≈0.85
    //   0.55 .. 1.0   — settle at FLOAT_TARGET, gentle bob
    const eExtract = easeInOutCubic(clamp01(p / 0.45));
    const eTravel  = easeInOutCubic(clamp01((p - 0.20) / 0.65));
    const eFloat   = easeInOutCubic(clamp01((p - 0.55) / 0.45));

    // === position ===
    const restX = shelfX;
    const restY = shelfY;
    const restZ = SHELF_REST_Z;

    const xFromShelf = restX + (FLOAT_TARGET.x - restX) * eTravel;
    const yFromShelf = restY + (FLOAT_TARGET.y - restY) * eFloat;
    const zFromShelf = restZ + (FLOAT_TARGET.z - restZ) * eExtract;

    const hoverZ = h * HOVER_NUDGE_Z * (1 - eExtract);
    const bob = eFloat * Math.sin(t * 0.9) * 0.008;

    group.current.position.set(xFromShelf, yFromShelf + bob, zFromShelf + hoverZ);

    // === rotation ===
    // The Y rotation has two components:
    //   1. BASE: ramps from 0 (spine forward) to FRONT_FACE_Y (front cover
    //      forward) following the extract+travel curve. This is what lets
    //      the user see the album art the instant the record is fully out.
    //   2. SPIN: an accumulator that runs once the record is fully
    //      extracted AND has held its front face for FRONT_HOLD_S seconds.
    const baseRotation = FRONT_FACE_Y * eTravel;

    // Front-hold gate: once p crosses ~0.85 (record is mostly extracted),
    // start the front-face timer. After FRONT_HOLD_S the spin is enabled.
    // We DON'T require the spring to fully settle because the spring's
    // velocity decay tail is long and the user perceives the record as
    // "stationary" well before the spring stops integrating.
    if (active && !closing.current && p > 0.85) {
      if (frontHoldStart.current === null) frontHoldStart.current = t;
    } else if (!active && p < 0.5) {
      frontHoldStart.current = null;
    }
    const holdElapsed = frontHoldStart.current !== null ? t - frontHoldStart.current : 0;
    const spinAllowed = holdElapsed > FRONT_HOLD_S && !closing.current;

    // Rotation update has four mutually-exclusive modes:
    //   1. CLOSING: ease spinAngle to nearest 2π multiple, then to 0
    //   2. DRAGGING: pointer-move handler is writing to spinAngle/spinVel
    //      directly; we only need to integrate the visible angle here
    //   3. MOMENTUM: user released after a flick; spinVel decays under
    //      friction and we integrate it into spinAngle
    //   4. ROCKING: ambient idle motion; ease spinAngle toward
    //      ROCK_AMP * sin(t * 2π * ROCK_FREQ)
    if (closing.current) {
      // wrap into (-π, π] then exponentially shrink toward 0
      let a = ((spinAngle.current + Math.PI) % (Math.PI * 2));
      if (a < 0) a += Math.PI * 2;
      a -= Math.PI;
      spinAngle.current = a * (1 - Math.min(1, dt * CLOSE_SPIN_SETTLE_RATE));
      spinVel.current = 0;
    } else if (commandedSpinTarget.current !== null && p > 0.85) {
      const target = commandedSpinTarget.current;
      const diff = target - spinAngle.current;
      spinAngle.current += diff * Math.min(1, dt * 7);
      spinVel.current = 0;
      if (Math.abs(diff) < 0.02) {
        spinAngle.current = target;
        commandedSpinTarget.current = null;
      }
    } else if (!spinAllowed) {
      // pre-front-hold: keep the record dead steady at FRONT_FACE_Y
      spinAngle.current *= Math.exp(-3 * dt);
      spinVel.current = 0;
    } else if (dragRef.current.active) {
      // pointermove handler is mutating spinAngle/spinVel directly
    } else if (Math.abs(spinVel.current) > MOMENTUM_CUTOFF) {
      // momentum decay after release
      spinVel.current *= Math.exp(-FRICTION_HZ * dt);
      spinAngle.current += spinVel.current * dt;
    } else {
      // ambient rocking: ease toward a slowly-oscillating target
      spinVel.current = 0;
      const target = spinRestCenter.current + ROCK_AMP * Math.sin(t * Math.PI * 2 * ROCK_FREQ);
      const k = 3.5; // ease rate
      spinAngle.current += (target - spinAngle.current) * Math.min(1, k * dt);
    }

    // hover preview tilts the TOP of the jacket back toward the camera (rotate X)
    const hoverTiltX = h * HOVER_TILT_X * (1 - eExtract);

    group.current.rotation.set(hoverTiltX, baseRotation + spinAngle.current, 0);
  });

  return (
    <group
      ref={group}
      position={[shelfX, shelfY, SHELF_REST_Z]}
      onPointerOver={(e) => {
        e.stopPropagation();
        if (disabled) {
          setHoveredRecord(null);
          document.body.style.cursor = "auto";
          return;
        }
        setHover(true);
        // only show the hover label when the record is nested in the shelf;
        // once it's floating + spinning, the InfoPanel already labels it.
        if (!active) setHoveredRecord(rec);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        setHover(false);
        setHoveredRecord(null);
        document.body.style.cursor = "auto";
      }}
      onClick={(e) => {
        if (disabled) {
          e.stopPropagation();
          return;
        }
        // suppress click if the user dragged — we don't want a flick-spin
        // to also dismiss the record.
        if (dragRef.current.moved) {
          dragRef.current.moved = false;
          return;
        }
        // Always swallow the click so it can't reach the canvas's
        // `onPointerMissed` handler (which dismisses the active record) or
        // raycast through to records behind the floating one.
        e.stopPropagation();
        // When THIS record is the active/pulled-out one, a click on its
        // body is a no-op — clicks don't dismiss; dismiss is exclusively
        // "click empty space" or the ESC button in the InfoPanel.
        if (active) return;
        setHoveredRecord(null);
        onSelect();
      }}
      onPointerDown={(e) => {
        if (disabled) {
          e.stopPropagation();
          return;
        }
        // Only let the user drag-spin once the record is fully extracted +
        // past the front-hold delay; otherwise pointerdown is just the
        // start of a click that would toggle active state.
        if (!active || pullState.current.p < 0.95) return;
        e.stopPropagation();
        dragRef.current.active = true;
        dragRef.current.moved = false;
        dragRef.current.lastX = e.clientX;
        dragRef.current.lastT = performance.now();

        const onMove = (ev: PointerEvent) => {
          if (!dragRef.current.active) return;
          const dx = ev.clientX - dragRef.current.lastX;
          if (Math.abs(dx) > DRAG_PX_THRESHOLD) dragRef.current.moved = true;
          const now = performance.now();
          const dtS = Math.max(0.001, (now - dragRef.current.lastT) / 1000);
          dragRef.current.lastX = ev.clientX;
          dragRef.current.lastT = now;

          // dragging right → positive dx → the cover's RIGHT edge should
          // sweep TOWARD the camera (like a real DJ scrubbing a record to
          // the right). Looking down the +Y axis at the jacket, this is a
          // POSITIVE Y rotation in three.js right-hand coords. Earlier I
          // had this sign backwards, so dragging right spun the record
          // counter to user expectation.
          const dRot = dx * DRAG_RAD_PER_PX;
          spinAngle.current += dRot;
          spinVel.current = dRot / dtS;
        };

        const onUp = () => {
          const wasMoved = dragRef.current.moved;
          dragRef.current.active = false;
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onUp);

          // If the user actually dragged (vs. just tapped), the upcoming
          // synthetic `click` event from this pointerup MIGHT land on a
          // record behind the floating one — because r3f re-raycasts on
          // click and the pointer is no longer over our mesh. That would
          // toggle a different record and look like a misclick. Install
          // a one-shot capture-phase listener on `window` that swallows
          // the next click before any r3f handler sees it.
          if (wasMoved) {
            const suppressClick = (ev: Event) => {
              ev.stopImmediatePropagation();
              ev.preventDefault();
              window.removeEventListener("click", suppressClick, true);
            };
            window.addEventListener("click", suppressClick, true);
            // safety: if no click is dispatched (some browsers skip it
            // when the pointer moved more than a few px), tear down the
            // listener after a frame so it doesn't swallow a future click.
            setTimeout(() => {
              window.removeEventListener("click", suppressClick, true);
            }, 50);
          }
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
      }}
    >
      <mesh castShadow receiveShadow geometry={JACKET_GEOMETRY}>
        {/* Face order: +X cover front, -X cover back, +Y top edge, -Y bot edge,
            +Z spine (faces camera at rest), -Z back of spine (toward back wall). */}
        <meshStandardMaterial attach="material-0" map={coverMap} roughness={0.55} metalness={0.04} />
        <meshStandardMaterial attach="material-1" map={backMap} roughness={0.55} metalness={0.04} />
        <meshStandardMaterial attach="material-2" color={topEdgeColor} roughness={1.0} metalness={0} />
        <meshStandardMaterial attach="material-3" color={edgeColor} roughness={0.9} />
        <meshStandardMaterial attach="material-4" map={spineMap} roughness={0.7} metalness={0.02} />
        <meshStandardMaterial attach="material-5" color={edgeColor} roughness={0.9} />
      </mesh>
    </group>
  );
}

// Critically-damped spring: integrate p toward target with no overshoot.
function spring(s: { p: number; v: number }, target: number, dt: number, omega: number) {
  const a = -2 * omega * s.v + omega * omega * (target - s.p);
  s.v += a * dt;
  s.p += s.v * dt;
  if (Math.abs(target - s.p) < 0.0006 && Math.abs(s.v) < 0.0006) {
    s.p = target;
    s.v = 0;
  }
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function shadeHex(hex: string, amt: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + 255 * amt)));
  const hh = (v: number) => v.toString(16).padStart(2, "0");
  return `#${hh(f(r))}${hh(f(g))}${hh(f(b))}`;
}
