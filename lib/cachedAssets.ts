import "server-only";
import { paletteFromImage, type Palette } from "@/lib/palette";
import { deleteCache, readBinaryCache, readJsonCache, safeCacheKey, writeBinaryCache, writeJsonCache } from "@/lib/dataCache";

const USER_AGENT = "rycord/0.1 +https://rycord.com";
const PALETTE_FALLBACK: Palette = { bg: "#1a1310", ink: "#ead7b8", accent: "#d2734a" };

type CoverMeta = {
  id: string;
  sourceUrl: string;
  contentType: string;
  file: string;
  fetchedAt: string;
};

export type CachedCover = {
  buf: Buffer;
  contentType: string;
};

export async function readCachedCover(id: string): Promise<CachedCover | null> {
  const cacheId = safeCacheKey(id);
  const meta = await readJsonCache<CoverMeta>("covers", `${cacheId}.json`);
  if (!meta) return null;
  const buf = await readBinaryCache("covers", meta.file);
  if (!buf) return null;
  return { buf, contentType: meta.contentType || "image/jpeg" };
}

export async function fetchCoverCached(id: string, sourceUrl: string): Promise<CachedCover | null> {
  const cacheId = safeCacheKey(id);
  const cached = await readCachedCover(cacheId);
  if (cached) return cached;
  if (!sourceUrl) return null;

  const r = await fetch(sourceUrl, {
    headers: { "User-Agent": USER_AGENT },
    cache: "no-store",
  });
  if (!r.ok) return null;

  const buf = Buffer.from(await r.arrayBuffer());
  const contentType = r.headers.get("Content-Type") ?? "image/jpeg";
  const file = `${cacheId}.${extensionForContentType(contentType)}`;
  const meta: CoverMeta = {
    id: cacheId,
    sourceUrl,
    contentType,
    file,
    fetchedAt: new Date().toISOString(),
  };

  await writeBinaryCache(buf, "covers", file);
  await writeJsonCache(meta, "covers", `${cacheId}.json`);
  return { buf, contentType };
}

export async function derivePaletteCached(id: string | number, coverImage: string): Promise<Palette> {
  const cacheId = safeCacheKey(id);
  const cached = await readJsonCache<Palette>("palettes", `${cacheId}.json`);
  if (cached) return cached;

  if (!coverImage) {
    await writeJsonCache(PALETTE_FALLBACK, "palettes", `${cacheId}.json`);
    return PALETTE_FALLBACK;
  }

  try {
    const cover = await fetchCoverCached(cacheId, coverImage);
    if (!cover) throw new Error("cover fetch failed");
    const palette = await paletteFromImage(cover.buf);
    await writeJsonCache(palette, "palettes", `${cacheId}.json`);
    return palette;
  } catch {
    await writeJsonCache(PALETTE_FALLBACK, "palettes", `${cacheId}.json`);
    return PALETTE_FALLBACK;
  }
}

export async function deleteCachedAssets(id: string | number): Promise<void> {
  const cacheId = safeCacheKey(id);
  const meta = await readJsonCache<CoverMeta>("covers", `${cacheId}.json`);
  const coverFiles = new Set([
    meta?.file,
    `${cacheId}.jpg`,
    `${cacheId}.png`,
    `${cacheId}.webp`,
    `${cacheId}.gif`,
  ].filter((file): file is string => Boolean(file)));
  await Promise.all([
    ...[...coverFiles].map((file) => deleteCache("covers", file)),
    deleteCache("covers", `${cacheId}.json`),
    deleteCache("palettes", `${cacheId}.json`),
  ]);
}

function extensionForContentType(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  return "jpg";
}
