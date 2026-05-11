"use client";

// Full-viewport "rycord is best on desktop" splash. Shown by SceneLoader
// instead of mounting the (heavy, mouse-driven) 3D scene when we detect a
// coarse-pointer device or a narrow viewport. There's a ?force=1 escape
// hatch so QA + stubborn users can punch through.

export default function MobileGate() {
  const onForce = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const url = new URL(window.location.href);
    url.searchParams.set("force", "1");
    window.location.replace(url.toString());
  };

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
        <a
          href="?force=1"
          onClick={onForce}
          className="mt-8 inline-block font-sans text-[10px] uppercase tracking-[0.32em] text-inkSoft/50 underline-offset-4 hover:text-ink hover:underline"
        >
          view anyway &rarr;
        </a>
      </div>
    </main>
  );
}
