"use client";

// Polls /api/nowplaying every POLL_MS and returns the current state so the
// Turntable can animate its platter + surface a hover tooltip. The endpoint
// itself is cached server-side (~10s revalidate), so clients polling at the
// same interval won't stampede the upstream status API.

import { useEffect, useState } from "react";
import type { NowPlaying } from "@/app/api/nowplaying/route";

const EMPTY: NowPlaying = { isPlaying: false, title: "", artist: "" };
const POLL_MS = 15_000;

/** Same-origin URL for loading an album-art image through the CORS-safe
 *  proxy. Returns null if there's nothing to load so callers can short-
 *  circuit straight to the idle label. */
export function artworkProxyUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  return `/api/artwork?url=${encodeURIComponent(url)}`;
}

export type NowPlayingState = {
  /** Latest payload from /api/nowplaying. Defaults to an empty-idle shape
   *  so callers never have to null-check. */
  data: NowPlaying;
  /** True after the first successful fetch; lets callers avoid a flash of
   *  "last played" copy before the first poll lands. */
  loaded: boolean;
};

export function useNowPlaying(): NowPlayingState {
  const [state, setState] = useState<NowPlayingState>({
    data: EMPTY,
    loaded: false,
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/nowplaying", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as NowPlaying;
        if (cancelled) return;
        setState({ data, loaded: true });
      } catch {
        // swallow; stay on whatever previous state we had so a transient
        // network blip doesn't collapse the turntable to "idle".
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    // Also refresh whenever the tab comes back into focus so the turntable
    // matches reality quickly after the user tabs back.
    const onVis = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return state;
}
