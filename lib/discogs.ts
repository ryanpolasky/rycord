// Server-side Discogs API client.
//
// Discogs' public API returns a user's collection at /users/{username}/collection/folders/0/releases.
// Folder 0 is the special "All" folder that includes every release in the collection.
// Unauthenticated requests are rate-limited to 60/min — fine for a single user fetching
// their own collection, though we persist results to disk to avoid repeat hits.
//
// No auth token is currently required — eggyb0i's collection is public. If we want to
// support private collections later, plug a personal access token into DISCOGS_TOKEN
// and we send it via the Authorization header.

import "server-only";
import { deleteCache, readJsonCache, safeCacheKey, writeJsonCache } from "@/lib/dataCache";
import { deleteCachedAssets } from "@/lib/cachedAssets";

const USER_AGENT = "rycord/0.1 +https://rycord.com";
const DISCOGS_BASE = "https://api.discogs.com";
const PER_PAGE = 100;

export type DiscogsRelease = {
  id: number;
  instanceId: number;
  artist: string;
  title: string;
  year: number;
  label: string;
  genre: string;
  country: string;
  coverImage: string; // full URL on i.discogs.com
  thumbImage: string; // smaller URL
  formats: RawFormat[];
};

export type ReleaseTrack = {
  position: string;
  title: string;
  duration: string;
};

export type ReleaseDetails = {
  id: string;
  title: string;
  artists: string[];
  year: number;
  tracks: ReleaseTrack[];
  notes: string;
  country: string;
  uri: string;
  images: unknown[];
  raw: unknown;
  fetchedAt: string;
};

type CollectionCacheFile = {
  user: string;
  fetchedAt: string;
  releases: DiscogsRelease[];
  rawReleases: unknown[];
};

export type FetchCollectionOptions = {
  refresh?: boolean;
};

export type FetchCollectionResult = {
  releases: DiscogsRelease[];
  source: "cache" | "discogs";
  prunedReleaseIds: string[];
};

type RawFormat = {
  name?: string;
  qty?: string;
  descriptions?: string[];
  text?: string;
};

type RawCollectionRelease = {
  id?: number;
  instance_id?: number;
  basic_information?: {
    title?: string;
    year?: number;
    cover_image?: string;
    thumb?: string;
    artists?: { name?: string }[];
    labels?: { name?: string }[];
    genres?: string[];
    country?: string;
    formats?: RawFormat[];
  };
};

type RawTrack = {
  position?: string;
  title?: string;
  duration?: string;
  type_?: string;
};

type RawFullRelease = {
  title?: string;
  year?: number;
  released?: string;
  released_formatted?: string;
  artists?: { name?: string }[];
  tracklist?: RawTrack[];
  notes?: string;
  country?: string;
  uri?: string;
  images?: unknown[];
};

type CachedReleaseDetails = Omit<ReleaseDetails, "year"> & {
  year?: number;
};

export async function fetchCollection(username: string, options: FetchCollectionOptions = {}): Promise<DiscogsRelease[]> {
  const result = await fetchCollectionResult(username, options);
  return result.releases;
}

export async function fetchCollectionResult(username: string, options: FetchCollectionOptions = {}): Promise<FetchCollectionResult> {
  const cacheKey = safeCacheKey(username);
  const cached = await readJsonCache<CollectionCacheFile>("collections", `${cacheKey}.json`);
  if (!options.refresh && cached?.releases && Array.isArray(cached.releases)) {
    return { releases: cached.releases, source: "cache", prunedReleaseIds: [] };
  }

  const headers: HeadersInit = { "User-Agent": USER_AGENT };
  const token = process.env.DISCOGS_TOKEN;
  if (token) headers["Authorization"] = `Discogs token=${token}`;

  // First page tells us how many pages total.
  const firstUrl = `${DISCOGS_BASE}/users/${encodeURIComponent(username)}/collection/folders/0/releases?per_page=${PER_PAGE}&page=1`;
  const firstRes = await fetch(firstUrl, { headers, cache: "no-store" });
  if (!firstRes.ok) {
    throw new Error(`Discogs ${firstRes.status}: ${await firstRes.text().catch(() => "")}`);
  }
  const firstData = await firstRes.json();
  const totalPages: number = firstData.pagination?.pages ?? 1;

  // Fetch remaining pages in parallel.
  const restPromises: Promise<Response>[] = [];
  for (let p = 2; p <= totalPages; p++) {
    const url = `${DISCOGS_BASE}/users/${encodeURIComponent(username)}/collection/folders/0/releases?per_page=${PER_PAGE}&page=${p}`;
    restPromises.push(fetch(url, { headers, cache: "no-store" }));
  }
  const restRes = await Promise.all(restPromises);
  const restData = await Promise.all(
    restRes.map((r) =>
      r.ok ? r.json() : Promise.resolve({ releases: [] as unknown[] }),
    ),
  );

  const allRaw: RawCollectionRelease[] = [firstData.releases ?? [], ...restData.map((d) => d.releases ?? [])].flat();

  if (process.env.DISCOGS_DEBUG_FORMATS === "1") {
    const fmtHist = new Map<string, number>();
    const descHist = new Map<string, number>();
    const samples: unknown[] = [];
    for (const r of allRaw) {
      const fmts = r.basic_information?.formats ?? [];
      const first = fmts[0];
      const name = first?.name ?? "<none>";
      fmtHist.set(name, (fmtHist.get(name) ?? 0) + 1);
      for (const d of first?.descriptions ?? []) {
        descHist.set(d, (descHist.get(d) ?? 0) + 1);
      }
      if (samples.length < 8 && fmts.length > 0) samples.push(fmts);
    }
    const sortHist = (m: Map<string, number>) =>
      Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
    console.log(`[rycord/debug] formats inspection for "${username}" (${allRaw.length} releases)`);
    console.log("[rycord/debug]  format-name histogram:", sortHist(fmtHist));
    console.log("[rycord/debug]  description histogram:", sortHist(descHist));
    console.log("[rycord/debug]  sample raw formats:", JSON.stringify(samples, null, 2));
  }

  const normalized: DiscogsRelease[] = allRaw
    .map((r): DiscogsRelease | null => {
      const bi = r.basic_information;
      if (!bi || !r.id) return null;
      const artist = (bi.artists ?? []).map((a) => a.name ?? "").filter(Boolean).join(", ") || "Various";
      const label = (bi.labels ?? []).map((l) => l.name ?? "").filter(Boolean)[0] ?? "";
      const genre = (bi.genres ?? [])[0] ?? "";
      return {
        id: r.id,
        instanceId: r.instance_id ?? r.id,
        artist: cleanArtist(artist),
        title: bi.title ?? "Untitled",
        year: bi.year ?? 0,
        label,
        genre,
        country: bi.country ?? "",
        coverImage: bi.cover_image ?? "",
        thumbImage: bi.thumb ?? "",
        formats: bi.formats ?? [],
      };
    })
    .filter((r): r is DiscogsRelease => r !== null);

  // Discogs returns releases in `added_at desc` order by default. Sort
  // client-side so the shelf reads alphabetically by artist → album. The
  // collator handles unicode + Japanese romaji + case-insensitivity sanely;
  // strip leading "The " / "A " / "An " from the sort key so e.g. "The
  // Beatles" files under B not T (record-store convention).
  const collator = new Intl.Collator("en", { sensitivity: "base", ignorePunctuation: true });
  normalized.sort((a, b) => {
    const aArtist = sortKey(a.artist);
    const bArtist = sortKey(b.artist);
    const byArtist = collator.compare(aArtist, bArtist);
    if (byArtist !== 0) return byArtist;
    return collator.compare(sortKey(a.title), sortKey(b.title));
  });

  await writeJsonCache({
    user: username,
    fetchedAt: new Date().toISOString(),
    releases: normalized,
    rawReleases: allRaw,
  } satisfies CollectionCacheFile, "collections", `${cacheKey}.json`);

  const prunedReleaseIds = options.refresh && cached?.releases
    ? await pruneRemovedReleaseCaches(cached.releases, normalized)
    : [];

  return { releases: normalized, source: "discogs", prunedReleaseIds };
}

export async function fetchReleaseDetails(id: string): Promise<ReleaseDetails> {
  const releaseId = canonicalReleaseId(id);
  const cacheKey = safeCacheKey(releaseId);
  const cached = await readJsonCache<CachedReleaseDetails>("releases", `${cacheKey}.json`);
  if (cached?.tracks && Array.isArray(cached.tracks)) {
    const details = { ...cached, year: validYear(cached.year) || yearFromRawRelease(cached.raw) };
    if (details.year !== cached.year) {
      await writeJsonCache(details, "releases", `${cacheKey}.json`);
    }
    return details;
  }

  const headers: HeadersInit = { "User-Agent": USER_AGENT };
  const token = process.env.DISCOGS_TOKEN;
  if (token) headers["Authorization"] = `Discogs token=${token}`;

  const r = await fetch(`${DISCOGS_BASE}/releases/${encodeURIComponent(releaseId)}`, {
    headers,
    cache: "no-store",
  });
  if (!r.ok) {
    throw new Error(`Discogs ${r.status}: ${await r.text().catch(() => "")}`);
  }

  const data: RawFullRelease = await r.json();
  const artists = (data.artists ?? []).map((a) => cleanArtist(a.name ?? "")).filter(Boolean);
  const details: ReleaseDetails = {
    id: releaseId,
    title: data.title ?? "",
    artists,
    year: validYear(data.year) || yearFromReleasedDate(data.released) || yearFromReleasedDate(data.released_formatted),
    tracks: (data.tracklist ?? [])
      .filter((t) => (t.type_ ?? "track") === "track")
      .map((t) => ({
        position: t.position ?? "",
        title: t.title ?? "",
        duration: t.duration ?? "",
      })),
    notes: data.notes ?? "",
    country: (data.country ?? "").trim(),
    uri: data.uri ?? "",
    images: data.images ?? [],
    raw: data,
    fetchedAt: new Date().toISOString(),
  };

  await writeJsonCache(details, "releases", `${cacheKey}.json`);
  return details;
}

export function canonicalReleaseId(id: string): string {
  return id.replace(/_x\d+$/i, "");
}

function validYear(year: unknown): number {
  return typeof year === "number" && Number.isFinite(year) && year > 0 ? year : 0;
}

function yearFromReleasedDate(value: unknown): number {
  if (typeof value !== "string") return 0;
  const match = value.match(/\b(?:18|19|20)\d{2}\b/);
  return match ? Number(match[0]) : 0;
}

function yearFromRawRelease(raw: unknown): number {
  if (!raw || typeof raw !== "object") return 0;
  const data = raw as RawFullRelease;
  return validYear(data.year) || yearFromReleasedDate(data.released) || yearFromReleasedDate(data.released_formatted);
}

async function pruneRemovedReleaseCaches(previous: DiscogsRelease[], next: DiscogsRelease[]): Promise<string[]> {
  const nextIds = new Set(next.map((release) => String(release.id)));
  const removedIds = previous
    .map((release) => String(release.id))
    .filter((id) => !nextIds.has(id));

  await Promise.all(removedIds.map(async (id) => {
    const cacheId = safeCacheKey(id);
    await Promise.all([
      deleteCache("releases", `${cacheId}.json`),
      deleteCache("descriptions", `${cacheId}.json`),
      deleteCachedAssets(cacheId),
    ]);
  }));

  return removedIds;
}

// Discogs sometimes appends "(2)" / "(3)" to artist names for disambiguation
// across artists who share a name (e.g. "Joji (2)"). For display we strip it.
function cleanArtist(name: string): string {
  return name.replace(/\s+\(\d+\)$/g, "").trim();
}

// Sort key: lowercase + strip leading article ("The ", "A ", "An ") so
// "The Beatles" files under "Beatles", and "A Tribe Called Quest" files
// under "Tribe". Mirrors physical record store convention.
function sortKey(s: string): string {
  return s.toLowerCase().replace(/^(the|a|an)\s+/, "").trim();
}
