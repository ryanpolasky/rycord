// GET /api/release/<releaseId>
//
// Proxies Discogs' /releases/{id} endpoint and returns the bits we need for
// the back cover/info panel. Results are persisted in data/releases/*.json.

import { NextRequest, NextResponse } from "next/server";
import { canonicalReleaseId, fetchReleaseDetails } from "@/lib/discogs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const details = await fetchReleaseDetails(id);
    return NextResponse.json({
      id: details.id,
      title: details.title,
      artists: details.artists,
      year: details.year,
      tracks: details.tracks,
      notes: details.notes,
      country: details.country,
      uri: details.uri,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ id: canonicalReleaseId(id), tracks: [], notes: "", country: "", error: message }, { status: 502 });
  }
}
