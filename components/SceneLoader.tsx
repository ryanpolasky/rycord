"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import MobileGate from "./MobileGate";
import LoadingIntro from "./LoadingIntro";
import type { DemoRecord } from "@/lib/covers";
import type { HoverNote } from "@/lib/hoverStore";

// R3F + three don't SSR. The server component (app/page.tsx) fetches the
// collection from Discogs, then hands it to us; we dynamically import the
// Scene client-only so three.js never touches the server runtime.
const Scene = dynamic(() => import("./Scene"), { ssr: false });

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
      setDecision(narrow || coarse ? "gate" : "scene");
    };
    evalGate();
    window.addEventListener("resize", evalGate);
    return () => window.removeEventListener("resize", evalGate);
  }, []);

  if (decision === null) return <LoadingIntro ready={false} />;
  if (decision === "gate") return <MobileGate />;
  return (
    <>
      <Scene {...props} onReady={() => setSceneReady(true)} />
      <LoadingIntro ready={sceneReady} />
    </>
  );
}
