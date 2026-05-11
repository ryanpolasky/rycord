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

// A folded-down scrap of paper tucked next to the book stack. Works exactly
// like the LED remote: clicking the scrap "summons" it - it lifts off the
// floor and floats up to face the camera so the user can read a short note
// from me, with a clickable LinkedIn line at the bottom. Clicking empty
// space puts it back on the floor.
//
// Picking up the paper auto-dismisses the remote (and vice versa) via the
// mutual-exclusion logic in `setPaperOpen` / `setRemoteOpen`.

type Props = {
  /** World position where the paper rests on the rug. */
  position: [number, number, number];
  /** Stowed-pose Euler rotation in radians. A small Y rotation makes the
   *  scrap look casually dropped rather than perfectly axis-aligned. */
  rotation?: [number, number, number];
};

// Physical dimensions in meters. A torn corner of a notebook page - not
// quite a full sheet, slightly wider than the LED remote so the prose has
// room to breathe.
const W = 0.092; // 9.2 cm wide
const D = 0.118; // 11.8 cm tall
const H = 0.0010; // 1 mm thick

const LINKEDIN_URL = "https://linkedin.com/in/ryan-polasky";

// The note itself. Casual, lowercase to match the hand-jotted vibe. Keep
// this short - too much text and the user can't read it comfortably at the
// summoned distance.
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

  // 0 = stowed flat on rug, 1 = summoned in front of camera. Eased every
  // frame toward whichever pose `paperOpen` selects.
  const t = useRef(0);
  // Force a re-render on hover state changes (cursor/link affordance).
  const [, setTick] = useState(0);
  const hoverLinkRef = useRef(false);

  useFrame((_state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const target = paperOpen ? 1 : 0;
    // Critically damped - same easing constant the remote uses so the two
    // pickups feel like they share a physics budget.
    const omega = 5.0;
    t.current += (target - t.current) * Math.min(1, dt * omega);

    if (!groupRef.current) return;

    // Build the summoned pose: a touch in front of camera, slightly above
    // the camera's lookAt so the message sits in the upper-middle of the
    // frame (the LinkedIn line sits near the lower-middle, comfortably
    // above the footer HUD).
    const camPos = camera.position;
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    const forward = camDir.clone().multiplyScalar(0.48);
    // Lift slightly so the paper centers on the viewport's vertical axis
    // even when the camera is pitched a hair downward.
    const up = new THREE.Vector3(0, 0.02, 0);
    const openPos = camPos.clone().add(forward).add(up);

    const stowedPos = new THREE.Vector3(
      position[0],
      position[1],
      position[2],
    );
    const cur = stowedPos.lerp(openPos, t.current);
    groupRef.current.position.copy(cur);

    // Stowed orientation = the casual flat-on-floor rotation the caller
    // passed in. Summoned orientation = paper facing the camera with text
    // upright on screen. Same basis-construction approach as the remote;
    // see the long comment there for the right-handed-frame caveat.
    const stowedQ = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rotation[0], rotation[1], rotation[2]),
    );

    const dirToCamera = camPos.clone().sub(openPos).normalize();
    const worldUp = new THREE.Vector3(0, 1, 0);
    const yAxis = dirToCamera.clone();
    const screenUp = worldUp
      .clone()
      .sub(yAxis.clone().multiplyScalar(worldUp.dot(yAxis)))
      .normalize();
    const zAxis = screenUp.clone().negate(); // local -Z maps to screen up
    const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
    zAxis.crossVectors(xAxis, yAxis).normalize();
    const summonedM = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    const summonedQ = new THREE.Quaternion().setFromRotationMatrix(summonedM);

    const q = stowedQ.slerp(summonedQ, t.current);
    groupRef.current.quaternion.copy(q);
  });

  const onBodyClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (!paperOpen) {
      // setPaperOpen handles the mutual-exclusion with the remote so we
      // don't need to call setRemoteOpen(false) explicitly here.
      setPaperOpen(true);
    }
  };

  const onLinkClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (!paperOpen) {
      // If the user happens to click on the LinkedIn region while the paper
      // is stowed, treat it as a normal summon - they're not yet at a
      // legible distance and almost certainly didn't mean to navigate.
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

  // Z position of the top face - text sits just above the paper surface to
  // avoid Z-fighting with the body mesh.
  const faceY = H / 2 + 0.0006;

  return (
    <group
      ref={groupRef}
      onClick={onBodyClick}
      onPointerOver={onBodyPointerOver}
      onPointerOut={onBodyPointerOut}
    >
      {/* paper body - warm off-white, very matte. Slight emissive so the
          page reads in the dim room without needing a dedicated light. */}
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

      {/* subtle aged-edge tint - a slightly darker rim under the paper to
          fake a deckled edge / sit it on the rug without floating. */}
      <mesh position={[0, -H * 0.45, 0]}>
        <boxGeometry args={[W + 0.0008, H * 0.5, D + 0.0008]} />
        <meshStandardMaterial color="#d8c8a8" roughness={1.0} />
      </mesh>

      {/* the message - top-anchored so it starts at the upper edge of the
          paper and flows downward. Local -Z is the "top" of the paper
          (the end that maps to screen-up after summoning), so a small
          negative Z places the first line near that edge. */}
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
        // Disable raycast on the text so clicks pass through to the body
        // mesh - without this, clicks on the glyphs would land on the
        // Text mesh (no handler) and bubble to onPointerMissed instead.
        raycast={() => null}
      >
        {MESSAGE_LINES}
      </Text>

      {/* LinkedIn link - separate clickable region at the bottom of the
          paper. The plane is invisible (opacity 0) but still raycasts, so
          the whole bottom strip is a comfortable hit target around the
          actual "linkedin.com/in/ryan-polasky" label. */}
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
