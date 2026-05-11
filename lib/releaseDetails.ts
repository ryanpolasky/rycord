// Client-side loader for /api/release/<id> with module-scope cache + in-flight
// dedupe. Both VinylRecord (for the back-cover tracklist) and InfoPanel (for
// country + future fields) call this, so we only ever do one network round
// trip per record per session.

export type ReleaseTrack = {
  title: string;
  position?: string;
  duration?: string;
};

export type ReleaseDetails = {
  tracks: ReleaseTrack[];
  notes: string;
  country: string;
  year: number;
};

const cache = new Map<string, ReleaseDetails>();
const inflight = new Map<string, Promise<ReleaseDetails>>();

const EMPTY: ReleaseDetails = { tracks: [], notes: "", country: "", year: 0 };

export async function loadReleaseDetails(releaseId: string): Promise<ReleaseDetails> {
  const cached = cache.get(releaseId);
  if (cached) return cached;
  const pending = inflight.get(releaseId);
  if (pending) return pending;

  const p = (async () => {
    try {
      const r = await fetch(`/api/release/${encodeURIComponent(releaseId)}`);
      if (!r.ok) return EMPTY;
      const data = await r.json();
      const tracks: ReleaseTrack[] = (data.tracks ?? [])
        .filter((t: { title?: string }) => t.title)
        .map((t: { title: string; position?: string; duration?: string }) => ({
          title: t.title,
          position: t.position,
          duration: t.duration,
        }));
      const details: ReleaseDetails = {
        tracks,
        notes: (data.notes ?? "") as string,
        country: ((data.country ?? "") as string).trim(),
        year: typeof data.year === "number" && Number.isFinite(data.year) ? data.year : 0,
      };
      cache.set(releaseId, details);
      return details;
    } catch {
      return EMPTY;
    } finally {
      inflight.delete(releaseId);
    }
  })();
  inflight.set(releaseId, p);
  return p;
}
