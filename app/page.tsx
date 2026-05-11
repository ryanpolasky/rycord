import { fetchCollection } from "@/lib/discogs";
import { derivePaletteCached } from "@/lib/cachedAssets";
import type { DemoRecord } from "@/lib/covers";
import SceneLoader from "@/components/SceneLoader";

export const dynamicParams = false;
export const revalidate = false;

const FALLBACK_PALETTE = { bg: "#1a1310", ink: "#ead7b8", accent: "#d2734a" };

async function loadRecords(): Promise<{ records: DemoRecord[]; source: "discogs" | "demo" }> {
  const username = process.env.DISCOGS_USER ?? "eggyb0i";
  try {
    const releases = await fetchCollection(username);
    if (releases.length === 0) {
      return { records: [], source: "discogs" };
    }
    // Derive palettes in parallel, capped at 8-wide.
    const palettes: { bg: string; ink: string; accent: string }[] = new Array(releases.length);
    const concurrency = 8;
    let cursor = 0;
    async function worker() {
      while (true) {
        const i = cursor++;
        if (i >= releases.length) return;
        const r = releases[i];
        palettes[i] = await derivePaletteCached(r.id, r.coverImage);
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    const records: DemoRecord[] = releases.map((r, i) => ({
      id: String(r.id),
      artist: r.artist,
      title: r.title,
      year: r.year,
      label: r.label,
      genre: r.genre,
      country: r.country,
      palette: palettes[i] ?? FALLBACK_PALETTE,
      coverUrl: r.coverImage
        ? `/api/cover/${r.id}?u=${encodeURIComponent(r.coverImage)}`
        : undefined,
    }));
    return { records, source: "discogs" };
  } catch {
    // discogs unreachable / rate-limited — let Scene's default demo set show.
    return { records: [], source: "demo" };
  }
}

export default async function Home() {
  const { records, source } = await loadRecords();
  const username = process.env.DISCOGS_USER ?? "eggyb0i";
  const wallArtUrls = {
    left: "forks.png",
    right: "coco.jpg",
  };
  // Dev-only: setting MULTIPLY_RECORDS=N tiles the loaded collection N times
  // so we can preview what a much larger shelf would look like (e.g. test
  // the multi-row "build around the turntable" layout without needing an
  // actual 250-record discogs account). Each tile gets a fresh id-suffix so
  // React keys stay unique.
  const multiply = parseInt(process.env.MULTIPLY_RECORDS ?? "1", 10);
  const recordsOut = multiply > 1
    ? Array.from({ length: multiply }, (_, k) =>
        records.map((r) => ({ ...r, id: `${r.id}_x${k}` })),
      ).flat()
    : records;
  // When source is "demo" we let Scene use its built-in 15-record set.
  if (source === "demo" || recordsOut.length === 0) {
    return <SceneLoader username="demo" source="demo" wallArtUrls={wallArtUrls} />;
  }
  return <SceneLoader records={recordsOut} username={username} source="discogs" wallArtUrls={wallArtUrls} />;
}
