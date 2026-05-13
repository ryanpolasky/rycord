"use client";

export default function LoadingIntro({ ready }: { ready: boolean }) {
  return (
    <div
      aria-hidden={ready}
      className={[
        "fixed inset-0 z-50 flex transform-gpu items-center justify-center overflow-hidden bg-[#21170f] text-[#f0e7d6] transition-opacity duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-opacity",
        ready ? "pointer-events-none opacity-0" : "opacity-100",
      ].join(" ")}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(184,135,82,0.24),transparent_34%),linear-gradient(135deg,rgba(192,140,131,0.18),transparent_45%),linear-gradient(180deg,#2d2118_0%,#18110c_100%)]" />
      <div className="relative flex flex-col items-center gap-8">
        <div className="relative h-40 w-40">
          <div className="absolute inset-0 animate-spin rounded-full border border-[#b88752]/25 bg-[#120d09]/70 shadow-[0_0_70px_rgba(184,135,82,0.25)] [animation-duration:4.8s] [animation-timing-function:linear] transform-gpu will-change-transform" />
          <div className="absolute inset-4 animate-spin rounded-full border-[10px] border-[#2a1f15] bg-[conic-gradient(from_15deg,#d2734a,#b88752,#92a48a,#c08c83,#d2734a)] shadow-inner [animation-direction:reverse] [animation-duration:2.8s] [animation-timing-function:linear] transform-gpu will-change-transform" />
          <div className="absolute inset-[3.4rem] rounded-full border border-[#f0e7d6]/45 bg-[#21170f] shadow-[inset_0_0_18px_rgba(0,0,0,0.7)]" />
          <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#0e0a07] shadow-[0_0_6px_rgba(0,0,0,0.6)]" />
        </div>

        <div className="text-center">
          <div className="serif text-5xl italic tracking-tight">
            rycord
          </div>
          <div className="mt-3 font-sans text-[10px] uppercase tracking-[0.45em] text-[#d4c9b6]/70">
            warming the room
            <span
              aria-hidden
              className="inline-flex w-[2.4em] justify-start gap-[0.1em] text-left align-baseline"
            >
              <span className="rycord-loader-dot rycord-loader-dot-1">.</span>
              <span className="rycord-loader-dot rycord-loader-dot-2">.</span>
              <span className="rycord-loader-dot rycord-loader-dot-3">.</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
