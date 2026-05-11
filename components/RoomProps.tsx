"use client";

import * as THREE from "three";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { setHoveredNote, type HoverNote } from "@/lib/hoverStore";

// A few simple props to make the room feel lived-in: a small houseplant in
// the corner, a framed picture on the wall, a stack of books on the floor,
// and a mug sitting near the shelf. All low-poly + procedural textures so
// they read as "stuff" without expensive geometry.

type Props = {
  /** Half-width of the shelf in world space, so props can sit just past it. */
  shelfHalfWidth?: number;
  wallArtUrls?: {
    left?: string;
    right?: string;
  };
  wallArtNotes?: {
    left?: HoverNote;
    right?: HoverNote;
  };
  focusedArt?: "left" | "right" | null;
  onSelectArt?: (which: "left" | "right") => void;
};

const DEFAULT_WALL_ART_NOTES: { left: HoverNote; right: HoverNote } = {
  left: {
    eyebrow: "A Cold Place",
    main: "A little piece of home.",
  },
  right: {
    eyebrow: "Beloved Companion",
    main: "Dedicated to Coco, the best girl there ever was.",
  },
};

export default function RoomProps({
  shelfHalfWidth = 0.165,
  wallArtUrls,
  wallArtNotes,
  focusedArt = null,
  onSelectArt,
}: Props) {
  // Place props clear of the shelf — derive their x from shelfHalfWidth so they
  // sit just to the side of the shelf no matter how wide the shelf grows.
  const padding = 0.22;          // breathing room past the shelf edge
  const wallZ = -0.39;           // close to back wall (wall is at z=-0.5)
  return (
    <group>
      {/* houseplant against the back wall, to the right of the shelf */}
      <Houseplant position={[shelfHalfWidth + padding + 0.05, -0.18, wallZ]} />

      {/* one larger framed print on the wall, left of the shelf */}
      <PictureFrame
        position={[-(shelfHalfWidth + padding + 0.25), 0.215, -0.49]}
        imageUrl={wallArtUrls?.left}
        hoverNote={wallArtNotes?.left ?? DEFAULT_WALL_ART_NOTES.left}
        focused={focusedArt === "left"}
        onClick={() => onSelectArt?.("left")}
      />
      {/* a smaller print on the right, above the plant */}
      <PictureFrame
        position={[shelfHalfWidth + padding + 0.34, 0.275, -0.49]}
        imageUrl={wallArtUrls?.right}
        hoverNote={wallArtNotes?.right ?? DEFAULT_WALL_ART_NOTES.right}
        focused={focusedArt === "right"}
        onClick={() => onSelectArt?.("right")}
        small
      />

      {/* stack of books on the floor, in front of the shelf-left.
          Books start at y=-0.178 (2mm above floor) — keeps the contact
          shadow tight but avoids z-fighting with the floor plane. */}
      <BookStack position={[-(shelfHalfWidth + padding - 0.04), -0.178, 0.42]} />
      {/* coffee mug on top of the book stack. The stack total height is
          22+28+18+25 = 93mm + 5mm initial offset, so its top sits at
          y = -0.178 + 0.098 = -0.080. Sit the mug 1mm above that so its
          shadow lands on the top book instead of fighting with it. */}
      <Mug position={[-(shelfHalfWidth + padding - 0.04), -0.079, 0.42]} />
    </group>
  );
}

// -------------------- Houseplant --------------------
// pothos-style trailing plant in a terracotta pot — uses an alpha-cut leaf
// texture so each leaf has a real organic shape (not a rectangle).
function Houseplant({ position }: { position: [number, number, number] }) {
  const leavesGroup = useRef<THREE.Group>(null);
  const leafTex = useMemo(() => makeLeafTexture(), []);

  // Pre-generate stable random leaf placements so they don't jitter each render
  const leafConfig = useMemo(() => {
    const arr: Array<{
      pos: [number, number, number];
      rot: [number, number, number];
      scale: number;
      shade: number;
    }> = [];
    const count = 22;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
      const radius = 0.04 + Math.random() * 0.08;
      const y = 0.04 + Math.random() * 0.22;
      arr.push({
        pos: [Math.cos(angle) * radius, y, Math.sin(angle) * radius],
        rot: [
          -0.2 - Math.random() * 0.7,
          angle + Math.PI * 0.5,
          (Math.random() - 0.5) * 0.6,
        ],
        scale: 0.7 + Math.random() * 0.55,
        shade: Math.random(),
      });
    }
    return arr;
  }, []);

  useFrame((state) => {
    if (!leavesGroup.current) return;
    leavesGroup.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.4) * 0.014;
    leavesGroup.current.rotation.x = Math.cos(state.clock.elapsedTime * 0.3) * 0.01;
  });

  return (
    <group position={position}>
      {/* terracotta pot — tapered cylinder */}
      <mesh position={[0, 0.07, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.075, 0.052, 0.14, 24]} />
        <meshStandardMaterial color="#8a4a3a" roughness={0.85} />
      </mesh>
      {/* rim */}
      <mesh position={[0, 0.138, 0]} castShadow>
        <cylinderGeometry args={[0.078, 0.074, 0.012, 24]} />
        <meshStandardMaterial color="#723a2c" roughness={0.85} />
      </mesh>
      {/* dirt */}
      <mesh position={[0, 0.142, 0]}>
        <cylinderGeometry args={[0.074, 0.074, 0.004, 24]} />
        <meshStandardMaterial color="#1c100a" roughness={1} />
      </mesh>
      {/* foliage */}
      <group ref={leavesGroup} position={[0, 0.145, 0]}>
        {leafConfig.map((l, i) => (
          <mesh key={i} position={l.pos} rotation={l.rot} castShadow>
            <planeGeometry args={[0.085 * l.scale, 0.13 * l.scale]} />
            <meshStandardMaterial
              map={leafTex}
              alphaMap={leafTex}
              alphaTest={0.5}
              transparent
              color={l.shade > 0.5 ? "#3b5535" : "#4a6740"}
              roughness={0.9}
              side={THREE.DoubleSide}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function makeLeafTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 192;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, c.width, c.height);
  // Draw a leaf shape: oval narrowed at top + bottom
  const cx = c.width / 2;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(cx, 8);
  // right side curve
  ctx.bezierCurveTo(c.width - 8, c.height * 0.18, c.width - 4, c.height * 0.55, cx, c.height - 6);
  // left side curve back
  ctx.bezierCurveTo(8, c.height * 0.55, 8, c.height * 0.18, cx, 8);
  ctx.closePath();
  ctx.fill();
  // central vein (slightly darker so the alphaMap reads gradient)
  const grad = ctx.createLinearGradient(cx, 0, cx, c.height);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.5, "rgba(220,220,220,1)");
  grad.addColorStop(1, "rgba(255,255,255,1)");
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = "source-over";

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// -------------------- Picture Frame --------------------
function PictureFrame({
  position,
  imageUrl,
  hoverNote,
  focused = false,
  onClick,
  small = false,
}: {
  position: [number, number, number];
  imageUrl?: string;
  hoverNote?: HoverNote;
  focused?: boolean;
  onClick?: () => void;
  small?: boolean;
}) {
  const pointerInside = useRef(false);
  const w = small ? 0.18 : 0.28;
  const h = small ? 0.24 : 0.36;
  const tex = usePictureFrameTexture(imageUrl, small, w / h);
  const frameTex = useMemo(() => makeFrameWoodTexture(), []);
  useEffect(() => () => frameTex.dispose(), [frameTex]);
  useEffect(() => {
    if (!pointerInside.current) return;
    setHoveredNote(focused && hoverNote ? hoverNote : null);
  }, [focused, hoverNote]);
  const onPointerOver = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    pointerInside.current = true;
    document.body.style.cursor = focused ? "zoom-out" : "zoom-in";
    if (focused && hoverNote) setHoveredNote(hoverNote);
  };
  const onPointerOut = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    pointerInside.current = false;
    document.body.style.cursor = "auto";
    setHoveredNote(null);
  };
  const onPointerDown = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
  };
  const onClickFrame = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    document.body.style.cursor = focused ? "zoom-in" : "zoom-out";
    setHoveredNote(!focused && hoverNote ? hoverNote : null);
    onClick?.();
  };
  const rail = small ? 0.018 : 0.024;
  const depth = small ? 0.018 : 0.022;
  const matW = w - rail * 1.35;
  const matH = h - rail * 1.35;
  const artW = w * 0.70;
  const artH = h * 0.70;
  const liner = small ? 0.003 : 0.004;
  return (
    <group
      position={position}
      rotation={[0, 0, 0]}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
      onPointerDown={onPointerDown}
      onClick={onClickFrame}
    >
      {/* outer frame — dark walnut */}
      <mesh position={[0, 0, -0.005]} castShadow receiveShadow>
        <boxGeometry args={[w, h, 0.010]} />
        <meshStandardMaterial color="#23140b" roughness={0.62} metalness={0.04} />
      </mesh>
      <mesh position={[0, h / 2 - rail / 2, 0.001]} castShadow receiveShadow>
        <boxGeometry args={[w, rail, depth]} />
        <meshStandardMaterial map={frameTex} color="#6b3f23" roughness={0.42} metalness={0.06} />
      </mesh>
      <mesh position={[0, -h / 2 + rail / 2, 0.001]} castShadow receiveShadow>
        <boxGeometry args={[w, rail, depth]} />
        <meshStandardMaterial map={frameTex} color="#4f2d18" roughness={0.48} metalness={0.05} />
      </mesh>
      <mesh position={[-w / 2 + rail / 2, 0, 0.001]} castShadow receiveShadow>
        <boxGeometry args={[rail, h, depth]} />
        <meshStandardMaterial map={frameTex} color="#5d351d" roughness={0.45} metalness={0.05} />
      </mesh>
      <mesh position={[w / 2 - rail / 2, 0, 0.001]} castShadow receiveShadow>
        <boxGeometry args={[rail, h, depth]} />
        <meshStandardMaterial map={frameTex} color="#6f4124" roughness={0.42} metalness={0.06} />
      </mesh>
      <mesh position={[0, 0, 0.009]}>
        <planeGeometry args={[matW, matH]} />
        <meshStandardMaterial color="#eadcc7" roughness={0.82} />
      </mesh>
      <mesh position={[0, artH / 2 + liner / 2, 0.011]}>
        <boxGeometry args={[artW + liner * 2, liner, 0.004]} />
        <meshStandardMaterial color="#b88752" roughness={0.32} metalness={0.35} />
      </mesh>
      <mesh position={[0, -artH / 2 - liner / 2, 0.011]}>
        <boxGeometry args={[artW + liner * 2, liner, 0.004]} />
        <meshStandardMaterial color="#8f6335" roughness={0.38} metalness={0.28} />
      </mesh>
      <mesh position={[-artW / 2 - liner / 2, 0, 0.011]}>
        <boxGeometry args={[liner, artH + liner * 2, 0.004]} />
        <meshStandardMaterial color="#9f713e" roughness={0.35} metalness={0.32} />
      </mesh>
      <mesh position={[artW / 2 + liner / 2, 0, 0.011]}>
        <boxGeometry args={[liner, artH + liner * 2, 0.004]} />
        <meshStandardMaterial color="#c29558" roughness={0.28} metalness={0.38} />
      </mesh>
      {/* inner artwork — slightly in front */}
      <mesh position={[0, 0, 0.013]}>
        <planeGeometry args={[artW, artH]} />
        <meshStandardMaterial map={tex} roughness={0.58} />
      </mesh>
      <mesh position={[0, 0, 0.0145]}>
        <planeGeometry args={[artW, artH]} />
        <meshStandardMaterial color="#dff3ff" transparent opacity={0.12} roughness={0.12} metalness={0.08} />
      </mesh>
    </group>
  );
}

function makeFrameWoodTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const base = ctx.createLinearGradient(0, 0, c.width, c.height);
  base.addColorStop(0, "#4b2a16");
  base.addColorStop(0.35, "#744626");
  base.addColorStop(0.7, "#2f190c");
  base.addColorStop(1, "#87502b");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < c.height; y += 3) {
    const wave = Math.sin(y * 0.07) * 10 + Math.sin(y * 0.021) * 22;
    ctx.strokeStyle = y % 12 === 0 ? "rgba(25,12,5,0.28)" : "rgba(255,220,160,0.07)";
    ctx.lineWidth = y % 12 === 0 ? 1.4 : 0.7;
    ctx.beginPath();
    ctx.moveTo(0, y + wave * 0.05);
    for (let x = 0; x <= c.width; x += 16) {
      ctx.lineTo(x, y + Math.sin((x + wave) * 0.035) * 2.5);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 22; i++) {
    const x = Math.random() * c.width;
    const y = Math.random() * c.height;
    ctx.fillStyle = "rgba(30,14,6,0.18)";
    ctx.beginPath();
    ctx.ellipse(x, y, 4 + Math.random() * 12, 1 + Math.random() * 3, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.5, 1.5);
  tex.needsUpdate = true;
  return tex;
}

function usePictureFrameTexture(
  imageUrl: string | undefined,
  small: boolean,
  frameAspect: number,
): THREE.Texture {
  const fallbackTex = useMemo(() => makeAbstractArtTexture(small), [small]);
  const [imageTex, setImageTex] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    setImageTex((prev) => {
      prev?.dispose();
      return null;
    });
    if (!imageUrl) return;

    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(
      imageUrl,
      (tex) => {
        if (cancelled) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        const img = tex.image as { width?: number; height?: number };
        const imageAspect = img.width && img.height ? img.width / img.height : frameAspect;
        tex.repeat.set(1, 1);
        tex.offset.set(0, 0);
        if (imageAspect > frameAspect) {
          tex.repeat.x = frameAspect / imageAspect;
          tex.offset.x = (1 - tex.repeat.x) / 2;
        } else if (imageAspect < frameAspect) {
          tex.repeat.y = imageAspect / frameAspect;
          tex.offset.y = (1 - tex.repeat.y) / 2;
        }
        tex.needsUpdate = true;
        setImageTex((prev) => {
          prev?.dispose();
          return tex;
        });
      },
      undefined,
      () => undefined,
    );

    return () => {
      cancelled = true;
    };
  }, [imageUrl, frameAspect]);

  useEffect(() => {
    return () => {
      fallbackTex.dispose();
      setImageTex((prev) => {
        prev?.dispose();
        return null;
      });
    };
  }, [fallbackTex]);

  return imageTex ?? fallbackTex;
}

function makeAbstractArtTexture(small: boolean): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = small ? 256 : 320;
  const ctx = c.getContext("2d")!;
  if (small) {
    // small print — moody mountains, dusk palette
    const sky = ctx.createLinearGradient(0, 0, 0, c.height);
    sky.addColorStop(0, "#6e5440");
    sky.addColorStop(0.6, "#7a4633");
    sky.addColorStop(1, "#3a2218");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, c.width, c.height);
    // mountain silhouettes
    ctx.fillStyle = "#1a1108";
    ctx.beginPath();
    ctx.moveTo(0, c.height * 0.7);
    ctx.lineTo(c.width * 0.3, c.height * 0.45);
    ctx.lineTo(c.width * 0.55, c.height * 0.6);
    ctx.lineTo(c.width * 0.8, c.height * 0.4);
    ctx.lineTo(c.width, c.height * 0.55);
    ctx.lineTo(c.width, c.height);
    ctx.lineTo(0, c.height);
    ctx.closePath();
    ctx.fill();
    // soft sun
    const sun = ctx.createRadialGradient(c.width * 0.7, c.height * 0.3, 0, c.width * 0.7, c.height * 0.3, 60);
    sun.addColorStop(0, "rgba(230, 170, 110, 0.45)");
    sun.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, c.width, c.height);
  } else {
    // large print — abstract color-field, dim version
    const grad = ctx.createLinearGradient(0, 0, 0, c.height);
    grad.addColorStop(0, "#3a4838");
    grad.addColorStop(0.55, "#5a4a3a");
    grad.addColorStop(1, "#5a3a35");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, c.width, c.height);
    // brushy color block
    ctx.fillStyle = "rgba(120, 85, 45, 0.55)";
    ctx.fillRect(c.width * 0.18, c.height * 0.45, c.width * 0.5, c.height * 0.18);
    // accent line
    ctx.strokeStyle = "rgba(20, 16, 10, 0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(c.width * 0.15, c.height * 0.78);
    ctx.lineTo(c.width * 0.85, c.height * 0.72);
    ctx.stroke();
  }
  // grain
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// -------------------- Book Stack --------------------
function BookStack({ position }: { position: [number, number, number] }) {
  const books = useMemo(
    () => [
      { w: 0.14, h: 0.022, d: 0.1, color: "#6b483a", title: "STEINBECK", titleColor: "#e8dfd0" },
      { w: 0.13, h: 0.028, d: 0.095, color: "#92a48a", title: "DIDION", titleColor: "#2d251c" },
      { w: 0.15, h: 0.018, d: 0.105, color: "#c08c83", title: "BALDWIN", titleColor: "#2d251c" },
      { w: 0.12, h: 0.025, d: 0.095, color: "#3a2616", title: "MURAKAMI", titleColor: "#e8dfd0" },
    ],
    [],
  );

  let yOffset = 0.005;

  return (
    <group position={position} rotation={[0, Math.PI / 9, 0]}>
      {books.map((b, i) => {
        const y = yOffset + b.h / 2;
        yOffset += b.h;
        return (
          <group key={i} position={[0, y, 0]}>
            <mesh castShadow receiveShadow>
              <boxGeometry args={[b.w, b.h, b.d]} />
              <meshStandardMaterial color={b.color} roughness={0.7} />
            </mesh>
            {/* book spine title on the +x face — too small to render text but
                a contrasting hairline reads as "this is a book" */}
            <mesh position={[b.w / 2 + 0.0015, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
              <planeGeometry args={[b.d * 0.85, b.h * 0.45]} />
              <meshStandardMaterial color={b.titleColor} roughness={0.9} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

// -------------------- Mug --------------------
function Mug({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* body */}
      <mesh position={[0, 0.04, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.034, 0.028, 0.08, 28]} />
        <meshStandardMaterial color="#e0d2bc" roughness={0.45} metalness={0.05} />
      </mesh>
      {/* coffee inside */}
      <mesh position={[0, 0.08, 0]}>
        <cylinderGeometry args={[0.032, 0.032, 0.001, 24]} />
        <meshStandardMaterial color="#2a1810" roughness={0.2} metalness={0.3} />
      </mesh>
      {/* handle — half-torus standing vertically on the +X side of the body.
          Rotation Z = -PI/2 swings the default arc (which opens toward -Y)
          around so it opens toward -X (the body), giving a proper C-shape.
          Position x is tuned so the top/bottom endpoints of the arc just
          kiss the body surface at this height (radius ≈ 0.031). */}
      <mesh position={[0.035, 0.04, 0]} rotation={[0, 0, -Math.PI / 2]} castShadow>
        <torusGeometry args={[0.018, 0.005, 12, 24, Math.PI]} />
        <meshStandardMaterial color="#e0d2bc" roughness={0.45} />
      </mesh>
    </group>
  );
}
