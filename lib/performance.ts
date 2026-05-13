"use client";

import { useEffect, useState } from "react";

export type PerformanceTier = "low" | "medium" | "high";
export type PerformanceMode = "auto" | PerformanceTier;

function isPerformanceTier(value: string | null): value is PerformanceTier {
  return value === "low" || value === "medium" || value === "high";
}

function detectDeviceDefaultTier(): PerformanceTier {
  if (typeof window === "undefined") return "high";

  const width = window.innerWidth;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const hoverNone = window.matchMedia("(hover: none)").matches;
  const ua = navigator.userAgent.toLowerCase();
  const touchPoints = navigator.maxTouchPoints ?? 0;
  const phone = /iphone|ipod|android.*mobile|windows phone/.test(ua);
  const tablet = /ipad|tablet|android(?!.*mobile)/.test(ua) || (/macintosh/.test(ua) && touchPoints > 1);

  if (phone || (coarse && hoverNone && width < 768)) return "low";
  if (tablet || (coarse && hoverNone)) return "medium";
  return "high";
}

function readUrlMode(): PerformanceMode {
  if (typeof window === "undefined") return "auto";

  const search = new URLSearchParams(window.location.search);
  const override = search.get("quality");
  if (isPerformanceTier(override)) return override;
  return "auto";
}

function resolvePerformanceTier(mode: PerformanceMode): PerformanceTier {
  if (mode !== "auto") return mode;
  return detectDeviceDefaultTier();
}

function writeUrlMode(mode: PerformanceMode) {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  if (mode === "auto") url.searchParams.delete("quality");
  else url.searchParams.set("quality", mode);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export function usePerformanceTier(): {
  tier: PerformanceTier;
  mode: PerformanceMode;
  setMode: (mode: PerformanceMode) => void;
} {
  const [mode, setModeState] = useState<PerformanceMode>(() => readUrlMode());
  const [tier, setTier] = useState<PerformanceTier>(() => resolvePerformanceTier(readUrlMode()));

  useEffect(() => {
    const current = readUrlMode();
    setModeState(current);
    setTier(resolvePerformanceTier(current));
  }, []);

  const setMode = (next: PerformanceMode) => {
    setModeState(next);
    setTier(resolvePerformanceTier(next));
    writeUrlMode(next);
  };

  return { tier, mode, setMode };
}

export function tierDpr(tier: PerformanceTier): [number, number] {
  if (tier === "high") return [1, 1.5];
  if (tier === "medium") return [0.9, 1.2];
  return [0.75, 1];
}
