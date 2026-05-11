"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { DemoRecord } from "@/lib/covers";
import { loadReleaseDetails, type ReleaseTrack } from "@/lib/releaseDetails";

type Props = {
  rec: DemoRecord | null;
  onClose: () => void;
  onFlipBack: () => void;
};

type Source = "lastfm" | "wikipedia" | "ai" | null;

type DescState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; text: string; source: Source; sourceUrl: string | null }
  | { status: "error" };

const SOURCE_LABEL: Record<Exclude<Source, null>, string> = {
  lastfm: "from Last.fm",
  wikipedia: "from Wikipedia",
  ai: "ai-generated",
};

// Module-scope cache keyed by Discogs id so flipping between records doesn't
// re-hit the API (and so the InfoPanel doesn't flash the loading state every
// re-mount). Server has its own cache too, this is just to dedupe within the
// session.
const clientCache = new Map<string, DescState & { status: "ready" | "error" }>();

export default function InfoPanel({ rec, onClose, onFlipBack }: Props) {
  const [desc, setDesc] = useState<DescState>({ status: "idle" });
  // Country isn't part of basic_information on the Discogs collection
  // endpoint — only on the full /releases/{id}. We fetch it lazily on
  // record-open and overlay it on `rec.country` (which is "" for real
  // Discogs entries and pre-populated for the demo seed records).
  const [country, setCountry] = useState<string>("");
  const [year, setYear] = useState<number>(0);
  const [tracks, setTracks] = useState<ReleaseTrack[]>([]);
  const [tracksLoaded, setTracksLoaded] = useState(false);
  const reqRef = useRef(0);

  useEffect(() => {
    if (!rec) return;
    // Seed with whatever the collection gave us (truthy only for demo seed
    // records — real Discogs collection entries arrive with "").
    setCountry(rec.country ?? "");
    setYear(rec.year ?? 0);
    setTracks([]);
    setTracksLoaded(false);
    // Then upgrade with the canonical country from the full release endpoint
    // when it arrives. Shared cache with VinylRecord so this is a no-op
    // network-wise the second time the user opens the same record.
    let cancelled = false;
    loadReleaseDetails(rec.id).then((details) => {
      if (cancelled) return;
      if (details.country) setCountry(details.country);
      if (details.year > 0) setYear(details.year);
      setTracks(details.tracks);
      setTracksLoaded(true);
    });

    const cached = clientCache.get(rec.id);
    if (cached) {
      setDesc(cached);
      return () => {
        cancelled = true;
      };
    }
    const seq = ++reqRef.current;
    setDesc({ status: "loading" });

    const q = new URLSearchParams({
      artist: rec.artist,
      title: rec.title,
      year: String(rec.year),
      genre: rec.genre,
      label: rec.label,
      country: rec.country,
    });
    fetch(`/api/description/${encodeURIComponent(rec.id)}?${q.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { text: string; source: Source; sourceUrl: string | null }) => {
        if (seq !== reqRef.current) return;
        const next: DescState & { status: "ready" } = {
          status: "ready",
          text: data.text ?? "",
          source: data.source ?? null,
          sourceUrl: data.sourceUrl ?? null,
        };
        clientCache.set(rec.id, next);
        setDesc(next);
      })
      .catch(() => {
        if (seq !== reqRef.current) return;
        const next: DescState & { status: "error" } = { status: "error" };
        clientCache.set(rec.id, next);
        setDesc(next);
      });

    return () => {
      cancelled = true;
    };
  }, [rec]);

  return (
    <AnimatePresence>
      {rec && (
        <motion.aside
          key={rec.id}
          initial={{ x: 80, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 80, opacity: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 26 }}
          className="absolute right-0 top-0 bottom-0 z-20 flex w-[26rem] max-w-[88vw] flex-col gap-6 border-l border-inkSoft/25 bg-paper/[0.97] p-9 shadow-[-24px_0_60px_rgba(45,37,28,0.18)] backdrop-blur-2xl"
        >
          {/* Sticky header: esc button + artist / album title. Stays pinned
              while the metadata, notes, and tracklist scroll up underneath
              it so the album's identity is always visible no matter how
              deep the user scrolls. */}
          <div className="flex shrink-0 flex-col gap-6">
            <div className="flex items-center justify-end font-sans text-[10px] uppercase tracking-[0.32em] text-inkSoft/60">
              <button
                onClick={onClose}
                className="rounded border border-inkSoft/20 px-2 py-1 text-inkSoft/70 transition hover:border-rose hover:text-rose"
              >
                esc
              </button>
            </div>

            <div>
              <div className="font-sans text-[10px] uppercase tracking-[0.32em] text-rose/90">{rec.artist}</div>
              <h1
                className="serif mt-3 font-medium italic leading-[1.05] tracking-tight text-ink"
                style={{
                  // Auto-shrink the title font based on a per-character WEIGHT
                  // (Japanese/Chinese/Hangul full-width chars count as 2). The
                  // weight target is ~14 — past that, font shrinks linearly.
                  // Floors out at 1.05rem so very long titles still fit.
                  fontSize: (() => {
                    const weight = [...rec.title].reduce((acc, c) => {
                      return acc + (/[\u3000-\u9FFF\uFF00-\uFFEF]/.test(c) ? 2 : 1);
                    }, 0);
                    const base = 2.85;
                    const target = 14;
                    const px = Math.max(1.05, base - Math.max(0, weight - target) * 0.085);
                    return `${px}rem`;
                  })(),
                }}
              >
                {rec.title}
              </h1>
            </div>
          </div>

          {/* Scrollable middle: metadata rows + notes + tracklist all share a
              single scrollbar now, so long tracklists are reachable by
              scrolling the whole panel instead of being trapped in a nested
              scroll region. flex-1 + min-h-0 lets this absorb remaining
              vertical space without pushing the sticky pills off-screen.
              data-allow-native-scroll opts this region out of Scene.tsx's
              global wheel hijack (which otherwise preventDefault's every
              wheel tick to drive camera zoom / dolly). */}
          <div
            data-allow-native-scroll
            className="rycord-scroll -mr-2 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pr-2 pb-2"
          >
            {year > 0 && <Row k="Year" v={String(year)} />}
            <Row k="Label" v={rec.label} />
            <Row k="Genre" v={rec.genre} />
            {country.trim() !== "" && <Row k="Country" v={country} />}

            <div className="flex flex-col">
              <div className="flex items-baseline justify-between gap-3">
                <div className="font-sans text-[10px] uppercase tracking-[0.32em] text-inkSoft/65">notes</div>
                {desc.status === "ready" && desc.source && <SourceTag source={desc.source} url={desc.sourceUrl} />}
              </div>
              <DescBody desc={desc} />
              <div className="mt-6 border-t border-inkSoft/15 pt-5">
                <div className="font-sans text-[10px] uppercase tracking-[0.32em] text-inkSoft/65">tracklist</div>
                <TrackBody tracks={tracks} loaded={tracksLoaded} />
              </div>
            </div>
          </div>

          {/* Sticky footer: action pills stay pinned at the bottom so the
              user can flip the record or jump to Discogs from anywhere in
              the scroll. */}
          <div className="flex shrink-0 gap-2 font-sans text-[10px] uppercase tracking-[0.28em] text-inkSoft/75">
            <Pill onClick={onFlipBack}>flip record</Pill>
            <Pill onClick={() => window.open(`https://www.discogs.com/release/${encodeURIComponent(rec.id)}`, "_blank", "noopener,noreferrer")}>
              view on discogs
            </Pill>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function DescBody({ desc }: { desc: DescState }) {
  if (desc.status === "loading" || desc.status === "idle") {
    return (
      <p className="serif mt-3 text-[15px] italic leading-[1.55] text-inkSoft/45">
        looking up notes…
      </p>
    );
  }
  if (desc.status === "error") {
    return (
      <p className="serif mt-3 text-[15px] italic leading-[1.55] text-inkSoft/45">
        couldn't reach the description sources — try again later.
      </p>
    );
  }
  if (!desc.text) {
    return (
      <p className="serif mt-3 text-[15px] italic leading-[1.55] text-inkSoft/45">
        no description available yet for this release.
      </p>
    );
  }
  // Description scrolls inside its own panel region, so we don't truncate
  // here anymore — let the full text flow and the user scroll if needed.
  return (
    <p className="serif mt-3 whitespace-pre-line pb-2 text-[15px] leading-[1.55] text-ink/80">
      {desc.text}
    </p>
  );
}

function TrackBody({ tracks, loaded }: { tracks: ReleaseTrack[]; loaded: boolean }) {
  if (!loaded) {
    return (
      <p className="serif mt-3 text-[15px] italic leading-[1.55] text-inkSoft/45">
        loading tracklist…
      </p>
    );
  }
  if (tracks.length === 0) {
    return (
      <p className="serif mt-3 text-[15px] italic leading-[1.55] text-inkSoft/45">
        no tracklist available for this release.
      </p>
    );
  }
  return (
    <ol className="mt-3 space-y-2 pb-2 font-sans text-[12px] leading-[1.35] text-ink/75">
      {tracks.map((track, i) => (
        <li key={`${track.position ?? i}-${track.title}`} className="grid grid-cols-[2.5rem_1fr_auto] gap-3 border-b border-inkSoft/10 pb-2">
          <span className="text-inkSoft/45">{track.position || String(i + 1)}</span>
          <span>{track.title}</span>
          {track.duration && <span className="text-inkSoft/45">{track.duration}</span>}
        </li>
      ))}
    </ol>
  );
}

function SourceTag({ source, url }: { source: Exclude<Source, null>; url: string | null }) {
  const label = SOURCE_LABEL[source];
  if (!url) {
    return (
      <span className="font-sans text-[9px] uppercase tracking-[0.28em] text-inkSoft/45">
        {label}
      </span>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="font-sans text-[9px] uppercase tracking-[0.28em] text-inkSoft/45 transition hover:text-rose"
    >
      {label} ↗
    </a>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-inkSoft/20 pb-3 font-sans text-[12px]">
      <span className="uppercase tracking-[0.28em] text-inkSoft/70">{k}</span>
      <span className="text-ink">{v}</span>
    </div>
  );
}

function Pill({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-sm border border-inkSoft/20 px-3 py-2 transition hover:border-rose hover:text-rose"
    >
      {children}
    </button>
  );
}
