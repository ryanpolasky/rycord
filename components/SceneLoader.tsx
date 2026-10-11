"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import MobileGate from "./MobileGate";
import LoadingIntro from "./LoadingIntro";
import type { DemoRecord } from "@/lib/covers";
import type { HoverNote } from "@/lib/hoverStore";
import { loadCanvasFonts } from "@/lib/canvasFonts";

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
  // null until the viewport is known, so neither ui flashes
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
    const search = new URLSearchParams(window.location.search);
    if (search.get("force") === "1") {
      setDecision("scene");
      return;
    }
    const evalGate = () => {
      // 900px lets landscape tablets through
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
    let cancelled = false;
    let rafA = 0;
    let rafB = 0;
    void loadCanvasFonts().then(() => {
      if (cancelled) return;
      rafA = requestAnimationFrame(() => {
        rafB = requestAnimationFrame(() => setSceneMounted(true));
      });
    });

    return () => {
      cancelled = true;
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
