"use client";

import { useLayoutEffect, useRef } from "react";
import { subscribeHoverPos, useHoverState } from "@/lib/hoverStore";

const OFFSET_X = 14;
const OFFSET_Y = 18;
const EDGE = 12;

// records win over notes so a spine hover never collapses into the turntable tooltip
export default function HoverTooltip() {
  const { record, note } = useHoverState();
  const ref = useRef<HTMLDivElement>(null);
  const visible = Boolean(record || note);

  useLayoutEffect(() => {
    if (!visible) return;
    return subscribeHoverPos((x, y) => {
      const el = ref.current;
      if (!el) return;
      const { offsetWidth: w, offsetHeight: h } = el;
      const left = x + OFFSET_X + w > window.innerWidth - EDGE ? x - OFFSET_X - w : x + OFFSET_X;
      const top = y + OFFSET_Y + h > window.innerHeight - EDGE ? y - OFFSET_Y - h : y + OFFSET_Y;
      el.style.transform = `translate3d(${Math.max(EDGE, left)}px, ${Math.max(EDGE, top)}px, 0)`;
    });
  }, [visible, record, note]);

  if (!visible) return null;
  const eyebrow = record ? record.artist : note!.eyebrow;
  const main = record ? record.title : note!.main;
  const sub = record ? (record.year ? String(record.year) : "") : note!.sub;

  return (
    <div ref={ref} className="pointer-events-none fixed left-0 top-0 z-30 will-change-transform">
      <div className="rycord-tip max-w-[22rem] rounded-md border border-ink/15 bg-bg/90 px-3 py-1.5 shadow-lg backdrop-blur-sm">
        <div className="font-sans text-[10px] uppercase tracking-[0.22em] text-inkSoft/60">{eyebrow}</div>
        <div className="serif text-sm italic leading-tight text-ink">{main}</div>
        {sub ? (
          <div className="font-sans text-[9px] uppercase tracking-[0.22em] text-inkSoft/45">{sub}</div>
        ) : null}
      </div>
    </div>
  );
}
