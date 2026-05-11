"use client";

import * as THREE from "three";
import { useRef, useState } from "react";
import {
  type ThreeEvent,
  useFrame,
  useThree,
} from "@react-three/fiber";
import { Text } from "@react-three/drei";
import {
  bumpIntensity,
  setLedColor,
  setLedEnabled,
  setLedPattern,
  stepFlash,
  stepStrobe,
  stepFade,
  stepSmooth,
  setRemoteOpen,
  useLedState,
} from "@/lib/ledStore";

// Cheap chinesium IR LED remote — thin white plastic, black border, with the
// classic 4×6 button grid (brightness, OFF/ON, 12 colors + W, FLASH/STROBE/
// FADE/SMOOTH down the right column).
//
// Two states:
//   stowed:   sits flat on the floor; clicking ANY part of it summons it
//   summoned: floats up + forward + rotates to face the camera, individual
//             buttons become hit-targetable; clicking empty space dismisses
//             it back to the floor.

type Props = {
  /** World position to stow the remote (rests on the rug). */
  position: [number, number, number];
  /** Rotation in radians [x,y,z] when stowed. */
  rotation?: [number, number, number];
};

// Physical dimensions, meters. Modelled after the reference image.
const W = 0.095;     // 9.5 cm wide
const D = 0.155;     // 15.5 cm tall (depth on the floor)
const H = 0.005;     // 5 mm thick

function swallowPointer(e: ThreeEvent<PointerEvent>) {
  e.stopPropagation();
  document.body.style.cursor = "pointer";
}

function clearPointer(e: ThreeEvent<PointerEvent>) {
  e.stopPropagation();
  document.body.style.cursor = "auto";
}

// Multiply a hex color by a scalar in [0..1] and return a new hex string.
// Used for the press-dim tactile feedback. Cheap and avoids allocating a
// new THREE.Color per render.
function dimHex(hex: string, k: number): string {
  if (k >= 1) return hex;
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  const toHex = (v: number) => v.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Layout: 6 rows × 4 cols of buttons.
// Each button is one of:
//   - color: clicking sets the accent color to `color`
//   - command: clicking runs a specific action
// The layout matches the reference photo top-to-bottom.

type Btn =
  | { kind: "color"; color: string; label?: string }
  | { kind: "cmd"; cmd: "brightUp" | "brightDown" | "off" | "on" | "flash" | "strobe" | "fade" | "smooth"; label: string; tone?: string };

const GRID: Btn[][] = [
  [
    { kind: "cmd", cmd: "brightUp", label: "+" },
    { kind: "cmd", cmd: "brightDown", label: "−" },
    { kind: "cmd", cmd: "off", label: "OFF", tone: "#1a1a1a" },
    { kind: "cmd", cmd: "on", label: "ON", tone: "#d24a3a" },
  ],
  [
    { kind: "color", color: "#ff3333", label: "R" },
    { kind: "color", color: "#33c34a", label: "G" },
    { kind: "color", color: "#2d6dff", label: "B" },
    { kind: "color", color: "#f5f3ee", label: "W" },
  ],
  [
    { kind: "color", color: "#ff5a1a" },
    { kind: "color", color: "#7ec23a" },
    { kind: "color", color: "#3a6dd9" },
    { kind: "cmd", cmd: "flash", label: "FLASH" },
  ],
  [
    { kind: "color", color: "#ff8a2a" },
    { kind: "color", color: "#36b2a0" },
    { kind: "color", color: "#6a40c8" },
    { kind: "cmd", cmd: "strobe", label: "STROBE" },
  ],
  [
    { kind: "color", color: "#f7b03a" },
    { kind: "color", color: "#3ec0e3" },
    { kind: "color", color: "#c64aa6" },
    { kind: "cmd", cmd: "fade", label: "FADE" },
  ],
  [
    { kind: "color", color: "#f5dc3a" },
    { kind: "color", color: "#5fd4e8" },
    { kind: "color", color: "#f06aa8" },
    { kind: "cmd", cmd: "smooth", label: "SMOOTH" },
  ],
];

export default function Remote({ position, rotation = [0, 0, 0] }: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const { remoteOpen } = useLedState();

  // animation state: 0 = stowed flat on floor, 1 = summoned in front of camera
  const t = useRef(0);
  const [_, setTick] = useState(0);

  // pressed button bookkeeping for the dip-in-out tactile animation
  const pressedRef = useRef<{ key: string; until: number } | null>(null);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const target = remoteOpen ? 1 : 0;
    // critically damped easing
    const omega = 5.0;
    t.current += (target - t.current) * Math.min(1, dt * omega);

    if (!groupRef.current) return;

    // Build the summoned pose: anchored in front of the camera, slightly
    // below center so the remote sits in the lower-half of the frame and
    // doesn't cover the records.
    const camPos = camera.position;
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    // Summon a touch FARTHER from camera (so the remote appears slightly
    // smaller and the full 6-row grid fits comfortably in frame) and
    // RAISE it relative to the camera's lookAt so the bottom row of
    // buttons is well above the viewport bottom edge.
    const forward = camDir.clone().multiplyScalar(0.62);
    const down = new THREE.Vector3(0, -0.04, 0);
    const openPos = camPos.clone().add(forward).add(down);

    // Interpolate position between stowed (`position`) and summoned (`openPos`)
    const stowedPos = new THREE.Vector3(position[0], position[1], position[2]);
    const cur = stowedPos.lerp(openPos, t.current);
    groupRef.current.position.copy(cur);

    // Interpolate rotation between stowed (flat on floor) and summoned
    // (held up to face the camera).
    const stowedQ = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rotation[0], rotation[1], rotation[2]),
    );

    // Build the summoned orientation by composing the world-frame axes we
    // want the remote's local axes to map onto:
    //   - local +Y face   → toward camera (dirToCamera)
    //   - local -Z top    → screen up (the +Y component of world up,
    //                       projected perpendicular to dirToCamera)
    //   - local +X right  → screen right
    //
    // This is the only right-handed assignment that keeps the buttons
    // upright AND not-mirrored: face=+Y / top=+Z / right=+X would form a
    // left-handed frame, so we must use -Z for screen-up rather than +Z.
    const dirToCamera = camPos.clone().sub(openPos).normalize();
    const worldUp = new THREE.Vector3(0, 1, 0);
    const yAxis = dirToCamera.clone();
    const screenUp = worldUp
      .clone()
      .sub(yAxis.clone().multiplyScalar(worldUp.dot(yAxis)))
      .normalize();
    const zAxis = screenUp.clone().negate(); // local -Z = screen up
    const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
    // Re-orthogonalize zAxis against tiny float drift.
    zAxis.crossVectors(xAxis, yAxis).normalize();
    const summonedM = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    const summonedQ = new THREE.Quaternion().setFromRotationMatrix(summonedM);

    const q = stowedQ.slerp(summonedQ, t.current);
    groupRef.current.quaternion.copy(q);

    // Idle pulse render to keep state up to date (for `pressed` button visuals).
    // IMPORTANT: `until` is written using `performance.now() / 1000` in
    // `onButton` below, so we must compare against the SAME wall-clock
    // here — NOT `state.clock.elapsedTime`, which is a three.js Clock
    // with a different baseline (would never expire and the button would
    // stay dim forever).
    if (pressedRef.current && performance.now() / 1000 > pressedRef.current.until) {
      pressedRef.current = null;
      setTick((x) => x + 1);
    }
  });

  const handleBodyClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (!remoteOpen) {
      setRemoteOpen(true);
    }
  };

  const onButton = (btn: Btn, key: string, e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (!remoteOpen) {
      setRemoteOpen(true);
      return;
    }
    // 80ms tactile flash; just long enough to read as a press without
    // looking like the button got disabled.
    pressedRef.current = { key, until: performance.now() / 1000 + 0.08 };
    setTick((x) => x + 1);

    if (btn.kind === "color") {
      setLedColor(btn.color);
      setLedPattern("static");
    } else {
      switch (btn.cmd) {
        // bump by 0.18 per press; bumpIntensity clamps to ~0.2..2.6 so the
        // user can hold-and-mash these without blacking out or blowing
        // bloom past sane levels.
        case "brightUp": bumpIntensity(0.18); break;
        case "brightDown": bumpIntensity(-0.18); break;
        case "off": setLedEnabled(false); break;
        // ON: restore the default rainbow gradient (matches the room's
        // default state). Press a color button after to override.
        case "on": setLedEnabled(true); setLedPattern("rainbow"); break;
        // FLASH = hard on/off strobing variants. Multi-press cycles
        // through (1) hard white strobe, (2) accent-color strobe,
        // (3) sparse rainbow lightning flashes.
        case "flash": stepFlash(); break;
        // STROBE = bright moving waves with strobe overlay. Multi-press
        // cycles through (1) pulse-wave running left→right, (2) high-
        // contrast running rainbow gradient, (3) two-color split with
        // strobe overlay.
        case "strobe": stepStrobe(); break;
        // FADE = palette-flavored slowly-sliding gradient. Multi-press
        // cycles through (1) full rainbow drift, (2) warm gradient,
        // (3) cool gradient, (4) sunset peach/amber/rose.
        case "fade": stepFade(); break;
        // SMOOTH = animated rainbow variants. Multi-press cycles through
        // (1) classic hue-slide rainbow [room default], (2) faster
        // multi-band sweep, (3) rainbow that breathes, (4) bright
        // rainbow comet bouncing across the strip.
        case "smooth": stepSmooth(); break;
      }
    }
  };

  // Button geometry & layout
  const PAD_X = 0.010;
  const PAD_TOP = 0.012;
  const PAD_BOT = 0.012;
  const GRID_W = W - PAD_X * 2;
  const GRID_D = D - PAD_TOP - PAD_BOT;
  const COLS = 4;
  const ROWS = 6;
  const cellW = GRID_W / COLS;
  const cellD = GRID_D / ROWS;

  // shared button mesh — small disk on top face of the remote
  const buttonRadius = Math.min(cellW, cellD) * 0.34;

  // Body-mesh click handler: ABSORBS clicks that landed on the white
  // plastic body (between buttons / on the border / on the IR emitter).
  // Without this, those clicks "miss" any event-participating object,
  // R3F fires `onPointerMissed`, and the Scene dismisses the remote —
  // which is why some button presses appeared to do nothing (the user
  // landed slightly off the button face).
  const onBodyMeshClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (!remoteOpen) setRemoteOpen(true);
    // when already open, this is just a "swallow the click so the canvas
    // doesn't treat it as empty-space" — no further action.
  };

  return (
    <group ref={groupRef} onClick={handleBodyClick} onPointerOver={swallowPointer} onPointerOut={clearPointer}>
      {/* main body — thin white plastic. Small emissive so it reads as
          "white plastic" in the dim cozy room (otherwise it falls into shadow). */}
      <mesh receiveShadow castShadow onClick={onBodyMeshClick}>
        <boxGeometry args={[W, H, D]} />
        <meshStandardMaterial
          color="#f5f3ee"
          roughness={0.78}
          metalness={0.03}
          emissive="#f5f3ee"
          emissiveIntensity={0.08}
        />
      </mesh>

      {/* black border trim — slightly outset, thinner. Also absorbs
          clicks so border-zone clicks don't dismiss. */}
      <mesh position={[0, -H * 0.45, 0]} onClick={onBodyMeshClick}>
        <boxGeometry args={[W + 0.001, H * 0.5, D + 0.001]} />
        <meshStandardMaterial color="#161616" roughness={0.9} />
      </mesh>

      {/* IR emitter — small dark disc at the top of the remote (-Z end).
          Local -Z is the "top" of the remote (the end pointed AWAY from
          the user when held). The summoned-pose construction maps -Z onto
          screen-up, so this end appears at the top of the screen. */}
      <mesh position={[0, H / 2 + 0.0005, -D / 2 + 0.005]} onClick={onBodyMeshClick}>
        <cylinderGeometry args={[0.003, 0.003, 0.001, 12]} />
        <meshStandardMaterial color="#0a0a0a" roughness={0.5} />
      </mesh>

      {/* Button grid.
          Row 0 = brightness/OFF/ON sits at the TOP of the remote (local -Z).
          When summoned, local -Z maps to screen-up, so row 0 ends up at the
          top of the user's view. cIdx 0 sits at local -X = screen-left. */}
      {GRID.map((row, rIdx) =>
        row.map((btn, cIdx) => {
          const key = `${rIdx}-${cIdx}`;
          const x = -GRID_W / 2 + cellW / 2 + cIdx * cellW;
          const z = -GRID_D / 2 + cellD / 2 + rIdx * cellD;
          const pressed = pressedRef.current?.key === key;
          // Tactile feedback is now a 120ms COLOR DIM on the button face
          // (handled inside RemoteButton via the `pressed` prop), not a
          // Z-translation. The 3D depress was sinking the button face
          // INTO the shell, making it visually disappear for the dip.
          return (
            <RemoteButton
              key={key}
              x={x}
              z={z}
              y={H / 2 + 0.0010}
              btn={btn}
              pressed={pressed}
              radius={buttonRadius}
              cellW={cellW}
              cellD={cellD}
              onClick={(e) => onButton(btn, key, e)}
              clickable={remoteOpen}
            />
          );
        }),
      )}
    </group>
  );
}

function RemoteButton({
  x,
  z,
  y,
  btn,
  pressed,
  radius,
  cellW,
  cellD,
  onClick,
  clickable,
}: {
  x: number;
  z: number;
  y: number;
  btn: Btn;
  /** True for ~120ms after click. Dims the button face to give tactile
   *  feedback without sinking the geometry below the shell. */
  pressed: boolean;
  radius: number;
  cellW: number;
  cellD: number;
  onClick: (e: { stopPropagation: () => void }) => void;
  clickable: boolean;
}) {
  // Tactile dim: shave the face color/emissive lightly for ~80ms. Stays
  // close to the base color so the dip reads as "user pressed a button"
  // not "button just got disabled / went dark grey".
  const dim = pressed ? 0.82 : 1.0;
  // Hover state no longer drives any emissive change — pressing is the
  // only visual feedback. The press-depress is handled in the parent via
  // the `pressed` ref + small Y-offset; here we just swap the mouse
  // cursor on enter/leave so the button reads as clickable.
  if (btn.kind === "color") {
    return (
      <group position={[x, y, z]}>
        {/* tinted background pad — also catches clicks (bigger hit-target than
            the small colored disc on top). */}
        <mesh
          position={[0, -0.0003, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          onPointerOver={(e) => {
            if (!clickable) return;
            e.stopPropagation();
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={(e) => {
            e.stopPropagation();
            document.body.style.cursor = "auto";
          }}
          onClick={onClick}
        >
          <planeGeometry args={[cellW * 0.95, cellD * 0.95]} />
          <meshStandardMaterial color="#dcd9d2" roughness={0.95} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} onClick={onClick}>
          <circleGeometry args={[radius, 24]} />
          <meshStandardMaterial
            color={dimHex(btn.color, dim)}
            roughness={0.55}
            emissive={btn.color}
            emissiveIntensity={0.12 * dim}
          />
        </mesh>
        {btn.label && (
          <Text
            position={[0, 0.0008, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={radius * 0.7}
            color={btn.color === "#f5f3ee" ? "#000000" : "#000000"}
            anchorX="center"
            anchorY="middle"
            // The label glyphs sit OVER the button face. We don't want
            // them to swallow clicks — without `raycast={null}` r3f
            // raycasts the Text mesh first, finds no onClick handler,
            // and the click bubbles to the outer remote group's
            // `handleBodyClick` (a no-op when the remote is open).
            // Result: pressing dead-center on a button label sometimes
            // does nothing. Disabling raycast on the label sends the
            // click through to the button face below.
            raycast={() => null}
          >
            {btn.label}
          </Text>
        )}
      </group>
    );
  }

  // command button
  // - OFF: dark base, off-white text
  // - ON:  red base, off-white text
  // - all other grey buttons: light grey base, BLACK text (was "#2a2a2a" dark
  //   grey, which read as low-contrast grey-on-grey)
  const isOff = btn.cmd === "off";
  const isOn = btn.cmd === "on";
  const buttonColor = btn.tone ?? (isOff ? "#1a1a1a" : isOn ? "#d24a3a" : "#cfcdc6");
  const textColor = isOff || isOn ? "#f3f1ec" : "#000000";
  return (
    <group position={[x, y, z]}>
      <mesh
        position={[0, -0.0003, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerOver={(e) => {
          if (!clickable) return;
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          document.body.style.cursor = "auto";
        }}
        onClick={onClick}
      >
        <planeGeometry args={[cellW * 0.95, cellD * 0.95]} />
        <meshStandardMaterial color="#dcd9d2" roughness={0.95} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} onClick={onClick}>
        <circleGeometry args={[radius, 24]} />
        <meshStandardMaterial color={dimHex(buttonColor, dim)} roughness={0.7} />
      </mesh>
      <Text
        position={[0, 0.0008, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={radius * 0.42}
        color={textColor}
        anchorX="center"
        anchorY="middle"
        maxWidth={radius * 2.4}
        // Disable raycast on label so clicks pass through to the button
        // face below. See the matching note on the color buttons above.
        raycast={() => null}
      >
        {btn.label}
      </Text>
    </group>
  );
}
