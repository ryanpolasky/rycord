// GET /api/cover/<releaseId>?u=<absolute-discogs-cdn-url>
//
// Proxies a discogs CDN image so the browser sees it as same-origin (we need
// canvas getImageData to work on the cover when we draw it into our procedural
// jacket — discogs CDN omits CORS headers). Caches binary in data/covers.

import { NextRequest, NextResponse } from "next/server";
import { fetchCoverCached } from "@/lib/cachedAssets";
import { canonicalReleaseId } from "@/lib/discogs";
import { coverOverrideFor } from "@/lib/coverOverrides";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const releaseId = canonicalReleaseId(id);
  const overrideUrl = await coverOverrideFor(releaseId);
  const u = overrideUrl ?? req.nextUrl.searchParams.get("u");
  if (!u) {
    return NextResponse.json({ error: "missing u" }, { status: 400 });
  }

  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return NextResponse.json({ error: "host not allowed" }, { status: 400 });
    }
    if (!overrideUrl && !parsed.hostname.endsWith("discogs.com")) {
      return NextResponse.json({ error: "host not allowed" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "bad url" }, { status: 400 });
  }

  try {
    const cover = await fetchCoverCached(releaseId, u);
    if (!cover) return NextResponse.json({ error: "cover unavailable" }, { status: 502 });
    return new NextResponse(new Uint8Array(cover.buf), {
      headers: {
        "Content-Type": cover.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
