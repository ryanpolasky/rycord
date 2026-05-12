"use client";

// Full-viewport "rycord is best on desktop" splash. Shown by SceneLoader
// instead of mounting the (heavy, mouse-driven) 3D scene when we detect a
// coarse-pointer device or a narrow viewport. There is no in-UI bypass —
// the scene relies on a precise pointer and is genuinely unusable on
// touch, so we hard-gate mobile rather than offering a "continue anyway"
// path that leads to a broken experience. A hidden ?force=1 URL flag
// (see SceneLoader) remains for QA from a coarse-pointer dev device.

export default function MobileGate() {
  return (
    <main className="fixed inset-0 flex items-center justify-center bg-bg px-6 py-10 text-ink">
      <div className="w-full max-w-md text-center">
        <div className="font-sans text-[10px] uppercase tracking-[0.32em] text-inkSoft/60">
          rycord
        </div>
        <h1 className="serif mt-3 text-4xl font-medium italic leading-tight text-ink">
          my record collection,
          <br />
          in 3d.
        </h1>
        <p className="mt-7 text-sm leading-relaxed text-inkSoft">
          rycord is a small 3d record room. shelves you scan with the scroll
          wheel, a turntable that spins, a remote that runs the led strip. it
          leans on a mouse and a real screen.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-inkSoft/80">
          come back on a laptop. it&rsquo;s worth it.
        </p>
      </div>
    </main>
  );
}
