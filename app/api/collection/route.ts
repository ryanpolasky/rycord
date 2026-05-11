// GET /api/collection?user=eggyb0i
//
// Fetches a Discogs user's collection, extracts a palette from each cover,
// and returns the merged list. We process palettes in parallel with sharp so
// even a 100+ collection lands in a few seconds.

import { NextRequest, NextResponse } from "next/server";
import { fetchCollectionResult } from "@/lib/discogs";
import { derivePaletteCached } from "@/lib/cachedAssets";
import type { Palette } from "@/lib/palette";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type CollectionItem = {
  id: number;
  artist: string;
  title: string;
  year: number;
  label: string;
  genre: string;
  country: string;
  coverUrl: string; // routed through our own /api/cover proxy
  palette: Palette;
};

export async function GET(req: NextRequest) {
  const user = req.nextUrl.searchParams.get("user") ?? "eggyb0i";
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  try {
    const result = await fetchCollectionResult(user, { refresh });
    const { releases } = result;
    // Derive palettes in parallel, but cap concurrency so we don't hammer
    // discogs CDN. 8-way is comfortable.
    const items: CollectionItem[] = [];
    const concurrency = 8;
    let cursor = 0;
    async function worker() {
      while (true) {
        const i = cursor++;
        if (i >= releases.length) return;
        const r = releases[i];
        const pal = await derivePaletteCached(r.id, r.coverImage);
        items[i] = {
          id: r.id,
          artist: r.artist,
          title: r.title,
          year: r.year,
          label: r.label,
          genre: r.genre,
          country: r.country,
          coverUrl: r.coverImage ? `/api/cover/${r.id}?u=${encodeURIComponent(r.coverImage)}` : "",
          palette: pal,
        };
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    return NextResponse.json({
      user,
      items,
      source: result.source,
      prunedReleaseIds: result.prunedReleaseIds,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ user, items: [], error: message }, { status: 502 });
  }
}
