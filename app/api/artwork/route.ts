// same-origin proxy so cors-unfriendly album art can be used as a webgl texture

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// allowlist so this can't be used as an open image proxy
const ALLOWED_HOSTS = new Set<string>([
  // Last.fm image CDN
  "lastfm.freetls.fastly.net",
  "lastfm-img.freetls.fastly.net",
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
      // art urls are content-addressed, so cache hard
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
        "cache-control":
          "public, max-age=86400, s-maxage=86400, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  }
}
