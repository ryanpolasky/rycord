"use client";

import { useHoverState } from "@/lib/hoverStore";

// Floating label that follows the cursor. Two inputs feed this:
//   - a hovered record spine (shows artist / title / year)
//   - a free-text hover note (used by the turntable for "ryan is listening
//     to ..." — eyebrow / main / sub)
// Records take priority when both are set so we never collapse a spine
// hover into a turntable tooltip mid-flight. Rendered as a DOM overlay
// (not in-canvas) so the text is crisp regardless of camera distance.
export default function HoverTooltip() {
  const { record, note, x, y } = useHoverState();
  if (!record && !note) return null;
  return (
    <div
      className="pointer-events-none fixed z-30"
      style={{
        left: x + 14,
        top: y + 18,
      }}
    >
      <div className="rounded-md border border-ink/15 bg-bg/90 px-3 py-1.5 shadow-lg backdrop-blur-sm">
        {record ? (
          <>
            <div className="font-sans text-[10px] uppercase tracking-[0.22em] text-inkSoft/60">
              {record.artist}
            </div>
            <div className="serif text-sm italic leading-tight text-ink">
              {record.title}
            </div>
            {record.year ? (
              <div className="font-sans text-[9px] uppercase tracking-[0.22em] text-inkSoft/45">
                {record.year}
              </div>
            ) : null}
          </>
        ) : note ? (
          <>
            <div className="font-sans text-[10px] uppercase tracking-[0.22em] text-inkSoft/60">
              {note.eyebrow}
            </div>
            <div className="serif text-sm italic leading-tight text-ink">
              {note.main}
            </div>
            {note.sub ? (
              <div className="font-sans text-[9px] uppercase tracking-[0.22em] text-inkSoft/45">
                {note.sub}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
