"use client";

import { useEffect, useState } from "react";
import type { NowPlaying } from "@/app/api/nowplaying/route";

const EMPTY: NowPlaying = { isPlaying: false, title: "", artist: "" };
const POLL_MS = 15_000;

export function artworkProxyUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  return `/api/artwork?url=${encodeURIComponent(url)}`;
}

export type NowPlayingState = {
  data: NowPlaying;
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
        // keep the last state so a blip doesn't idle the turntable
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
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
