"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import MobileGate from "./MobileGate";
import LoadingIntro from "./LoadingIntro";
import type { DemoRecord } from "@/lib/covers";
import type { HoverNote } from "@/lib/hoverStore";

// R3F + three don't SSR. The server component (app/page.tsx) fetches the
// collection from Discogs, then hands it to us; we dynamically import the
// Scene client-only so three.js never touches the server runtime.
const Scene = dynamic(() => import("./Scene"), { ssr: false });

type WantlistStatus = "idle" | "loading" | "ready" | "error";

type WantlistResponse = {
  items?: Array<{
    id: number;
    artist: string;
    title: string;
    year: number;
    label: string;
    genre: string;
    country: string;
    coverUrl: string;
    palette: DemoRecord["palette"];
  }>;
  error?: string;
};

type Props = {
  records?: DemoRecord[];
  username: string;
  source: "discogs" | "demo";
  wallArtUrls?: {
    left?: string;
    right?: string;
  };
  wallArtNotes?: {
    left?: HoverNote;
    right?: HoverNote;
  };
};

export default function SceneLoader(props: Props) {
  // null while we figure out if this is a desktop or a mobile viewport —
  // avoids a flash of the wrong UI before useEffect can read the viewport.
  // SSR also renders null here (matching the initial client render), so
  // there's no hydration mismatch.
  const [decision, setDecision] = useState<"gate" | "scene" | null>(null);
  const [sceneReady, setSceneReady] = useState(false);
  const [sceneMounted, setSceneMounted] = useState(false);
  const [mobileBypass, setMobileBypass] = useState(false);
  const [wantlistStatus, setWantlistStatus] = useState<WantlistStatus>("idle");
  const [wantlistRecords, setWantlistRecords] = useState<DemoRecord[]>([]);

  const loadWantlist = useCallback(async () => {
    if (props.source !== "discogs" || wantlistStatus === "loading" || wantlistStatus === "ready") return;
    setWantlistStatus("loading");
    try {
      const res = await fetch(`/api/wantlist?user=${encodeURIComponent(props.username)}`, { cache: "no-store" });
      const data = (await res.json()) as WantlistResponse;
      if (!res.ok) throw new Error(data.error ?? "wantlist unavailable");
      const nextRecords: DemoRecord[] = (data.items ?? []).map((item) => ({
        id: String(item.id),
        artist: item.artist,
        title: item.title,
        year: item.year,
        label: item.label,
        genre: item.genre,
        country: item.country,
        palette: item.palette,
        coverUrl: item.coverUrl || undefined,
      }));
      setWantlistRecords(nextRecords);
      setWantlistStatus("ready");
    } catch {
      setWantlistRecords([]);
      setWantlistStatus("error");
    }
  }, [props.source, props.username, wantlistStatus]);

  useEffect(() => {
    // ?force=1 escape hatch — punches through the gate. Useful for QA from
    // desktop ("does the gate look right?") and for the stubborn mobile
    // user who really wants to try anyway.
    const search = new URLSearchParams(window.location.search);
    if (search.get("force") === "1") {
      setDecision("scene");
      return;
    }
    const evalGate = () => {
      // 900px ≈ smaller than an iPad in landscape, so landscape tablets
      // still get the Scene; phones + portrait tablets hit the gate.
      // Coarse pointer covers any touch-primary device regardless of size.
      const narrow = window.innerWidth < 900;
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      setDecision(!mobileBypass && (narrow || coarse) ? "gate" : "scene");
    };
    evalGate();
    window.addEventListener("resize", evalGate);
    return () => window.removeEventListener("resize", evalGate);
  }, [mobileBypass]);

  useEffect(() => {
    if (decision !== "scene") {
      setSceneReady(false);
      setSceneMounted(false);
      return;
    }

    setSceneReady(false);
    setSceneMounted(false);
    let rafA = 0;
    let rafB = 0;
    rafA = requestAnimationFrame(() => {
      rafB = requestAnimationFrame(() => setSceneMounted(true));
    });

    return () => {
      cancelAnimationFrame(rafA);
      cancelAnimationFrame(rafB);
    };
  }, [decision]);

  if (decision === null) return <LoadingIntro ready={false} />;
  if (decision === "gate") return <MobileGate onContinue={() => setMobileBypass(true)} />;
  return (
    <>
      {sceneMounted && (
        <Scene
          {...props}
          wantlistRecords={wantlistRecords}
          wantlistStatus={wantlistStatus}
          onWantlistRequest={loadWantlist}
          onReady={() => setSceneReady(true)}
        />
      )}
      <LoadingIntro ready={sceneMounted && sceneReady} />
    </>
  );
}
