"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { generateCoverCanvas, generateSpineCanvas, generateBackCanvas, type BackTrack } from "@/lib/generateCover";
import type { DemoRecord } from "@/lib/covers";
import { setHoveredRecord } from "@/lib/hoverStore";
import type { PerformanceTier } from "@/lib/performance";
import { loadReleaseDetails } from "@/lib/releaseDetails";

// x = spine thickness, y = height, z = depth. spine faces +z (camera) at rest.
const SX = 0.006;
const SY = 0.308;
const SZ = 0.30;

// puts the spine right at the cell's front opening
const SHELF_REST_Z = -0.151;

// negative x centres the record in the canvas left of the info panel
const FLOAT_TARGET = { x: -0.10, y: 0.17, z: 0.55 };

// tips the top edge down and toward the camera, like peeking through a crate
const HOVER_TILT_X = 0.14;
const HOVER_NUDGE_Z = 0.020;

// clean look at the art before any spin starts
const FRONT_HOLD_S = 0.8;

const ROCK_AMP = 0.16;
const ROCK_FREQ = 0.32;

// ~80px of drag flips cover to back
const DRAG_RAD_PER_PX = 0.012;

// past this a pointerdown counts as a drag, so the dismiss click is suppressed
const DRAG_PX_THRESHOLD = 3;

const FRICTION_HZ = 0.82;

// below this, drop momentum so it can't permanently offset the ambient rock
const MOMENTUM_CUTOFF = 0.05;

const PULL_OPEN_OMEGA = 5.5;
const PULL_CLOSE_OMEGA = 9.5;
const CLOSE_SPIN_SETTLE_RATE = 12;
const CLOSE_ROT_SETTLED_EPS = 0.09;
const CLOSE_HANDOFF_P = 0.18;

// maps local +x (cover front) to world +z
const FRONT_FACE_Y = -Math.PI / 2;

const TOP_EDGE_SHADE = 0.08;

// shared across every record so we upload one geometry instead of N
const JACKET_GEOMETRY = (() => {
  const g = new THREE.BoxGeometry(SX, SY, SZ);
  const src = g.getIndex()!.array;
  const faceOrder = [0, 1, 4, 2, 3, 5];
  const index: number[] = [];
  for (const f of faceOrder) for (let i = 0; i < 6; i++) index.push(src[f * 6 + i]);
  g.setIndex(index);
  g.clearGroups();
  g.addGroup(0, 6, 0);
  g.addGroup(6, 6, 1);
  g.addGroup(12, 6, 2);
  g.addGroup(18, 18, 3);
  // near-black top edge so the led cove glow doesn't stripe the tops of the records
  const count = g.getAttribute("position").count;
  const colors = new Float32Array(count * 3).fill(1);
  for (let v = 8; v < 12; v++) colors.fill(TOP_EDGE_SHADE, v * 3, v * 3 + 3);
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
})();

type Props = {
  rec: DemoRecord;
  shelfX: number;
  // y of the cell center; 0 for a single-row shelf
  shelfY?: number;
  active: boolean;
  disabled?: boolean;
  quality?: PerformanceTier;
  onSelect: () => void;
  onRetracted?: () => void;
  flipSignal?: number;
};

export default function VinylRecord({ rec, shelfX, shelfY = 0, active, disabled = false, quality = "high", onSelect, onRetracted, flipSignal = 0 }: Props) {
  const group = useRef<THREE.Group>(null);
  const mesh = useRef<THREE.Mesh>(null);
  const [hover, setHover] = useState(false);

  // pull 0 = nested, 1 = floating. closing waits for the spin to unwind so the spine re-enters forward
  const pullState = useRef({ p: 0, v: 0 });
  const hoverState = useRef({ p: 0, v: 0 });
  const wasPulledOut = useRef(false);
  const needsRetractHandoff = useRef(false);
  // accumulated offset from the FRONT_FACE_Y baseline
  const spinAngle = useRef(0);
  // rad/s, only nonzero while dragging or decaying
  const spinVel = useRef(0);
  const spinRestCenter = useRef(0);
  const commandedSpinTarget = useRef<number | null>(null);
  const lastFlipSignal = useRef(flipSignal);
  const frontHoldStart = useRef<number | null>(null);
  const closing = useRef(false);
  const dragRef = useRef({
    active: false,
    moved: false,
    lastX: 0,
    lastT: 0,
  });
  const flipDirection = useRef(1);

  const edgeColor = useMemo(() => shadeHex(rec.palette.bg, -0.18), [rec.palette.bg]);
  const spineMap = useMemo(() => {
    if (typeof document === "undefined") return null;
    const spineW = quality === "low" ? 32 : 48;
    const spineH = quality === "low" ? 1200 : 2400;
    return canvasTexture(generateSpineCanvas(rec, spineW, spineH), quality);
  }, [rec, quality]);

  // the back is only visible once pulled out and flipped, so build it lazily
  const [everActive, setEverActive] = useState(active);
  useEffect(() => {
    if (active) setEverActive(true);
  }, [active]);

  const [coverFailed, setCoverFailed] = useState(false);
  const [realCoverMap, setRealCoverMap] = useState<THREE.Texture | null>(null);

  // cover faces hide between neighbours, so only draw a placeholder when it'll be seen
  const needsPlaceholder = !rec.coverUrl || coverFailed || (everActive && !realCoverMap);
  const proceduralCoverMap = useMemo(() => {
    if (!needsPlaceholder || typeof document === "undefined") return null;
    const faceSize = quality === "low" ? 512 : 1024;
    const coverSize = rec.coverUrl ? Math.min(faceSize, 512) : faceSize;
    return canvasTexture(generateCoverCanvas(rec, coverSize), quality);
  }, [needsPlaceholder, rec, quality]);

  const proceduralBackMap = useMemo(() => {
    if (!everActive || typeof document === "undefined") return null;
    const faceSize = quality === "low" ? 512 : 1024;
    return canvasTexture(generateBackCanvas(rec, faceSize), quality);
  }, [everActive, rec, quality]);

  useEffect(() => {
    setCoverFailed(false);
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
        tex.anisotropy = quality === "high" ? 8 : quality === "medium" ? 4 : 2;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
        setRealCoverMap(tex);
      },
      undefined,
      () => {
        if (!cancelled) setCoverFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rec.coverUrl, quality]);

  const coverMap = realCoverMap ?? proceduralCoverMap;

  // country only comes from the release endpoint, so the real back is built on activation
  const [realBackMap, setRealBackMap] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!active) return;
    if (typeof document === "undefined") return;
    let cancelled = false;
    loadReleaseDetails(rec.id).then((details) => {
      if (cancelled) return;
      if (details.tracks.length === 0 && !details.country && details.year <= 0) return;
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
      const canvas = generateBackCanvas(enriched, quality === "low" ? 512 : 1024, tracks.length > 0 ? tracks : undefined);
      setRealBackMap(canvasTexture(canvas, quality));
    });
    return () => {
      cancelled = true;
    };
  }, [active, rec, quality]);

  const backMap = realBackMap ?? proceduralBackMap;

  // maps that start null need a recompile, three only adds USE_MAP when one is present
  const backMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const coverMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const hasBackMap = backMap !== null;
  const hasCoverMap = coverMap !== null;
  useEffect(() => {
    if (backMatRef.current) backMatRef.current.needsUpdate = true;
  }, [hasBackMap]);
  useEffect(() => {
    if (coverMatRef.current) coverMatRef.current.needsUpdate = true;
  }, [hasCoverMap]);

  useEffect(() => () => proceduralCoverMap?.dispose(), [proceduralCoverMap]);
  useEffect(() => () => spineMap?.dispose(), [spineMap]);

  useEffect(() => () => proceduralBackMap?.dispose(), [proceduralBackMap]);
  useEffect(() => () => realCoverMap?.dispose(), [realCoverMap]);
  useEffect(() => () => realBackMap?.dispose(), [realBackMap]);

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
    if (active) {
      needsRetractHandoff.current = true;
      return;
    }
    spinRestCenter.current = 0;
    commandedSpinTarget.current = null;
  }, [active]);

  useFrame((state, rawDt) => {
    if (!group.current) return;
    const dt = Math.min(rawDt, 0.05);
    const t = state.clock.elapsedTime;

    // a shelved jacket is thinner than a shadow texel, so only cast once it's out
    if (mesh.current) mesh.current.castShadow = quality !== "low" && (active || pullState.current.p > 0.01);

    // fully settled and nested, so everything below would be a no-op
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
      commandedSpinTarget.current === null &&
      !needsRetractHandoff.current
    ) {
      return;
    }

    if (active) {
      closing.current = false;
    } else if (pullState.current.p > 0.05 && !closing.current) {
      closing.current = true;
    } else if (pullState.current.p < 0.02) {
      closing.current = false;
    }

    // hold the float position until the spin has wound down, then retract
    let pullTarget = active ? 1 : 0;
    if (closing.current) {
      const wrap = (a: number) => {
        let x = ((a + Math.PI) % (Math.PI * 2));
        if (x < 0) x += Math.PI * 2;
        return x - Math.PI;
      };
      const wrappedAngle = wrap(spinAngle.current);
      const rotSettled = Math.abs(wrappedAngle) < CLOSE_ROT_SETTLED_EPS && Math.abs(spinVel.current) < 0.08;
      if (!rotSettled) {
        pullTarget = pullState.current.p;
      }
    }

    spring(pullState.current, pullTarget, dt, active ? PULL_OPEN_OMEGA : PULL_CLOSE_OMEGA);
    spring(hoverState.current, hover && !active ? 1 : 0, dt, 12);

    const p = pullState.current.p;
    const h = hoverState.current.p;
    if (p > 0.12) wasPulledOut.current = true;
    if (!active && (wasPulledOut.current || needsRetractHandoff.current) && p < CLOSE_HANDOFF_P) {
      wasPulledOut.current = false;
      needsRetractHandoff.current = false;
      onRetracted?.();
    }

    // overlapping stages: extract from the cell, travel + turn to face camera, then settle at FLOAT_TARGET
    const eExtract = easeInOutCubic(clamp01(p / 0.45));
    const eTravel  = easeInOutCubic(clamp01((p - 0.20) / 0.65));
    const eFloat   = easeInOutCubic(clamp01((p - 0.55) / 0.45));

    const restX = shelfX;
    const restY = shelfY;
    const restZ = SHELF_REST_Z;

    const xFromShelf = restX + (FLOAT_TARGET.x - restX) * eTravel;
    const yFromShelf = restY + (FLOAT_TARGET.y - restY) * eFloat;
    const zFromShelf = restZ + (FLOAT_TARGET.z - restZ) * eExtract;

    const hoverZ = h * HOVER_NUDGE_Z * (1 - eExtract);
    const bob = eFloat * Math.sin(t * 0.9) * 0.008;

    group.current.position.set(xFromShelf, yFromShelf + bob, zFromShelf + hoverZ);

    const baseRotation = FRONT_FACE_Y * eTravel;

    // gated on p rather than the spring settling, whose decay tail is long enough that the record already looks stationary
    if (active && !closing.current && p > 0.85) {
      if (frontHoldStart.current === null) frontHoldStart.current = t;
    } else if (!active && p < 0.5) {
      frontHoldStart.current = null;
    }
    const holdElapsed = frontHoldStart.current !== null ? t - frontHoldStart.current : 0;
    const spinAllowed = holdElapsed > FRONT_HOLD_S && !closing.current;

    if (closing.current) {
      // wrap into (-π, π] then shrink toward 0
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
      // hold dead steady at FRONT_FACE_Y during the front-hold window
      spinAngle.current *= Math.exp(-3 * dt);
      spinVel.current = 0;
    } else if (dragRef.current.active) {
      // the pointermove handler owns spinAngle/spinVel while dragging
    } else if (Math.abs(spinVel.current) > MOMENTUM_CUTOFF) {
      spinVel.current *= Math.exp(-FRICTION_HZ * dt);
      spinAngle.current += spinVel.current * dt;
    } else {
      spinVel.current = 0;
      const target = spinRestCenter.current + ROCK_AMP * Math.sin(t * Math.PI * 2 * ROCK_FREQ);
      spinAngle.current += (target - spinAngle.current) * Math.min(1, 3.5 * dt);
    }

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
        // once floating, the InfoPanel already labels it
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
        // a flick-spin shouldn't also dismiss the record
        if (dragRef.current.moved) {
          dragRef.current.moved = false;
          return;
        }
        // swallow it so onPointerMissed can't dismiss, and so it can't raycast through to a record behind this one
        e.stopPropagation();
        // dismissing is empty-space or the InfoPanel escape only
        if (active) return;
        setHoveredRecord(null);
        onSelect();
      }}
      onPointerDown={(e) => {
        if (disabled) {
          e.stopPropagation();
          return;
        }
        // below this it's just the start of a click that toggles active
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

          // positive dx swings the cover's right edge toward the camera
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

          // r3f re-raycasts on click, so after a drag the synthetic click can land on a record behind this one
          if (wasMoved) {
            const suppressClick = (ev: Event) => {
              ev.stopImmediatePropagation();
              ev.preventDefault();
              window.removeEventListener("click", suppressClick, true);
            };
            window.addEventListener("click", suppressClick, true);
            // some browsers skip the click after a big move, so don't leave this armed
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
      <mesh ref={mesh} receiveShadow={quality !== "low"} geometry={JACKET_GEOMETRY}>
        <meshStandardMaterial ref={coverMatRef} attach="material-0" map={coverMap} color={coverMap ? "#ffffff" : edgeColor} roughness={0.55} metalness={0.04} />
        <meshStandardMaterial ref={backMatRef} attach="material-1" map={backMap} color={backMap ? "#ffffff" : edgeColor} roughness={0.55} metalness={0.04} />
        <meshStandardMaterial attach="material-2" map={spineMap} roughness={0.7} metalness={0.02} />
        <meshStandardMaterial attach="material-3" color={edgeColor} vertexColors roughness={0.9} />
      </mesh>
    </group>
  );
}

// critically damped, so no overshoot
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

function canvasTexture(canvas: HTMLCanvasElement, quality: PerformanceTier): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = quality === "high" ? 8 : quality === "medium" ? 4 : 2;
  tex.needsUpdate = true;
  return tex;
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
