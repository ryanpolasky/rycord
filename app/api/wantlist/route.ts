import { NextRequest, NextResponse } from "next/server";
import { fetchWantlistResult } from "@/lib/discogs";
import { derivePaletteCached } from "@/lib/cachedAssets";
import type { Palette } from "@/lib/palette";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type WantlistItem = {
  id: number;
  artist: string;
  title: string;
  year: number;
  label: string;
  genre: string;
  country: string;
  coverUrl: string;
  palette: Palette;
};

export async function GET(req: NextRequest) {
  const user = req.nextUrl.searchParams.get("user") ?? "eggyb0i";
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  try {
    const result = await fetchWantlistResult(user, { refresh });
    const { releases } = result;
    const items: WantlistItem[] = [];
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
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ user, items: [], error: message }, { status: 502 });
  }
}
