// GET /api/nowplaying
//
// Server-side proxy for https://status.ryanpolasky.com/api/music. We proxy
// instead of letting the browser fetch the upstream directly because
// (a) the upstream is a different origin (CORS risk on future changes), and
// (b) proxying lets us short-cache the response so clicks + polling from
// many simultaneous rycord viewers don't hammer the status API.
//
// Upstream payload (mirrored from ryplay's MusicData shape):
//   { isPlaying, title, artist, album, artworkUrl, trackUrl,
//     updatedAt (unix ms), durationMs }
//
// durationMs + updatedAt let the turntable tonearm walk inward in real time
// based on how much of the track has elapsed, instead of only knowing
// "playing vs not playing".

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
  /** Direct URL to album art on whatever host the upstream uses (Last.fm,
   *  Spotify CDN, iTunes, etc.). The client should not <img src=…> this
   *  directly — pipe it through /api/artwork?url=… so the image is
   *  same-origin and therefore usable as a WebGL texture. */
  artworkUrl?: string;
  /** Total track length in ms. Missing/0 means the tonearm stays parked at
   *  the outer groove instead of walking inward. */
  durationMs?: number;
  /** Unix ms timestamp of when the current scrobble started, per upstream.
   *  The client uses (now - updatedAt) / durationMs as the tonearm
   *  progress so the needle position reflects real elapsed time even for
   *  viewers who just opened the page. */
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
      // Next's built-in fetch cache dedupes + serves stale during the
      // revalidate window, so a burst of clients gets a single upstream
      // hit every ~10s.
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
    // Accept several common field names so we don't depend on a single
    // spelling: upstream may evolve, and ryplay uses `artworkUrl` while
    // the older HTML variants don't reference cover URLs at all.
    const artworkUrl = pickStringField(d, [
      "artworkUrl",
      "coverUrl",
      "albumArt",
      "image",
    ]);
    const upstreamDurationMs = pickNumberField(d, ["durationMs", "duration_ms"]);
    const updatedAt = pickNumberField(d, ["updatedAt", "updated_at"]);
    // The Last.fm upstream doesn't include a real track length, so without
    // a fallback the client keeps the tonearm parked in REST (which both
    // hides the album-art label under the arm and fails to communicate
    // "playing"). Use a sensible pop-song default so the needle walks
    // inward at a believable pace — if/when the upstream starts sending
    // real durations, those win.
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
    // Upstream down, network flake, whatever — return the empty shape so
    // the client renders the "idle" turntable state gracefully.
    return NextResponse.json(EMPTY, {
      headers: { "cache-control": "public, max-age=5" },
    });
  }
}
