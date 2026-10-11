// proxied so many viewers share one short-cached upstream hit

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM = "https://status.ryanpolasky.com/api/music";
const REVALIDATE_SECONDS = 10;

export type NowPlaying = {
  isPlaying: boolean;
  title: string;
  artist: string;
  album?: string;
  // load through /api/artwork, the upstream hosts aren't cors-safe
  artworkUrl?: string;
  durationMs?: number;
  updatedAt?: number;
};

const EMPTY: NowPlaying = { isPlaying: false, title: "", artist: "" };

function pickStringField(
  d: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const k of keys) {
    const v = d[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return undefined;
}

function pickNumberField(
  d: Record<string, unknown>,
  keys: readonly string[],
): number | undefined {
  for (const k of keys) {
    const v = d[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
    if (typeof v === "string") {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) return n;
    }
  }
  return undefined;
}

export async function GET() {
  try {
    const res = await fetch(UPSTREAM, {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { "user-agent": "rycord/0.1 +https://rycord.dev" },
    });
    if (!res.ok) {
      return NextResponse.json(EMPTY, {
        headers: { "cache-control": "public, max-age=10" },
      });
    }
    const d = (await res.json()) as Record<string, unknown>;
    const title = pickStringField(d, ["title"]) ?? "";
    const artist = pickStringField(d, ["artist"]) ?? "";
    const album = pickStringField(d, ["album"]);
    // upstream field names have drifted over time
    const artworkUrl = pickStringField(d, [
      "artworkUrl",
      "coverUrl",
      "albumArt",
      "image",
    ]);
    const upstreamDurationMs = pickNumberField(d, ["durationMs", "duration_ms"]);
    const updatedAt = pickNumberField(d, ["updatedAt", "updated_at"]);
    // last.fm has no track length, so assume a pop song or the tonearm never moves
    const FALLBACK_DURATION_MS = 3 * 60 * 1000;
    const isPlaying = Boolean(d.isPlaying);
    const durationMs = upstreamDurationMs ?? (isPlaying ? FALLBACK_DURATION_MS : undefined);

    const payload: NowPlaying = {
      isPlaying,
      title,
      artist,
      ...(album ? { album } : {}),
      ...(artworkUrl ? { artworkUrl } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(updatedAt !== undefined ? { updatedAt } : {}),
    };
    return NextResponse.json(payload, {
      headers: { "cache-control": "public, max-age=10" },
    });
  } catch {
    return NextResponse.json(EMPTY, {
      headers: { "cache-control": "public, max-age=5" },
    });
  }
}
