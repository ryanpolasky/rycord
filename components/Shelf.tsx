"use client";

import { useMemo } from "react";
import { makeWoodTexture } from "@/lib/woodTexture";

// IKEA Kallax-ish: each cell is 33cm wide and 33cm deep — the *segment*
// unit — but the cell is a bit taller (36cm) than wide so the LED strip
// tucked under the top board has headroom over the records. Looks
// essentially square from the front, just slightly tall.
//
// Shelf grows as a GRID: up to 5 columns wide, then stacks vertically into
// additional rows (like a real Kallax wall unit).
//
// Adjacent cells share a vertical divider so we don't draw double-thickness
// walls. The "outer" frame is the box around the whole grid; "interior"
// dividers split it into cells.

const CELL_W = 0.33;        // segment width (the user's "one cell wide" unit)
const CELL_H = 0.36;        // a touch taller so records have headroom
const CELL_D = 0.33;        // depth, matches width visually
const WALL = 0.018;         // 18 mm board
const INNER_H = CELL_H - WALL * 2;
const INNER_D = CELL_D - WALL;

export const SHELF_CELL = CELL_W;       // x-axis stride (legacy alias = width)
export const SHELF_CELL_W = CELL_W;
export const SHELF_CELL_H = CELL_H;
export const SHELF_CELL_D = CELL_D;
export const SHELF_INNER_H = INNER_H;
export const SHELF_INNER_D = INNER_D;
export const SHELF_WALL = WALL;

// How wide a cell's INSIDE is (X axis), available for record packing.
export const SHELF_INNER_W = CELL_W - WALL * 2;

// Grid origin: this is the world-Y of the BOTTOM of the bottom-most row.
// So the unit sits on the floor (floor at y=-0.18); we plant the bottom
// row's bottom plank at that floor line.
export const SHELF_BOTTOM_Y = -0.18;

/**
 * Where is the CENTER of cell (col, row) in world space?
 * row 0 = bottom row (rests on the floor)
 * col 0 = leftmost column
 */
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
  const wood = "#6b3f24";       // darker, warmer cherry
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
  const startY = SHELF_BOTTOM_Y;       // bottom of the unit sits on floor
  const centerY = startY + totalHeight / 2;

  // Swallow clicks that land on any shelf surface so they don't dispatch
  // through to records behind it. Without this, viewing the turntable
  // closeup (camera angled down from above) lets clicks on the top board
  // raycast straight through to vinyls inside the cells and yank them
  // out at random. Hover events are allowed to keep bubbling so the
  // record tooltip still works when the cursor is genuinely over a spine.
  const swallow = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return (
    <group
      position={[0, centerY, -0.16]}
      onClick={swallow}
      onPointerDown={swallow}
    >
      {/* top board — spans whole top of the grid */}
      <mesh position={[0, totalHeight / 2 - WALL / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[totalWidth, WALL, CELL_D]} />
        <meshStandardMaterial map={topTex} color={wood} roughness={0.78} />
      </mesh>

      {/* bottom board */}
      <mesh position={[0, -totalHeight / 2 + WALL / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[totalWidth, WALL, CELL_D]} />
        <meshStandardMaterial map={topTex} color={woodDark} roughness={0.82} />
      </mesh>

      {/* interior horizontal shelves — one between every pair of adjacent rows */}
      {Array.from({ length: rows - 1 }).map((_, i) => {
        const y = -totalHeight / 2 + (i + 1) * CELL_H;
        return (
          <mesh key={`h-${i}`} position={[0, y - WALL / 2, 0]} receiveShadow castShadow>
            <boxGeometry args={[totalWidth, WALL, CELL_D]} />
            <meshStandardMaterial map={shelfTex} color={woodDark} roughness={0.82} />
          </mesh>
        );
      })}

      {/* vertical dividers — one between every pair of cells, plus outer left/right */}
      {Array.from({ length: cols + 1 }).map((_, i) => {
        const x = startX + i * CELL_W;
        return (
          <mesh key={`v-${i}`} position={[x, 0, 0]} receiveShadow castShadow>
            <boxGeometry args={[WALL, totalHeight, CELL_D]} />
            <meshStandardMaterial map={sideTex} color={woodDark} roughness={0.78} />
          </mesh>
        );
      })}

      {/* back wall — one panel spans the whole back */}
      <mesh position={[0, 0, -CELL_D / 2 + WALL / 2]} receiveShadow>
        <boxGeometry args={[totalWidth, totalHeight, WALL]} />
        <meshStandardMaterial map={innerTex} color="#2e1c10" roughness={0.95} />
      </mesh>
    </group>
  );
}
