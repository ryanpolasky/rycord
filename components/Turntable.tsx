"use client";

import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { setHoveredNote, type HoverNote } from "@/lib/hoverStore";
import type { NowPlaying } from "@/app/api/nowplaying/route";
import { artworkProxyUrl } from "@/lib/nowPlaying";

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
// long enough for the arm to lift and swing clear before the record rises
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
  nowPlaying?: NowPlaying | null;
  focused?: boolean;
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
  const group = useRef<THREE.Group>(null);
  const platter = useRef<THREE.Group>(null);
  const recordSwap = useRef<THREE.Group>(null);
  const tonearm = useRef<THREE.Group>(null);
  const pointerInside = useRef(false);
  const targetRpm = useRef(0);
  const currentRpm = useRef(0);
  const changingRef = useRef(false);
  const changeAnimRef = useRef({ active: false, start: 0, fromRot: 0, toRot: 0 });
  const changeTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const prevTrackKeyRef = useRef<string | null | undefined>(undefined);
  const prevIsPlayingRef = useRef<boolean | undefined>(undefined);
  const fromRestRef = useRef(false);
  const recordRestRotRef = useRef(0);
  const changeGenerationRef = useRef(0);
  const pendingSwapTextureRef = useRef<THREE.Texture | null>(null);

  // 33 1/3 rpm
  const PLAYING_RPM = 3.49 * 0.7;

  useEffect(() => {
    targetRpm.current = nowPlaying?.isPlaying ? PLAYING_RPM : 0;
  }, [nowPlaying?.isPlaying, PLAYING_RPM]);

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

    // set first so the groove walker can't drop the arm while the art preloads
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
  // label maps toggle between null and a texture, which needs a shader recompile
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

  const trackStartRef = useRef<number | null>(null);
  const durationRef = useRef<number>(0);
  useEffect(() => {
    const isPlaying = Boolean(nowPlaying?.isPlaying);
    const duration = nowPlaying?.durationMs ?? 0;
    const updatedAt = nowPlaying?.updatedAt ?? 0;
    if (isPlaying && duration > 0) {
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

    const swapY = fromRestRef.current ? TONEARM_REST_Y : TONEARM_CLEAR_Y;
    const swapZ = fromRestRef.current ? TONEARM_LIFTED_Z : TONEARM_CLEAR_Z;
    let targetY = changingRef.current ? swapY : TONEARM_REST_Y;
    let targetZ = changingRef.current ? swapZ : TONEARM_LIFTED_Z;
    if (!changingRef.current && trackStartRef.current !== null && durationRef.current > 0) {
      const elapsed = Date.now() - trackStartRef.current;
      const progress = Math.min(
        1,
        Math.max(0, elapsed / durationRef.current),
      );
      targetY = TONEARM_OUTER_Y + (TONEARM_INNER_Y - TONEARM_OUTER_Y) * progress;
      targetZ = TONEARM_DOWN_Z;
    }
    if (tonearm.current) {
      // swing then drop going on, lift then swing coming off, never diagonal
      const SEQUENCE_EPS = 0.04;
      const zIsLifting = targetZ < currentZ.current - SEQUENCE_EPS;
      const zIsDropping = targetZ > currentZ.current + SEQUENCE_EPS;
      const yDist = Math.abs(targetY - currentY.current);
      const zDist = Math.abs(targetZ - currentZ.current);
      let stagedY = targetY;
      let stagedZ = targetZ;
      if (zIsLifting && zDist > SEQUENCE_EPS) {
        // Leaving the record, hold the swing until the needle is up.
        stagedY = currentY.current;
      } else if (zIsDropping && yDist > SEQUENCE_EPS) {
        stagedZ = currentZ.current;
      }
      const yT = Math.min(1, dt * (changingRef.current ? 5.5 : 1.8));
      const zT = Math.min(1, dt * (changingRef.current ? 6.0 : 2.8));
      currentY.current += (stagedY - currentY.current) * yT;
      currentZ.current += (stagedZ - currentZ.current) * zT;
      tonearm.current.rotation.y = currentY.current;
      tonearm.current.rotation.z = currentZ.current;
    }
  });

  const note: HoverNote | null = (() => {
    if (!nowPlaying) return null;
    const title = nowPlaying.title.trim();
    const artist = nowPlaying.artist.trim();
    const hasSong = title !== "" || artist !== "";
    const eyebrow = nowPlaying.isPlaying
      ? "ryan is listening to"
      : "ryan last listened to";
    if (!hasSong) {
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

  useEffect(() => {
    if (!pointerInside.current) return;
    setHoveredNote(note);
  }, [note]);

  const onPointerOver = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    pointerInside.current = true;
    setHoveredNote(note);
    document.body.style.cursor = focused ? "zoom-out" : "zoom-in";
  };
  const onPointerOut = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    pointerInside.current = false;
    setHoveredNote(null);
    document.body.style.cursor = "auto";
  };
  // or onPointerMissed clears the focus we just set
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
      <mesh position={[0, PLINTH_H / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[PLINTH_W, PLINTH_H, PLINTH_D]} />
        <meshStandardMaterial color="#3a2618" roughness={0.55} metalness={0.05} />
      </mesh>

      <mesh position={[0, PLINTH_H + 0.0005, 0]} receiveShadow>
        <boxGeometry args={[PLINTH_W * 0.94, 0.001, PLINTH_D * 0.94]} />
        <meshStandardMaterial color="#181410" roughness={0.85} metalness={0.1} />
      </mesh>

      <mesh position={[-PLINTH_W * 0.36, PLINTH_H + 0.0015, PLINTH_D * 0.36]}>
        <sphereGeometry args={[0.003, 8, 8]} />
        <meshBasicMaterial color="#4dffa6" />
      </mesh>

      {/* offset left so the tonearm has room on the right */}
      <group position={[-PLINTH_W * 0.08, PLINTH_H + 0.001, 0]}>
        {/* spinning components grouped so we can rotate them */}
        <group ref={platter}>
          {/* aluminum platter, slightly inset relative to the vinyl */}
          <mesh position={[0, PLATTER_H / 2, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[PLATTER_R, PLATTER_R, PLATTER_H, 48]} />
            <meshStandardMaterial color="#1a1612" roughness={0.45} metalness={0.65} />
          </mesh>

          {/* rubber slipmat, subtle grey-black layer on top of platter */}
          <mesh position={[0, PLATTER_H + 0.0005, 0]} receiveShadow>
            <cylinderGeometry args={[PLATTER_R * 0.98, PLATTER_R * 0.98, 0.001, 48]} />
            <meshStandardMaterial color="#0a0908" roughness={0.95} metalness={0.0} />
          </mesh>

          <group
            ref={recordSwap}
            position={[0, RECORD_REST_Y, 0]}
          >
            {/* vinyl record, sits on top of the slipmat */}
            <mesh castShadow receiveShadow>
              <cylinderGeometry args={[VINYL_R, VINYL_R, VINYL_H, 64]} />
              <meshStandardMaterial color="#0c0a08" roughness={0.4} metalness={0.05} />
            </mesh>

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

      <group position={[PLINTH_W * 0.32, PLINTH_H + 0.001, -PLINTH_D * 0.30]}>
        {/* pivot post */}
        <mesh position={[0, 0.012, 0]} castShadow>
          <cylinderGeometry args={[0.008, 0.010, 0.024, 16]} />
          <meshStandardMaterial color="#cccccc" roughness={0.35} metalness={0.85} />
        </mesh>
        <group
          ref={tonearm}
          rotation={[0, TONEARM_REST_Y, TONEARM_LIFTED_Z]}
        >
          <mesh position={[-0.083, 0.024, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.0017, 0.0017, 0.166, 12]} />
            <meshStandardMaterial color="#cfcfcf" roughness={0.30} metalness={0.85} />
          </mesh>
          <group position={[-0.162, 0.020, 0]}>
            {/* headshell, small block at the far end of the arm */}
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
        <mesh position={[-0.012, 0.008, 0.180]} castShadow>
          <cylinderGeometry args={[0.003, 0.003, 0.016, 12]} />
          <meshStandardMaterial color="#222" roughness={0.6} metalness={0.5} />
        </mesh>
      </group>
    </group>
  );
}
