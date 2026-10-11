"use client";

import * as THREE from "three";
import { useRef, useState } from "react";
import {
  type ThreeEvent,
  useFrame,
  useThree,
} from "@react-three/fiber";
import CanvasText from "./CanvasText";
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

// the classic cheap 24-key ir led remote

type Props = {
  // World position to stow the remote (rests on the rug).
  position: [number, number, number];
  // Rotation in radians [x,y,z] when stowed.
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

const SCRATCH = {
  camDir: new THREE.Vector3(),
  forward: new THREE.Vector3(),
  openPos: new THREE.Vector3(),
  stowedPos: new THREE.Vector3(),
  yAxis: new THREE.Vector3(),
  proj: new THREE.Vector3(),
  screenUp: new THREE.Vector3(),
  zAxis: new THREE.Vector3(),
  xAxis: new THREE.Vector3(),
  euler: new THREE.Euler(),
  stowedQ: new THREE.Quaternion(),
  summonedQ: new THREE.Quaternion(),
  basis: new THREE.Matrix4(),
};

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const DOWN_NUDGE = new THREE.Vector3(0, -0.04, 0);
const SETTLE_EPS = 0.0005;

export default function Remote({ position, rotation = [0, 0, 0] }: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const { remoteOpen } = useLedState();

  // animation state: 0 = stowed flat on floor, 1 = summoned in front of camera
  const t = useRef(0);
  const [_, setTick] = useState(0);

  // pressed button bookkeeping for the dip-in-out tactile animation
  const pressedRef = useRef<{ key: string; until: number } | null>(null);
  const stowedWritten = useRef(false);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const target = remoteOpen ? 1 : 0;
    // critically damped easing
    const omega = 5.0;
    t.current += (target - t.current) * Math.min(1, dt * omega);
    if (Math.abs(target - t.current) < SETTLE_EPS) t.current = target;

    // before the early-out so a pressed button releases even while stowed
    if (pressedRef.current && performance.now() / 1000 > pressedRef.current.until) {
      pressedRef.current = null;
      setTick((x) => x + 1);
    }

    if (!groupRef.current) return;

    // at t=0 the stowed pose can't change until the remote is summoned again
    if (t.current === 0) {
      if (stowedWritten.current) return;
    } else {
      stowedWritten.current = false;
    }

    const camPos = camera.position;
    const camDir = SCRATCH.camDir;
    camera.getWorldDirection(camDir);
    // far enough back that all six rows fit, raised so the bottom row clears the viewport
    const forward = SCRATCH.forward.copy(camDir).multiplyScalar(0.62);
    const openPos = SCRATCH.openPos.copy(camPos).add(forward).add(DOWN_NUDGE);

    // Interpolate position between stowed (`position`) and summoned (`openPos`)
    const stowedPos = SCRATCH.stowedPos.set(position[0], position[1], position[2]);
    const cur = stowedPos.lerp(openPos, t.current);
    groupRef.current.position.copy(cur);

    const stowedQ = SCRATCH.stowedQ.setFromEuler(
      SCRATCH.euler.set(rotation[0], rotation[1], rotation[2]),
    );

    // face +Y to camera, -Z up, +X right. +Z up would be left-handed and mirror the buttons
    const yAxis = SCRATCH.yAxis.copy(camPos).sub(openPos).normalize();
    const screenUp = SCRATCH.screenUp
      .copy(WORLD_UP)
      .sub(SCRATCH.proj.copy(yAxis).multiplyScalar(WORLD_UP.dot(yAxis)))
      .normalize();
    const zAxis = SCRATCH.zAxis.copy(screenUp).negate(); // local -Z = screen up
    const xAxis = SCRATCH.xAxis.crossVectors(yAxis, zAxis).normalize();
    // Re-orthogonalize zAxis against tiny float drift.
    zAxis.crossVectors(xAxis, yAxis).normalize();
    const summonedM = SCRATCH.basis.makeBasis(xAxis, yAxis, zAxis);
    const summonedQ = SCRATCH.summonedQ.setFromRotationMatrix(summonedM);

    const q = stowedQ.slerp(summonedQ, t.current);
    groupRef.current.quaternion.copy(q);

    if (t.current === 0) stowedWritten.current = true;
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
    pressedRef.current = { key, until: performance.now() / 1000 + 0.08 };
    setTick((x) => x + 1);

    if (btn.kind === "color") {
      setLedColor(btn.color);
      setLedPattern("static");
    } else {
      switch (btn.cmd) {
        case "brightUp": bumpIntensity(0.18); break;
        case "brightDown": bumpIntensity(-0.18); break;
        case "off": setLedEnabled(false); break;
        case "on": setLedEnabled(true); setLedPattern("rainbow"); break;
        case "flash": stepFlash(); break;
        case "strobe": stepStrobe(); break;
        case "fade": stepFade(); break;
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

  // shared button mesh, small disk on top face of the remote
  const buttonRadius = Math.min(cellW, cellD) * 0.34;

  // clicks on the plastic between buttons still count as hitting the remote
  const onBodyMeshClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (!remoteOpen) setRemoteOpen(true);
  };

  return (
    <group ref={groupRef} onClick={handleBodyClick} onPointerOver={swallowPointer} onPointerOut={clearPointer}>
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

      <mesh position={[0, -H * 0.45, 0]} onClick={onBodyMeshClick}>
        <boxGeometry args={[W + 0.001, H * 0.5, D + 0.001]} />
        <meshStandardMaterial color="#161616" roughness={0.9} />
      </mesh>

      <mesh position={[0, H / 2 + 0.0005, -D / 2 + 0.005]} onClick={onBodyMeshClick}>
        <cylinderGeometry args={[0.003, 0.003, 0.001, 12]} />
        <meshStandardMaterial color="#0a0a0a" roughness={0.5} />
      </mesh>

      {GRID.map((row, rIdx) =>
        row.map((btn, cIdx) => {
          const key = `${rIdx}-${cIdx}`;
          const x = -GRID_W / 2 + cellW / 2 + cIdx * cellW;
          const z = -GRID_D / 2 + cellD / 2 + rIdx * cellD;
          const pressed = pressedRef.current?.key === key;
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
  pressed: boolean;
  radius: number;
  cellW: number;
  cellD: number;
  onClick: (e: { stopPropagation: () => void }) => void;
  clickable: boolean;
}) {
  const dim = pressed ? 0.82 : 1.0;
  if (btn.kind === "color") {
    return (
      <group position={[x, y, z]}>
        {/* pad doubles as a bigger hit target than the disc */}
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
          <CanvasText
            position={[0, 0.0008, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={radius * 0.7}
            color="#000000"
            anchorX="center"
            anchorY="middle"
            textAlign="center"
          >
            {btn.label}
          </CanvasText>
        )}
      </group>
    );
  }

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
      <CanvasText
        position={[0, 0.0008, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={radius * 0.42}
        color={textColor}
        anchorX="center"
        anchorY="middle"
        maxWidth={radius * 2.4}
        textAlign="center"
      >
        {btn.label}
      </CanvasText>
    </group>
  );
}
