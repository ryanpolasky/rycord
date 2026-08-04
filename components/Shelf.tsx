"use client";

import { useMemo } from "react";
import { makeWoodTexture } from "@/lib/woodTexture";

// kallax-ish grid: up to 5 columns, then stacks into more rows. adjacent
// cells share a divider so walls are never double thickness.

const CELL_W = 0.33;
// taller than wide, so the led strip under the top board clears the records
const CELL_H = 0.36;
const CELL_D = 0.33;
const WALL = 0.018;
const INNER_H = CELL_H - WALL * 2;
const INNER_D = CELL_D - WALL;

// legacy alias for the x-axis stride
export const SHELF_CELL = CELL_W;
export const SHELF_CELL_W = CELL_W;
export const SHELF_CELL_H = CELL_H;
export const SHELF_CELL_D = CELL_D;
export const SHELF_INNER_H = INNER_H;
export const SHELF_INNER_D = INNER_D;
export const SHELF_WALL = WALL;

export const SHELF_INNER_W = CELL_W - WALL * 2;

// world y of the bottom plank, planted on the floor
export const SHELF_BOTTOM_Y = -0.18;

// world-space centre of a cell; row 0 is the bottom, col 0 the leftmost
export function shelfCellCenter(col: number, row: number, cols: number, rows: number): { x: number; y: number; z: number } {
  const totalW = cols * CELL_W;
  const startX = -totalW / 2;
  const cellX = startX + col * CELL_W + CELL_W / 2;
  const cellY = SHELF_BOTTOM_Y + WALL / 2 + row * CELL_H + CELL_H / 2 - WALL / 2;
  return { x: cellX, y: cellY, z: -0.16 };
}

type Props = {
  cols?: number;
  rows?: number;
};

export default function Shelf({ cols = 1, rows = 1 }: Props) {
  const wood = "#6b3f24";
  const woodDark = "#4a2a16";

  const topTex = useMemo(
    () => makeWoodTexture({ base: wood, dark: woodDark, planks: 5, repeatX: cols, repeatY: 1, size: 1024 }),
    [cols],
  );
  const sideTex = useMemo(
    () => makeWoodTexture({ base: woodDark, dark: "#321a08", planks: 5, repeatX: 1, repeatY: rows }),
    [rows],
  );
  const shelfTex = useMemo(
    () => makeWoodTexture({ base: wood, dark: woodDark, planks: 5, repeatX: cols, repeatY: 1, size: 1024 }),
    [cols],
  );
  const innerTex = useMemo(
    () => makeWoodTexture({ base: "#2e1c10", dark: "#180c04", planks: 3, repeatX: cols, repeatY: rows }),
    [cols, rows],
  );

  const totalWidth = cols * CELL_W;
  const totalHeight = rows * CELL_H;
  const startX = -totalWidth / 2;
  const startY = SHELF_BOTTOM_Y;
  const centerY = startY + totalHeight / 2;

  // otherwise clicks on the top board raycast through to the records inside
  // and yank them out. hover still bubbles so spine tooltips work.
  const swallow = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return (
    <group
      position={[0, centerY, -0.16]}
      onClick={swallow}
      onPointerDown={swallow}
    >
      <mesh position={[0, totalHeight / 2 - WALL / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[totalWidth, WALL, CELL_D]} />
        <meshStandardMaterial map={topTex} color={wood} roughness={0.78} />
      </mesh>

      <mesh position={[0, -totalHeight / 2 + WALL / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[totalWidth, WALL, CELL_D]} />
        <meshStandardMaterial map={topTex} color={woodDark} roughness={0.82} />
      </mesh>

      {/* one shelf between each pair of rows */}
      {Array.from({ length: rows - 1 }).map((_, i) => {
        const y = -totalHeight / 2 + (i + 1) * CELL_H;
        return (
          <mesh key={`h-${i}`} position={[0, y - WALL / 2, 0]} receiveShadow castShadow>
            <boxGeometry args={[totalWidth, WALL, CELL_D]} />
            <meshStandardMaterial map={shelfTex} color={woodDark} roughness={0.82} />
          </mesh>
        );
      })}

      {/* dividers between cells, plus the outer left and right walls */}
      {Array.from({ length: cols + 1 }).map((_, i) => {
        const x = startX + i * CELL_W;
        return (
          <mesh key={`v-${i}`} position={[x, 0, 0]} receiveShadow castShadow>
            <boxGeometry args={[WALL, totalHeight, CELL_D]} />
            <meshStandardMaterial map={sideTex} color={woodDark} roughness={0.78} />
          </mesh>
        );
      })}

      <mesh position={[0, 0, -CELL_D / 2 + WALL / 2]} receiveShadow>
        <boxGeometry args={[totalWidth, totalHeight, WALL]} />
        <meshStandardMaterial map={innerTex} color="#2e1c10" roughness={0.95} />
      </mesh>
    </group>
  );
}
