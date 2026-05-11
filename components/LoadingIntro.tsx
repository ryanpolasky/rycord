"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

export default function LoadingIntro({ ready }: { ready: boolean }) {
  // Animated ellipsis: 1 dot → 2 dots → 3 dots → loop. Only ticks while the
  // loading screen is up; the effect tears the interval down once `ready`
  // flips so we don't leave a setInterval running after exit.
  const [dotCount, setDotCount] = useState(1);
  useEffect(() => {
    if (ready) return;
    const id = setInterval(() => {
      setDotCount((d) => (d % 3) + 1);
    }, 450);
    return () => clearInterval(id);
  }, [ready]);

  return (
    <AnimatePresence>
      {!ready && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-[#21170f] text-[#f0e7d6]"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(184,135,82,0.24),transparent_34%),linear-gradient(135deg,rgba(192,140,131,0.18),transparent_45%),linear-gradient(180deg,#2d2118_0%,#18110c_100%)]" />
          <div className="relative flex flex-col items-center gap-8">
            <div className="relative h-40 w-40">
              <motion.div
                className="absolute inset-0 rounded-full border border-[#b88752]/25 bg-[#120d09]/70 shadow-[0_0_70px_rgba(184,135,82,0.25)]"
                animate={{ rotate: 360 }}
                transition={{ duration: 4.8, ease: "linear", repeat: Infinity }}
              />
              <motion.div
                className="absolute inset-4 rounded-full border-[10px] border-[#2a1f15] bg-[conic-gradient(from_15deg,#d2734a,#b88752,#92a48a,#c08c83,#d2734a)] shadow-inner"
                animate={{ rotate: -360 }}
                transition={{ duration: 2.8, ease: "linear", repeat: Infinity }}
              />
              <div className="absolute inset-[3.4rem] rounded-full border border-[#f0e7d6]/45 bg-[#21170f] shadow-[inset_0_0_18px_rgba(0,0,0,0.7)]" />
              <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#0e0a07] shadow-[0_0_6px_rgba(0,0,0,0.6)]" />
            </div>

            <div className="text-center">
              <motion.div
                className="serif text-5xl italic tracking-tight"
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              >
                rycord
              </motion.div>
              <motion.div
                className="mt-3 font-sans text-[10px] uppercase tracking-[0.45em] text-[#d4c9b6]/70"
                initial={{ y: 8, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.12, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              >
                warming the room
                {/* Inline-block + fixed width + text-left reserves enough
                    horizontal space for "..." so the centered headline doesn't
                    visually jitter as the dot count changes. */}
                <span
                  aria-hidden
                  className="inline-block w-[2.4em] text-left align-baseline"
                >
                  {".".repeat(dotCount)}
                </span>
              </motion.div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
