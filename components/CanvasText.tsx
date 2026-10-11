"use client";

import { useEffect, useMemo } from "react";
import { makeTextTexture } from "@/lib/textTexture";

// drei <Text> without troika, see lib/textTexture

const NEVER_RAYCAST = () => null;

type Props = {
  children: string;
  fontSize: number;
  color: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  anchorX?: "left" | "center" | "right";
  anchorY?: "top" | "middle" | "bottom";
  maxWidth?: number;
  lineHeight?: number;
  letterSpacing?: number;
  fontWeight?: string | number;
  textAlign?: "left" | "center" | "right";
};

export default function CanvasText({
  children,
  fontSize,
  color,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  anchorX = "center",
  anchorY = "middle",
  maxWidth,
  lineHeight,
  letterSpacing,
  fontWeight,
  textAlign,
}: Props) {
  const built = useMemo(
    () =>
      makeTextTexture({
        text: children,
        fontSize,
        color,
        maxWidth,
        lineHeight,
        letterSpacing,
        fontWeight,
        textAlign,
      }),
    [children, fontSize, color, maxWidth, lineHeight, letterSpacing, fontWeight, textAlign],
  );

  useEffect(() => () => built?.texture.dispose(), [built]);

  if (!built) return null;
  const { texture, width, height } = built;

  const offsetX = anchorX === "center" ? 0 : anchorX === "left" ? width / 2 : -width / 2;
  const offsetY = anchorY === "middle" ? 0 : anchorY === "top" ? -height / 2 : height / 2;

  return (
    <group position={position} rotation={rotation}>
      <mesh position={[offsetX, offsetY, 0]} raycast={NEVER_RAYCAST}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial map={texture} transparent depthWrite={false} />
      </mesh>
    </group>
  );
}
