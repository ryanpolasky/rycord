"use client";

// Lo-poly turntable for the top (or inside) of the shelf. The platter
// spins ONLY when the now-playing status says Ryan is currently listening
// to something; when idle (nothing playing or no data yet) the platter
// sits still so the room has a believable "not in use" look.
//
// Hovering anywhere on the plinth/platter/tonearm raises a DOM tooltip via
// the shared hoverStore: either "ryan is listening to <title> — <artist>"
// or "ryan last listened to <title> — <artist>", depending on isPlaying.
//
// Built to fit roughly inside one Kallax cell (28cm × 33cm × 9cm so it has
// breathing room inside the 33×36×33 cell when stacked, and also looks at
// home when sitting on top of a single-row unit).

import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { setHoveredNote, type HoverNote } from "@/lib/hoverStore";
import type { NowPlaying } from "@/app/api/nowplaying/route";
import { artworkProxyUrl } from "@/lib/nowPlaying";

// Tonearm pose tuning (inner <group> that carries the arm shaft + headshell).
// Y rotates around the pivot (swing over the record); Z tilts the arm up/down
// (the needle lift).
//
// Sign conventions (learned the hard way — the previous values were both
// inverted AND in the wrong half-plane, which dropped the needle INTO the
// plinth):
//   - Y rotation: arm points along −X at Y=0. Positive Y sweeps the tip
//     CCW viewed from above, i.e. from "back-left" (Y=0) through "front"
//     (Y=π/2) toward "right" (Y=π). The pivot sits at the BACK-RIGHT of
//     the plinth, so values in roughly [0.8, 1.6] put the tip over the
//     plinth top (over the platter or the cradle); outside that range
//     the arm either misses the record entirely or swings behind the
//     plinth.
//   - Z rotation: POSITIVE Z tilts the tip DOWN (because the arm starts
//     with a small +Y offset and Z rotation is applied around world Z
//     in the XZ plane). So "lifted" needs NEGATIVE Z, "touching the
//     record" needs a small positive Z. Previously these were swapped.
const TONEARM_REST_Y = 1.50;       // arm swung to front-right, tip over the cradle area (off platter)
const TONEARM_CLEAR_Y = 1.74;      // farther out of the way while the record lifts/flips
const TONEARM_OUTER_Y = 1.30;      // needle at outer groove of vinyl
const TONEARM_INNER_Y = 0.85;      // needle just outside label (song ending)
const TONEARM_LIFTED_Z = -0.12;    // arm tilted UP (off record)
const TONEARM_CLEAR_Z = -0.20;     // extra lift during record swap
const TONEARM_DOWN_Z = 0.001;      // arm tilted DOWN (needle on record)

const PLINTH_W = 0.28;   // width along X (a hair under 1 cell)
const PLINTH_D = 0.30;   // depth along Z
const PLINTH_H = 0.05;   // height of the wooden plinth
const PLATTER_R = 0.115; // platter radius (12" vinyl is 30cm dia → 0.15 r, but visual sweet-spot is a hair smaller)
const PLATTER_H = 0.010; // platter thickness
const VINYL_R = 0.118;   // record sitting on platter, slightly wider so it overhangs
const VINYL_H = 0.0015;  // record thickness
const LABEL_R = 0.035;   // center label
const RECORD_REST_Y = PLATTER_H + 0.002 + VINYL_H / 2;
const RECORD_LIFT_Y = 0.148;
// Arm-clear phase is long enough to let the sequenced tonearm motion
// (lift, THEN swing) fully settle into the CLEAR pose before the record
// starts rising off the platter. Previously tuned for the old simultaneous
// animation, which finished ~220ms earlier; the lift used to begin before
// the sweep had landed, causing a visible overlap.
const CHANGE_ARM_MS = 900;
const CHANGE_LIFT_MS = 320;
const CHANGE_FLIP_MS = 760;
const CHANGE_LOWER_MS = 340;
const CHANGE_SWAP_MS = CHANGE_ARM_MS + CHANGE_LIFT_MS + CHANGE_FLIP_MS / 2;
const CHANGE_TOTAL_MS = CHANGE_ARM_MS + CHANGE_LIFT_MS + CHANGE_FLIP_MS + CHANGE_LOWER_MS;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeInOut = (v: number) => v * v * (3 - 2 * v);

function prepareLabelTexture(tex: THREE.Texture): THREE.Texture {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function loadLabelTexture(url: string, attempt = 0): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(
      url,
      (tex) => resolve(prepareLabelTexture(tex)),
      undefined,
      () => {
        if (attempt >= 1) {
          reject(new Error("label texture failed to load"));
          return;
        }
        setTimeout(() => {
          loadLabelTexture(url, attempt + 1).then(resolve, reject);
        }, 350);
      },
    );
  });
}

type Props = {
  position?: [number, number, number];
  rotation?: [number, number, number];
  accent?: string; // label color (kept as a soft hint of the room accent)
  /** Now-playing payload from useNowPlaying / /api/nowplaying. When absent
   *  (or data isn't loaded yet) the turntable stays idle and the hover
   *  tooltip shows no song. */
  nowPlaying?: NowPlaying | null;
  /** True while the camera is dollied in on the player. Used only to flip
   *  the cursor hint (grabbed vs. pointing hand) on hover — the camera
   *  itself lives in IdleCamera and doesn't need the turntable to know. */
  focused?: boolean;
  /** Fires when the user clicks anywhere on the turntable. Scene wires
   *  this to a toggle of the camera focus state. */
  onClick?: () => void;
};

export default function Turntable({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  accent = "#a66a52",
  nowPlaying = null,
  focused = false,
  onClick,
}: Props) {
  const platter = useRef<THREE.Group>(null);
  const recordSwap = useRef<THREE.Group>(null);
  const tonearm = useRef<THREE.Group>(null);
  // Spin target, read inside useFrame. Stored in a ref so changes to
  // nowPlaying don't force the whole Turntable subtree to re-render.
  const targetRpm = useRef(0);
  const currentRpm = useRef(0);
  const changingRef = useRef(false);
  const changeAnimRef = useRef({ active: false, start: 0, fromRot: 0, toRot: 0 });
  const changeTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const prevTrackKeyRef = useRef<string | null | undefined>(undefined);
  // Whether the previous nowPlaying state was actively playing. Needed
  // because the in-scene arm has TWO valid "out of the way" poses during a
  // swap: from-rest (arm stays parked at the cradle) vs mid-song (arm
  // lifts and swings to the CLEAR pose so the flipping record has room).
  // Without tracking this we'd always target CLEAR, which yanks the arm
  // visibly upward + outward when transitioning from the idle/parked
  // position — exactly the unwanted "arm goes back up" wiggle the user
  // would otherwise see on the very first song after page load.
  const prevIsPlayingRef = useRef<boolean | undefined>(undefined);
  const fromRestRef = useRef(false);
  const recordRestRotRef = useRef(0);
  const changeGenerationRef = useRef(0);
  const pendingSwapTextureRef = useRef<THREE.Texture | null>(null);

  // 33⅓ RPM → 33.33 / 60 = 0.555 rev/sec → ~3.49 rad/sec. We dial it down
  // a touch (0.7×) since most observers will be casually glancing at it;
  // a too-fast platter reads as anxious. The platter only turns while
  // something is actually playing.
  const PLAYING_RPM = 3.49 * 0.7;

  useEffect(() => {
    targetRpm.current = nowPlaying?.isPlaying ? PLAYING_RPM : 0;
  }, [nowPlaying?.isPlaying, PLAYING_RPM]);

  // ----- Album art texture for the record label -----
  // We pipe the upstream artwork URL through /api/artwork so the image is
  // same-origin and therefore usable as a GL texture. When no artwork is
  // available (or the load fails) we fall through to the accent-colored
  // label, so the turntable still looks right.
  const incomingArtUrl = artworkProxyUrl(nowPlaying?.artworkUrl ?? null);
  const trackKey = nowPlaying
    ? `${nowPlaying.title}\u0000${nowPlaying.artist}\u0000${nowPlaying.album ?? ""}`
    : null;
  const [displayedArtUrl, setDisplayedArtUrl] = useState<string | null>(incomingArtUrl);
  const [labelTexture, setLabelTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    const previous = prevTrackKeyRef.current;
    const previousIsPlaying = prevIsPlayingRef.current ?? false;
    const isCurrentlyPlaying = Boolean(nowPlaying?.isPlaying);
    if (previous === undefined) {
      prevTrackKeyRef.current = trackKey;
      prevIsPlayingRef.current = isCurrentlyPlaying;
      setDisplayedArtUrl(incomingArtUrl);
      return;
    }

    if (previous === trackKey) {
      prevIsPlayingRef.current = isCurrentlyPlaying;
      if (!nowPlaying?.isPlaying) {
        changeGenerationRef.current += 1;
        pendingSwapTextureRef.current?.dispose();
        pendingSwapTextureRef.current = null;
        changeTimersRef.current.forEach(clearTimeout);
        changeTimersRef.current = [];
        changingRef.current = false;
        changeAnimRef.current.active = false;
      }
      if (!changingRef.current) setDisplayedArtUrl(incomingArtUrl);
      return;
    }

    prevTrackKeyRef.current = trackKey;
    prevIsPlayingRef.current = isCurrentlyPlaying;
    const generation = ++changeGenerationRef.current;
    pendingSwapTextureRef.current?.dispose();
    pendingSwapTextureRef.current = null;
    changeTimersRef.current.forEach(clearTimeout);
    changeTimersRef.current = [];

    if (previous === null || trackKey === null || !nowPlaying?.isPlaying) {
      changingRef.current = false;
      changeAnimRef.current.active = false;
      setDisplayedArtUrl(incomingArtUrl);
      return;
    }

    // Set the changing flag IMMEDIATELY so useFrame's groove-walking branch
    // can't briefly drive the arm toward TONEARM_DOWN_Z during the
    // texture-preload window below. Without this, trackStartRef gets set
    // synchronously by the OTHER effect when isPlaying flips true, while
    // changingRef stays false until the .then() callback fires — and during
    // that gap the arm visibly dips down before snapping back up to CLEAR.
    //
    // Also capture whether we're coming from idle. From rest the arm is
    // already parked at the cradle (REST/LIFTED), so moving to CLEAR is
    // unnecessary motion the user reads as a wiggle — keep it at REST
    // through the flip and let it land directly on the groove after.
    changingRef.current = true;
    fromRestRef.current = !previousIsPlaying;

    const startChange = (preloadedTex: THREE.Texture | null) => {
      if (generation !== changeGenerationRef.current) {
        preloadedTex?.dispose();
        return;
      }
      pendingSwapTextureRef.current = preloadedTex;
      changingRef.current = true;
      const fromRot = recordRestRotRef.current;
      const toRot = fromRot + Math.PI;
      changeAnimRef.current = { active: true, start: performance.now(), fromRot, toRot };
      changeTimersRef.current.push(
        setTimeout(() => {
          if (generation !== changeGenerationRef.current) {
            if (pendingSwapTextureRef.current === preloadedTex) {
              pendingSwapTextureRef.current = null;
              preloadedTex?.dispose();
            }
            return;
          }
          if (preloadedTex) {
            pendingSwapTextureRef.current = null;
            setLabelTexture((prev) => {
              prev?.dispose();
              return preloadedTex;
            });
          }
          setDisplayedArtUrl(incomingArtUrl);
        }, CHANGE_SWAP_MS),
        setTimeout(() => {
          if (generation !== changeGenerationRef.current) return;
          changingRef.current = false;
          changeAnimRef.current.active = false;
          recordRestRotRef.current = toRot % (Math.PI * 2);
          if (recordSwap.current) {
            recordSwap.current.position.y = RECORD_REST_Y;
            recordSwap.current.rotation.x = recordRestRotRef.current;
          }
          if (nowPlaying?.isPlaying && durationRef.current > 0) {
            trackStartRef.current = Date.now();
          }
        }, CHANGE_TOTAL_MS),
      );
    };

    if (!incomingArtUrl) {
      startChange(null);
      return;
    }

    loadLabelTexture(incomingArtUrl)
      .then((tex) => startChange(tex))
      .catch(() => startChange(null));
  }, [trackKey, incomingArtUrl, nowPlaying?.isPlaying]);

  useEffect(() => {
    return () => {
      changeGenerationRef.current += 1;
      pendingSwapTextureRef.current?.dispose();
      pendingSwapTextureRef.current = null;
      changeTimersRef.current.forEach(clearTimeout);
      changeTimersRef.current = [];
    };
  }, []);

  const proxiedArtUrl = displayedArtUrl;
  useEffect(() => {
    if (!proxiedArtUrl) {
      setLabelTexture((prev) => {
        prev?.dispose();
        return null;
      });
      return;
    }
    let cancelled = false;
    loadLabelTexture(proxiedArtUrl)
      .then((tex) => {
        if (cancelled) {
          tex.dispose();
          return;
        }
        setLabelTexture((prev) => {
          prev?.dispose();
          return tex;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [proxiedArtUrl]);
  // Refs to the two label materials so we can mark them needsUpdate whenever
  // the texture flips between null and a real map. Three.js requires a shader
  // recompile when USE_MAP toggles on/off (going from undefined → texture or
  // vice versa); R3F sets `material.map` but never flips `needsUpdate`, so
  // without this the album art loads into the texture slot but the shader
  // keeps rendering without it and the label looks blank.
  const labelMatTopRef = useRef<THREE.MeshBasicMaterial>(null);
  const labelMatBotRef = useRef<THREE.MeshBasicMaterial>(null);
  useEffect(() => {
    if (labelMatTopRef.current) labelMatTopRef.current.needsUpdate = true;
    if (labelMatBotRef.current) labelMatBotRef.current.needsUpdate = true;
  }, [labelTexture]);
  // Dispose any remaining texture on unmount so we don't leak GPU memory.
  useEffect(() => {
    return () => {
      setLabelTexture((prev) => {
        prev?.dispose();
        return null;
      });
    };
  }, []);

  // ----- Tonearm progress driver -----
  // Elapsed since the track started, per upstream's `updatedAt`. Captured
  // from the payload on render and read inside useFrame so the tonearm
  // walks in real time without forcing a re-render every frame.
  const trackStartRef = useRef<number | null>(null);
  const durationRef = useRef<number>(0);
  useEffect(() => {
    const isPlaying = Boolean(nowPlaying?.isPlaying);
    const duration = nowPlaying?.durationMs ?? 0;
    const updatedAt = nowPlaying?.updatedAt ?? 0;
    if (isPlaying && duration > 0) {
      // Prefer the upstream's updatedAt (true scrobble start), fall back
      // to "now" if it isn't provided so the needle still walks inward.
      trackStartRef.current = updatedAt > 0 ? updatedAt : Date.now();
      durationRef.current = duration;
    } else {
      trackStartRef.current = null;
      durationRef.current = 0;
    }
  }, [
    nowPlaying?.isPlaying,
    nowPlaying?.durationMs,
    nowPlaying?.updatedAt,
    nowPlaying?.title,
  ]);

  // Smoothed tonearm pose. `current*` is what we apply to the group each
  // frame; the frame loop eases it toward the target so play/pause lifts
  // and the inward walk look mechanical instead of snappy.
  const currentY = useRef(TONEARM_REST_Y);
  const currentZ = useRef(TONEARM_LIFTED_Z);

  // Frame loop: eases platter RPM, tonearm Y swing, and tonearm Z lift.
  useFrame((_state, dt) => {
    // Platter
    if (platter.current) {
      const t = Math.min(1, dt * 2.5);
      if (changingRef.current) {
        currentRpm.current = 0;
      } else {
        currentRpm.current += (targetRpm.current - currentRpm.current) * t;
      }
      platter.current.rotation.y += dt * currentRpm.current;
    }
    if (recordSwap.current) {
      const anim = changeAnimRef.current;
      if (anim.active) {
        const elapsed = performance.now() - anim.start;
        const liftT = easeInOut(clamp01((elapsed - CHANGE_ARM_MS) / CHANGE_LIFT_MS));
        const flipT = easeInOut(clamp01((elapsed - CHANGE_ARM_MS - CHANGE_LIFT_MS) / CHANGE_FLIP_MS));
        const lowerT = easeInOut(clamp01((elapsed - CHANGE_ARM_MS - CHANGE_LIFT_MS - CHANGE_FLIP_MS) / CHANGE_LOWER_MS));
        recordSwap.current.position.y = RECORD_REST_Y + (RECORD_LIFT_Y - RECORD_REST_Y) * liftT * (1 - lowerT);
        recordSwap.current.rotation.x = anim.fromRot + (anim.toRot - anim.fromRot) * flipT;
      } else {
        recordSwap.current.position.y += (RECORD_REST_Y - recordSwap.current.position.y) * Math.min(1, dt * 9);
        recordSwap.current.rotation.x += (recordRestRotRef.current - recordSwap.current.rotation.x) * Math.min(1, dt * 9);
      }
    }

    // Tonearm target: resting/lifted when not playing, or sweeping inward
    // based on elapsed/duration while the song plays. During a record swap
    // the target depends on where we're coming from:
    //   - mid-song change → CLEAR pose (arm pulls back farther/lifts higher
    //     so the flipping record has clearance)
    //   - rest → song    → keep the arm parked at REST. It's already out of
    //     the way at the cradle, and any extra motion reads as a wiggle.
    const swapY = fromRestRef.current ? TONEARM_REST_Y : TONEARM_CLEAR_Y;
    const swapZ = fromRestRef.current ? TONEARM_LIFTED_Z : TONEARM_CLEAR_Z;
    let targetY = changingRef.current ? swapY : TONEARM_REST_Y;
    let targetZ = changingRef.current ? swapZ : TONEARM_LIFTED_Z;
    if (!changingRef.current && trackStartRef.current !== null && durationRef.current > 0) {
      const elapsed = Date.now() - trackStartRef.current;
      // Clamp progress to [0, 1]; if the upstream hasn't refreshed yet and
      // we overshoot duration, the arm stays parked at the inner groove.
      const progress = Math.min(
        1,
        Math.max(0, elapsed / durationRef.current),
      );
      targetY = TONEARM_OUTER_Y + (TONEARM_INNER_Y - TONEARM_OUTER_Y) * progress;
      targetZ = TONEARM_DOWN_Z;
    }
    if (tonearm.current) {
      // Sequence the two axes so the arm reads as "swing over the groove,
      // THEN drop" when going onto the record, and "lift off, THEN swing
      // back" when leaving it — instead of a diagonal blend of both at
      // once. Positive Z = needle DOWN on the record, negative Z = LIFTED.
      //
      // We hold whichever axis would normally start the diagonal until
      // the leading axis is within a small radians threshold of its
      // target. Mid-play inward groove walking has currentZ already at
      // DOWN so neither branch triggers and Y eases freely.
      const SEQUENCE_EPS = 0.04;
      const zIsLifting = targetZ < currentZ.current - SEQUENCE_EPS;
      const zIsDropping = targetZ > currentZ.current + SEQUENCE_EPS;
      const yDist = Math.abs(targetY - currentY.current);
      const zDist = Math.abs(targetZ - currentZ.current);
      let stagedY = targetY;
      let stagedZ = targetZ;
      if (zIsLifting && zDist > SEQUENCE_EPS) {
        // Leaving the record — hold the swing until the needle is up.
        stagedY = currentY.current;
      } else if (zIsDropping && yDist > SEQUENCE_EPS) {
        // Setting down — hold the needle up until the arm has swung
        // over the target groove, so the motion reads as a clean
        // horizontal sweep followed by a vertical drop.
        stagedZ = currentZ.current;
      }
      // Speeds bumped slightly vs the old simultaneous version so the
      // sequenced motion doesn't feel sluggish (each axis now happens in
      // turn instead of overlapping).
      const yT = Math.min(1, dt * (changingRef.current ? 5.5 : 1.8));
      const zT = Math.min(1, dt * (changingRef.current ? 6.0 : 2.8));
      currentY.current += (stagedY - currentY.current) * yT;
      currentZ.current += (stagedZ - currentZ.current) * zT;
      tonearm.current.rotation.y = currentY.current;
      tonearm.current.rotation.z = currentZ.current;
    }
  });

  // Compose the hover note once per nowPlaying change so the pointer-event
  // handlers can push the same object without allocating per event.
  const note: HoverNote | null = (() => {
    if (!nowPlaying) return null;
    const title = nowPlaying.title.trim();
    const artist = nowPlaying.artist.trim();
    const hasSong = title !== "" || artist !== "";
    const eyebrow = nowPlaying.isPlaying
      ? "ryan is listening to"
      : "ryan last listened to";
    if (!hasSong) {
      // Ryan isn't listening and we don't even have history to show; keep
      // the hover useful with a graceful fallback.
      return {
        eyebrow: "turntable",
        main: "nothing playing right now",
      };
    }
    return {
      eyebrow,
      main: title || "(untitled)",
      ...(artist !== "" ? { sub: artist } : {}),
    };
  })();

  const onPointerOver = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    setHoveredNote(note);
    // "zoom-out" glyph while focused (since clicking again dismisses the
    // closeup), standard pointer otherwise.
    document.body.style.cursor = focused ? "zoom-out" : "zoom-in";
  };
  const onPointerOut = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    setHoveredNote(null);
    document.body.style.cursor = "auto";
  };
  // Click handler: stop propagation so the click doesn't fire the Canvas's
  // onPointerMissed (which would immediately clear the focus we just set).
  // Flip the cursor glyph in the same tick so it reflects the new
  // "click again to dismiss" affordance without waiting for a pointer re-
  // enter to refresh it.
  const onClickGroup = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    document.body.style.cursor = focused ? "zoom-in" : "zoom-out";
    onClick?.();
  };

  return (
    <group
      position={position}
      rotation={rotation}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
      onClick={onClickGroup}
    >
      {/* PLINTH — wooden base, matches shelf material but a hair darker for
          contrast against the shelf top board */}
      <mesh position={[0, PLINTH_H / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[PLINTH_W, PLINTH_H, PLINTH_D]} />
        <meshStandardMaterial color="#3a2618" roughness={0.55} metalness={0.05} />
      </mesh>

      {/* a thin black bezel/face plate inset on top of the plinth, so the
          plinth looks like it has "controls" without us having to model
          each knob */}
      <mesh position={[0, PLINTH_H + 0.0005, 0]} receiveShadow>
        <boxGeometry args={[PLINTH_W * 0.94, 0.001, PLINTH_D * 0.94]} />
        <meshStandardMaterial color="#181410" roughness={0.85} metalness={0.1} />
      </mesh>

      {/* Speed selector / power LED — tiny green pinpoint glow front-left
          of the plinth, gives a sign of life */}
      <mesh position={[-PLINTH_W * 0.36, PLINTH_H + 0.0015, PLINTH_D * 0.36]}>
        <sphereGeometry args={[0.003, 8, 8]} />
        <meshBasicMaterial color="#4dffa6" />
      </mesh>

      {/* PLATTER — sits forward of center on the plinth (real turntables
          have the platter offset slightly to the right of center, with the
          tonearm on the right; we offset slightly to the LEFT so the right
          side has room for the tonearm) */}
      <group position={[-PLINTH_W * 0.08, PLINTH_H + 0.001, 0]}>
        {/* spinning components grouped so we can rotate them */}
        <group ref={platter}>
          {/* aluminum platter — slightly inset relative to the vinyl */}
          <mesh position={[0, PLATTER_H / 2, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[PLATTER_R, PLATTER_R, PLATTER_H, 48]} />
            <meshStandardMaterial color="#1a1612" roughness={0.45} metalness={0.65} />
          </mesh>

          {/* rubber slipmat — subtle grey-black layer on top of platter */}
          <mesh position={[0, PLATTER_H + 0.0005, 0]} receiveShadow>
            <cylinderGeometry args={[PLATTER_R * 0.98, PLATTER_R * 0.98, 0.001, 48]} />
            <meshStandardMaterial color="#0a0908" roughness={0.95} metalness={0.0} />
          </mesh>

          <group
            ref={recordSwap}
            position={[0, RECORD_REST_Y, 0]}
          >
            {/* vinyl record — sits on top of the slipmat */}
            <mesh castShadow receiveShadow>
              <cylinderGeometry args={[VINYL_R, VINYL_R, VINYL_H, 64]} />
              <meshStandardMaterial color="#0c0a08" roughness={0.4} metalness={0.05} />
            </mesh>

            {/* record label — small disc in the center. Textured with the
                current track's album art when available (loaded through our
                CORS-safe /api/artwork proxy); falls back to a flat accent
                color when nothing is playing or the art hasn't loaded yet.
                `color` is forced to white while a texture is bound so the
                art renders without an accent tint, and back to `accent`
                when there's no map. */}
            <mesh position={[0, VINYL_H / 2 + 0.0001, 0]}>
              <cylinderGeometry args={[LABEL_R, LABEL_R, 0.0003, 32]} />
              <meshBasicMaterial
                ref={labelMatTopRef}
                color={labelTexture ? "#ffffff" : accent}
                map={labelTexture ?? undefined}
                side={THREE.DoubleSide}
                toneMapped={false}
              />
            </mesh>
            <mesh position={[0, -VINYL_H / 2 - 0.0001, 0]}>
              <cylinderGeometry args={[LABEL_R, LABEL_R, 0.0003, 32]} />
              <meshBasicMaterial
                ref={labelMatBotRef}
                color={labelTexture ? "#ffffff" : accent}
                map={labelTexture ?? undefined}
                side={THREE.DoubleSide}
                toneMapped={false}
              />
            </mesh>
          </group>

          {/* spindle pin */}
          <mesh position={[0, RECORD_REST_Y + VINYL_H / 2 + 0.004, 0]}>
            <cylinderGeometry args={[0.0015, 0.0015, 0.008, 8]} />
            <meshStandardMaterial color="#cfcfcf" roughness={0.4} metalness={0.9} />
          </mesh>
        </group>
      </group>

      {/* TONEARM — mounted on the back-right of the plinth. Pivot post +
          straight arm angled at ~-15° down toward the record edge, resting
          (not playing). */}
      <group position={[PLINTH_W * 0.32, PLINTH_H + 0.001, -PLINTH_D * 0.30]}>
        {/* pivot post */}
        <mesh position={[0, 0.012, 0]} castShadow>
          <cylinderGeometry args={[0.008, 0.010, 0.024, 16]} />
          <meshStandardMaterial color="#cccccc" roughness={0.35} metalness={0.85} />
        </mesh>
        {/* arm — a long thin tube that sweeps from pivot toward the platter
            edge. Ref-driven rotation: the frame loop eases Y (swing over
            record) and Z (needle lift) toward a target derived from
            isPlaying + elapsed/duration. Initial rotation matches the
            "rest / lifted" pose so the arm isn't touching the record
            before the first frame runs. */}
        <group
          ref={tonearm}
          rotation={[0, TONEARM_REST_Y, TONEARM_LIFTED_Z]}
        >
          <mesh position={[-0.083, 0.024, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.0017, 0.0017, 0.166, 12]} />
            <meshStandardMaterial color="#cfcfcf" roughness={0.30} metalness={0.85} />
          </mesh>
          <group position={[-0.162, 0.020, 0]}>
            {/* headshell — small block at the far end of the arm */}
            <mesh position={[-0.010, 0, 0]} castShadow>
              <boxGeometry args={[0.030, 0.009, 0.018]} />
              <meshStandardMaterial color="#0e0c0a" roughness={0.62} metalness={0.25} />
            </mesh>
            {/* cartridge stylus tip */}
            <mesh position={[-0.024, -0.007, 0]} rotation={[0, 0, Math.PI]} castShadow>
              <coneGeometry args={[0.0022, 0.012, 8]} />
              <meshStandardMaterial color="#11100f" roughness={0.45} metalness={0.3} />
            </mesh>
          </group>
        </group>
        {/* tonearm rest — small post at the side of the platter where the
            arm sits when not playing. Positioned directly under the arm
            tip at REST (Y=1.50) so the arm visually parks on top of it
            instead of floating over empty plinth. */}
        <mesh position={[-0.012, 0.008, 0.180]} castShadow>
          <cylinderGeometry args={[0.003, 0.003, 0.016, 12]} />
          <meshStandardMaterial color="#222" roughness={0.6} metalness={0.5} />
        </mesh>
      </group>
    </group>
  );
}
