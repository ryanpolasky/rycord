"use client";

type Props = {
  onContinue: () => void;
};

export default function MobileGate({ onContinue }: Props) {
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
          it&rsquo;s better on a laptop, but you can continue anyway. mobile starts in low quality.
        </p>
        <button
          type="button"
          onClick={onContinue}
          className="mt-8 rounded-full border border-inkSoft/25 bg-ink/90 px-5 py-2.5 font-sans text-[10px] uppercase tracking-[0.28em] text-paper shadow-[0_18px_40px_rgba(45,37,28,0.18)] transition hover:bg-ink hover:shadow-[0_22px_50px_rgba(45,37,28,0.24)]"
        >
          continue anyway
        </button>
      </div>
    </main>
  );
}
