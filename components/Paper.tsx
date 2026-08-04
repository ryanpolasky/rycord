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
  setPaperOpen,
  useLedState,
} from "@/lib/ledStore";

// a scrap of paper on the rug. clicking summons it to face the camera,
// clicking empty space puts it back. mutually exclusive with the remote.

type Props = {
  // where the paper rests on the rug
  position: [number, number, number];
  // stowed euler in radians; a small y rotation reads as casually dropped
  rotation?: [number, number, number];
};

// metres
const W = 0.092;
const D = 0.118;
const H = 0.0010;

const LINKEDIN_URL = "https://linkedin.com/in/ryan-polasky";

// reused every frame so the pose maths allocates nothing
const S = {
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
const UP_NUDGE = new THREE.Vector3(0, 0.02, 0);
const SETTLE_EPS = 0.0005;

const MESSAGE_LINES = [
  "hey, i'm ryan :)",
  "",
  "i made this site so i could look",
  "at my record collection in a real(ish) way " +
  "from anywhere. if you stumbled in, i hope you enjoy " +
  "poking around. flip a record, mess with " +
  "the rgb remote, etc.",
  "",
  "if you like my work or want to",
  "get in touch, my linkedin's below.",
  "thanks for stopping by <3",
].join("\n");

export default function Paper({ position, rotation = [0, 0, 0] }: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const { paperOpen } = useLedState();

  // 0 = stowed on rug, 1 = summoned in front of camera
  const t = useRef(0);
  const [, setTick] = useState(0);
  const hoverLinkRef = useRef(false);
  const stowedWritten = useRef(false);

  useFrame((_state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const target = paperOpen ? 1 : 0;
    // matches the remote so both pickups feel the same
    const omega = 5.0;
    t.current += (target - t.current) * Math.min(1, dt * omega);
    if (Math.abs(target - t.current) < SETTLE_EPS) t.current = target;

    if (!groupRef.current) return;

    // at t=0 the pose is a fixed transform, so it only needs writing once
    if (t.current === 0) {
      if (stowedWritten.current) return;
    } else {
      stowedWritten.current = false;
    }

    // slightly above the camera's lookAt, so the note sits upper-middle and
    // the linkedin line clears the footer hud
    const camPos = camera.position;
    const camDir = S.camDir;
    camera.getWorldDirection(camDir);
    const forward = S.forward.copy(camDir).multiplyScalar(0.48);
    const openPos = S.openPos.copy(camPos).add(forward).add(UP_NUDGE);

    const stowedPos = S.stowedPos.set(
      position[0],
      position[1],
      position[2],
    );
    const cur = stowedPos.lerp(openPos, t.current);
    groupRef.current.position.copy(cur);

    const stowedQ = S.stowedQ.setFromEuler(
      S.euler.set(rotation[0], rotation[1], rotation[2]),
    );

    const yAxis = S.yAxis.copy(camPos).sub(openPos).normalize();
    const screenUp = S.screenUp
      .copy(WORLD_UP)
      .sub(S.proj.copy(yAxis).multiplyScalar(WORLD_UP.dot(yAxis)))
      .normalize();
    // local -z maps to screen up
    const zAxis = S.zAxis.copy(screenUp).negate();
    const xAxis = S.xAxis.crossVectors(yAxis, zAxis).normalize();
    zAxis.crossVectors(xAxis, yAxis).normalize();
    const summonedM = S.basis.makeBasis(xAxis, yAxis, zAxis);
    const summonedQ = S.summonedQ.setFromRotationMatrix(summonedM);

    const q = stowedQ.slerp(summonedQ, t.current);
    groupRef.current.quaternion.copy(q);

    if (t.current === 0) stowedWritten.current = true;
  });

  const onBodyClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (!paperOpen) {
      // setPaperOpen already handles mutual exclusion with the remote
      setPaperOpen(true);
    }
  };

  const onLinkClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (!paperOpen) {
      // not legible yet, so this can't have been a deliberate navigation
      setPaperOpen(true);
      return;
    }
    window.open(LINKEDIN_URL, "_blank", "noopener,noreferrer");
  };

  const onBodyPointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    document.body.style.cursor = "pointer";
  };
  const onBodyPointerOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    document.body.style.cursor = "auto";
  };
  const onLinkPointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    document.body.style.cursor = "pointer";
    if (!hoverLinkRef.current) {
      hoverLinkRef.current = true;
      setTick((x) => x + 1);
    }
  };
  const onLinkPointerOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    document.body.style.cursor = "auto";
    if (hoverLinkRef.current) {
      hoverLinkRef.current = false;
      setTick((x) => x + 1);
    }
  };

  // just above the surface to avoid z-fighting with the body mesh
  const faceY = H / 2 + 0.0006;

  return (
    <group
      ref={groupRef}
      onClick={onBodyClick}
      onPointerOver={onBodyPointerOver}
      onPointerOut={onBodyPointerOut}
    >
      {/* emissive so the page reads in the dim room without its own light */}
      <mesh receiveShadow castShadow>
        <boxGeometry args={[W, H, D]} />
        <meshStandardMaterial
          color="#f1e6cf"
          roughness={0.96}
          metalness={0.0}
          emissive="#f1e6cf"
          emissiveIntensity={0.05}
        />
      </mesh>

      {/* darker rim so the scrap sits on the rug instead of floating */}
      <mesh position={[0, -H * 0.45, 0]}>
        <boxGeometry args={[W + 0.0008, H * 0.5, D + 0.0008]} />
        <meshStandardMaterial color="#d8c8a8" roughness={1.0} />
      </mesh>

      {/* local -z is the top edge once summoned, so the text starts there */}
      <Text
        position={[0, faceY, -D / 2 + 0.011]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.0046}
        color="#3b2e1f"
        anchorX="center"
        anchorY="top"
        maxWidth={W - 0.014}
        lineHeight={1.35}
        letterSpacing={0.01}
        // otherwise glyph clicks hit this mesh and bubble to onPointerMissed
        raycast={() => null}
      >
        {MESSAGE_LINES}
      </Text>

      {/* invisible but still raycasts, so the whole strip is a hit target */}
      <mesh
        position={[0, faceY - 0.0001, D / 2 - 0.013]}
        rotation={[-Math.PI / 2, 0, 0]}
        onClick={onLinkClick}
        onPointerOver={onLinkPointerOver}
        onPointerOut={onLinkPointerOut}
      >
        <planeGeometry args={[W - 0.012, 0.014]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      <Text
        position={[0, faceY, D / 2 - 0.013]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.01}
        color={hoverLinkRef.current ? "#0a66c2" : "#14569e"}
        anchorX="center"
        anchorY="middle"
        letterSpacing={0.02}
        raycast={() => null}
      >
        → click me!
      </Text>
    </group>
  );
}
