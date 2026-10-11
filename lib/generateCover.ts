import type { DemoRecord } from "./covers";
import { canvasFonts } from "./canvasFonts";

export function generateCoverCanvas(rec: DemoRecord, size = 1024): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;

  // base background
  ctx.fillStyle = rec.palette.bg;
  ctx.fillRect(0, 0, size, size);

  // soft warm radial highlight upper-left (the imaginary lamp in the room)
  const grad = ctx.createRadialGradient(size * 0.28, size * 0.22, 0, size * 0.28, size * 0.22, size * 0.85);
  grad.addColorStop(0, withAlpha(rec.palette.accent, 0.4));
  grad.addColorStop(0.55, withAlpha(rec.palette.accent, 0.08));
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // big colorblock accent, low-rise rectangle, slightly translucent
  ctx.fillStyle = withAlpha(rec.palette.accent, 0.82);
  const blockH = size * 0.16;
  const blockY = size * 0.66;
  ctx.fillRect(size * 0.07, blockY, size * 0.86, blockH);

  // paper grain
  paperGrain(ctx, size, 0.045);

  // title (serif, book jacket)
  ctx.fillStyle = rec.palette.ink;
  ctx.font = `italic 500 ${Math.round(size * 0.12)}px ${canvasFonts().serif}`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  wrapText(ctx, rec.title, size * 0.08, size * 0.12, size * 0.84, size * 0.14);

  ctx.fillStyle = withAlpha(rec.palette.ink, 0.72);
  {
    const tmpl = `400 %spx ${canvasFonts().sans}`;
    const fit = fitFont(
      ctx,
      letterSpace(rec.artist.toUpperCase(), 4),
      size * 0.84,
      Math.round(size * 0.028),
      tmpl,
      Math.round(size * 0.016),
    );
    ctx.fillText(fit.text, size * 0.08, size * 0.07);
  }

  // corner metadata, inside the accent block
  ctx.fillStyle = withAlpha(rec.palette.bg, 0.92);
  ctx.font = `400 ${Math.round(size * 0.024)}px ${canvasFonts().sans}`;
  ctx.fillText(`${rec.year} · ${rec.label}`, size * 0.08, blockY + blockH * 0.32);
  // country is often empty, so don't render a dangling separator
  const subLine = [rec.country, rec.genre].filter((s) => s && s.trim() !== "").join(" · ");
  if (subLine) {
    ctx.fillText(letterSpace(subLine, 2), size * 0.08, blockY + blockH * 0.62);
  }

  // edge vignette
  const vig = ctx.createRadialGradient(size / 2, size / 2, size * 0.38, size / 2, size / 2, size * 0.82);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, size, size);

  return c;
}

export type BackTrack = { title: string; position?: string; duration?: string };

// falls back to a stable fake tracklist so the back always reads like a sleeve
export function generateBackCanvas(
  rec: DemoRecord,
  size = 1024,
  realTracks?: BackTrack[],
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;

  // base: darker, more "manila paper" version of the bg
  ctx.fillStyle = shade(rec.palette.bg, -0.08);
  ctx.fillRect(0, 0, size, size);

  const grad = ctx.createRadialGradient(size * 0.5, size * 0.5, size * 0.2, size * 0.5, size * 0.5, size * 0.8);
  grad.addColorStop(0, withAlpha(rec.palette.accent, 0.10));
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = withAlpha(rec.palette.ink, 0.85);
  {
    const tmpl = `500 %spx ${canvasFonts().sans}`;
    const fit = fitFont(
      ctx,
      letterSpace(rec.artist.toUpperCase(), 4),
      size * 0.84,
      Math.round(size * 0.028),
      tmpl,
      Math.round(size * 0.014),
    );
    ctx.fillText(fit.text, size * 0.08, size * 0.07);
  }

  ctx.fillStyle = rec.palette.ink;
  {
    const tmpl = `italic 500 %spx ${canvasFonts().serif}`;
    const fit = fitFont(
      ctx,
      rec.title,
      size * 0.84,
      Math.round(size * 0.058),
      tmpl,
      Math.round(size * 0.026),
    );
    ctx.fillText(fit.text, size * 0.08, size * 0.105);
  }

  // a thin rule below the header
  ctx.fillStyle = withAlpha(rec.palette.ink, 0.45);
  ctx.fillRect(size * 0.08, size * 0.205, size * 0.84, size * 0.0035);

  // Tracklist: real tracks from Discogs if provided, else procedural.
  const tracks: BackTrack[] = realTracks && realTracks.length > 0
    ? realTracks
    : (() => {
        const titleHash = hashCode(rec.id + rec.title);
        return makeFakeTracklist(titleHash, 9 + (titleHash % 4))
          .map((t) => ({ title: t }));
      })();

  // one column per side; past 4 sides, compact into 4 even columns
  const hasPositions = tracks.every((t) => t.position && /^[A-Z]/.test(t.position));
  const MAX_COLS = 4;
  let groups: { label: string; tracks: BackTrack[] }[];
  if (hasPositions) {
    // Bucket by leading side letter (A, B, C, ...).
    const buckets = new Map<string, BackTrack[]>();
    for (const t of tracks) {
      const letter = (t.position ?? "").charAt(0).toUpperCase();
      if (!buckets.has(letter)) buckets.set(letter, []);
      buckets.get(letter)!.push(t);
    }
    groups = [...buckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([letter, ts]) => ({ label: `SIDE ${letter}`, tracks: ts }));
  } else {
    const half = Math.ceil(tracks.length / 2);
    groups = [
      { label: "SIDE A", tracks: tracks.slice(0, half) },
      { label: "SIDE B", tracks: tracks.slice(half) },
    ].filter((g) => g.tracks.length > 0);
  }

  if (groups.length > MAX_COLS) {
    const perCol = Math.ceil(tracks.length / MAX_COLS);
    const compacted: { label: string; tracks: BackTrack[] }[] = [];
    for (let i = 0; i < MAX_COLS; i++) {
      const slice = tracks.slice(i * perCol, (i + 1) * perCol);
      if (slice.length === 0) continue;
      const first = (slice[0].position ?? "").charAt(0).toUpperCase();
      const last = (slice[slice.length - 1].position ?? "").charAt(0).toUpperCase();
      compacted.push({
        label: first && last && first !== last ? `${first}\u2013${last}` : first ? `SIDE ${first}` : `${i + 1}`,
        tracks: slice,
      });
    }
    groups = compacted;
  }

  // one row per disc, two sides per row, so sides never share a column
  const nCols = Math.min(2, groups.length);
  const nRows = Math.ceil(groups.length / nCols);

  const grid: ({ label: string; tracks: BackTrack[] } | null)[][] = [];
  for (let r = 0; r < nRows; r++) {
    const row: ({ label: string; tracks: BackTrack[] } | null)[] = [];
    for (let c = 0; c < nCols; c++) {
      const idx = r * nCols + c;
      row.push(idx < groups.length ? groups[idx] : null);
    }
    grid.push(row);
  }

  const bandsTopY = size * 0.245;
  const tracksBottomY = size * 0.83;
  const rowGap = size * 0.035;
  const availBandsH = tracksBottomY - bandsTopY - (nRows - 1) * rowGap;
  const bandH = availBandsH / nRows;

  // Horizontal: even split for two columns, full safe area for one.
  const safeLeft = size * 0.08;
  const safeWidth = size * 0.84;
  const gutterFrac = 0.04;
  const colW =
    nCols > 1 ? (safeWidth - size * gutterFrac) / 2 : safeWidth;
  const colX = (c: number) => safeLeft + c * (colW + size * gutterFrac);

  const sideHeaderPx = Math.max(
    Math.round(size * 0.018),
    Math.min(Math.round(size * 0.022), Math.round(colW * 0.07)),
  );
  const sideHeaderGap = size * 0.025;
  const tracksAvailH = bandH - sideHeaderPx - sideHeaderGap;

  // tighten line spacing for dense sides before shrinking the font
  const maxTracksPerSide = Math.max(1, ...groups.map((g) => g.tracks.length));
  const denseN = Math.max(0, Math.min(1, (maxTracksPerSide - 14) / 14));
  const lineMul = 1.55 - denseN * 0.33;

  // Per-column horizontal geometry.
  const numW = Math.min(colW * 0.22, size * 0.06);
  const titleX = (c: number) => colX(c) + numW;
  const titleMaxWFor = (fontPx: number) => {
    const durW = fontPx * 2.6;
    return colW - numW - fontPx * 0.5 - durW;
  };

  const wrapTitleAt = (title: string, fontPx: number, maxW: number): string[] => {
    ctx.font = `400 ${fontPx}px ${canvasFonts().sans}`;
    if (ctx.measureText(title).width <= maxW) return [title];
    const words = title.split(/\s+/).filter(Boolean);
    if (words.length <= 1) return [title];
    const lines: string[] = [];
    let current = "";
    for (const w of words) {
      const candidate = current ? `${current} ${w}` : w;
      if (ctx.measureText(candidate).width <= maxW) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = w;
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [title];
  };

  const sideLineCountAt = (
    group: { label: string; tracks: BackTrack[] },
    fontPx: number,
    maxW: number,
  ): number => {
    let n = 0;
    for (const t of group.tracks) {
      n += wrapTitleAt(t.title, fontPx, maxW).length;
    }
    return n;
  };

  // largest font where every side still fits its band; line count is monotone in size
  const idealTrackPx = Math.round(size * 0.034);
  const minTrackPx = Math.max(6, Math.round(size * 0.008));
  const fitsAt = (fontPx: number) => {
    const lineH = fontPx * lineMul;
    const linesBudget = Math.floor(tracksAvailH / lineH);
    if (linesBudget <= 0) return false;
    const maxW = titleMaxWFor(fontPx);
    for (const g of groups) {
      if (sideLineCountAt(g, fontPx, maxW) > linesBudget) return false;
    }
    return true;
  };
  let trackPx = minTrackPx;
  {
    let lo = minTrackPx;
    let hi = idealTrackPx;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (fitsAt(mid)) {
        trackPx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
  }
  const lineH = trackPx * lineMul;
  const titleMaxW = titleMaxWFor(trackPx);

  let absIdx = 0;
  for (let r = 0; r < nRows; r++) {
    const bandY = bandsTopY + r * (bandH + rowGap);
    const headerBaseline = bandY + sideHeaderPx;
    const tracksStartY = bandY + sideHeaderPx + sideHeaderGap;
    const bandBottom = bandY + bandH;

    ctx.font = `500 ${sideHeaderPx}px ${canvasFonts().sans}`;
    ctx.fillStyle = withAlpha(rec.palette.ink, 0.6);
    for (let c = 0; c < nCols; c++) {
      const cell = grid[r][c];
      if (!cell) continue;
      ctx.fillText(letterSpace(cell.label, 2), colX(c), headerBaseline);
    }

    for (let c = 0; c < nCols; c++) {
      const cell = grid[r][c];
      if (!cell) continue;
      const x = colX(c);
      let y = tracksStartY;
      ctx.font = `400 ${trackPx}px ${canvasFonts().sans}`;
      for (const t of cell.tracks) {
        const wrapped = wrapTitleAt(t.title, trackPx, titleMaxW);
        // guard for unwrappable titles spilling into the next band
        if (y + wrapped.length * lineH > bandBottom + 1) break;
        // position / fallback running index, drawn on the first wrap line.
        ctx.fillStyle = withAlpha(rec.palette.ink, 0.55);
        const label = t.position ?? String(absIdx + 1).padStart(2, "0");
        ctx.fillText(label, x, y);
        // duration, right-aligned on the first wrap line.
        if (t.duration) {
          ctx.textAlign = "right";
          ctx.fillStyle = withAlpha(rec.palette.ink, 0.5);
          ctx.fillText(t.duration, colX(c) + colW, y);
          ctx.textAlign = "left";
        }
        // title, paints each wrapped line at trackX(c), one lineH apart.
        ctx.fillStyle = rec.palette.ink;
        for (let li = 0; li < wrapped.length; li++) {
          ctx.fillText(wrapped[li], titleX(c), y + li * lineH);
        }
        y += wrapped.length * lineH;
        absIdx++;
      }
    }
  }

  const bottomY = size * 0.86;
  ctx.fillStyle = withAlpha(rec.palette.ink, 0.75);
  {
    const tmpl = `500 %spx ${canvasFonts().sans}`;
    // leave room for the "33⅓ RPM · STEREO" tag on the right
    const maxMetaW = size * 0.5;
    const metaSegments = [
      rec.label.toUpperCase(),
      String(rec.year),
      rec.country ? rec.country.toUpperCase() : "",
      rec.genre.toUpperCase(),
    ].filter((s) => s && s.trim() !== "" && s !== "0");
    const fit = fitFont(
      ctx,
      letterSpace(metaSegments.join(" · "), 2),
      maxMetaW,
      Math.round(size * 0.022),
      tmpl,
      Math.round(size * 0.012),
    );
    ctx.fillText(fit.text, size * 0.08, bottomY);
  }

  // small "STEREO" / runout-groove tag at bottom-right
  ctx.textAlign = "right";
  ctx.fillStyle = withAlpha(rec.palette.ink, 0.45);
  ctx.fillText(letterSpace("33⅓ RPM · STEREO", 2), size * 0.92, bottomY);
  ctx.textAlign = "left";

  // accent stripe at bottom edge for printed feel
  ctx.fillStyle = withAlpha(rec.palette.accent, 0.55);
  ctx.fillRect(0, size * 0.94, size, size * 0.012);

  // light paper grain
  paperGrain(ctx, size, 0.045);

  return c;
}

function makeFakeTracklist(seed: number, count: number): string[] {
  const a = [
    "Halcyon", "Saltwater", "Velvet Hour", "Static", "Margins", "Foxglove",
    "Crystal Set", "Lo-Fi Sundown", "Garden Floor", "Bone China", "Apothecary",
    "Carbon", "First Light", "Aperture", "Soft Detonation", "Idle Hands",
    "Slow Apology", "Reading Lamp", "Cigarette Burns", "Folded Map",
    "Smaller Country", "Telegram", "Drift", "Pier", "Linoleum",
  ];
  const b = [
    " in Blue", " Pt. II", " (Reprise)", "", " for Two", " (Demo)",
    " at Midnight", "", " (Side A)", "", " (Long Mix)", "",
  ];
  let s = Math.abs(seed) || 1;
  const next = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s;
  };
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = a[next() % a.length] + (next() % 3 === 0 ? b[next() % b.length] : "");
    out.push(t);
  }
  return out;
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h;
}

// text is rotated 90 degrees so it reads top to bottom on a standing record
export function generateSpineCanvas(rec: DemoRecord, width = 64, height = 2304): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d")!;

  // base, sampled from the record's bg, slightly desaturated for "in shadow on the shelf" feel
  ctx.fillStyle = shade(rec.palette.bg, -0.04);
  ctx.fillRect(0, 0, width, height);

  // cardboard "valley", long gradient down the spine narrow axis
  const grad = ctx.createLinearGradient(0, 0, width, 0);
  grad.addColorStop(0, "rgba(0,0,0,0.28)");
  grad.addColorStop(0.5, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // accent stripe at top and bottom (typical label spine)
  ctx.fillStyle = rec.palette.accent;
  ctx.fillRect(0, 0, width, height * 0.014);
  ctx.fillRect(0, height * 0.986, width, height * 0.014);

  // Rotate context 90° clockwise so we draw text along the long axis of the spine.
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(Math.PI / 2);

  ctx.fillStyle = rec.palette.ink;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  {
    const tmpl = `italic 500 %spx ${canvasFonts().serif}`;
    const fit = fitFont(
      ctx,
      rec.title,
      height * 0.66,
      Math.round(width * 0.7),
      tmpl,
      Math.round(width * 0.36),
    );
    ctx.fillText(fit.text, -height * 0.06, -width * 0.04);
  }

  // Artist, also auto-shrinks
  ctx.fillStyle = withAlpha(rec.palette.ink, 0.78);
  {
    const tmpl = `500 %spx ${canvasFonts().sans}`;
    const fit = fitFont(
      ctx,
      letterSpace(rec.artist.toUpperCase(), 2),
      height * 0.5,
      Math.round(width * 0.22),
      tmpl,
      Math.round(width * 0.12),
    );
    ctx.fillText(fit.text, height * 0.35, width * 0.3);
  }

  ctx.restore();

  // light paper grain
  paperGrain(ctx, width, 0.035, height);

  return c;
}

// helpers

function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function shade(hex: string, amt: number): string {
  const { r, g, b } = hexToRgb(hex);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + 255 * amt)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

function paperGrain(ctx: CanvasRenderingContext2D, w: number, alpha: number, h?: number) {
  const height = h ?? w;
  const img = ctx.getImageData(0, 0, w, height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 255 * alpha;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
) {
  const words = text.split(" ");
  let line = "";
  let yy = y;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, yy);
      line = w;
      yy += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, yy);
}

function letterSpace(text: string, px: number): string {
  // canvas2d has no native letter-spacing pre Canvas2D L2; emulate with thin spaces
  if (px <= 0) return text;
  const thinSpace = "\u2009";
  return text.split("").join(thinSpace);
}

// Shrink text by stepping font size down until it fits the target width.
function fitToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  let t = text;
  let w = ctx.measureText(t).width;
  if (w <= maxWidth) return t;
  // shrink string while measuring
  while (w > maxWidth && t.length > 3) {
    t = t.slice(0, -1);
    w = ctx.measureText(t + "…").width;
  }
  return t.length < text.length ? t + "…" : t;
}

// shrink the font before resorting to an ellipsis
function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  basePx: number,
  fontTemplate: string,
  minPx = 10,
): { size: number; text: string } {
  let size = basePx;
  while (size > minPx) {
    ctx.font = fontTemplate.replace("%s", String(size));
    if (ctx.measureText(text).width <= maxWidth) {
      return { size, text };
    }
    size -= 1;
  }
  // hit minimum size, truncate with ellipsis
  ctx.font = fontTemplate.replace("%s", String(minPx));
  return { size: minPx, text: fitToWidth(ctx, text, maxWidth) };
}
