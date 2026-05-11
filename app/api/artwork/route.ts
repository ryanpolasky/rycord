// GET /api/artwork?url=<encoded absolute URL>
//
// Same-origin image proxy so we can load album art from CORS-unfriendly
// hosts (Last.fm / Spotify / iTunes) as a WebGL texture. Without this the
// browser blocks the image from being uploaded to a texture even if we set
// crossOrigin="anonymous" on the <img>.
//
// A hostname allowlist keeps this from being used as an open image proxy —
// only a small set of known music-art CDNs is permitted.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Only proxy images coming from one of these hosts. New upstream hosts can
// be added here when we add new music sources.
const ALLOWED_HOSTS = new Set<string>([
  // Last.fm image CDN
  "lastfm.freetls.fastly.net",
  "lastfm-img2.akamaized.net",
  // Spotify album art CDN
  "i.scdn.co",
  // iTunes / Apple Music artwork
  "is1-ssl.mzstatic.com",
  "is2-ssl.mzstatic.com",
  "is3-ssl.mzstatic.com",
  "is4-ssl.mzstatic.com",
  "is5-ssl.mzstatic.com",
  // Discogs (we already know/use this one for record covers)
  "i.discogs.com",
  "img.discogs.com",
]);

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "missing url" }, { status: 400 });
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "bad url" }, { status: 400 });
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return NextResponse.json({ error: "bad protocol" }, { status: 400 });
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return NextResponse.json(
      { error: `host not allowed: ${parsed.hostname}` },
      { status: 400 },
    );
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      // Album art URLs are effectively immutable (content-addressed by the
      // upstreams we allow), so we cache them aggressively at the Next
      // layer too.
      next: { revalidate: 60 * 60 * 24 },
      headers: { "user-agent": "rycord/0.1 +https://rycord.dev" },
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `upstream ${upstream.status}` },
        { status: 502 },
      );
    }
    const contentType =
      upstream.headers.get("content-type") ?? "image/jpeg";
    const buf = await upstream.arrayBuffer();
    return new NextResponse(buf, {
      headers: {
        "content-type": contentType,
        // Serve directly from the Next cache + long browser cache; the
        // URL is content-addressed so it's safe to treat as immutable.
        "cache-control":
          "public, max-age=86400, s-maxage=86400, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  }
}
