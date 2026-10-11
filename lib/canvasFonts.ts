const FALLBACK = {
  serif: '"Times New Roman", serif',
  sans: "ui-sans-serif, system-ui, sans-serif",
};

let resolved: typeof FALLBACK | null = null;

// next/font hashes family names, so canvas code has to read them from the css vars
export function canvasFonts(): typeof FALLBACK {
  if (resolved) return resolved;
  if (typeof document === "undefined") return FALLBACK;
  const style = getComputedStyle(document.documentElement);
  const serif = style.getPropertyValue("--font-serif").trim();
  const sans = style.getPropertyValue("--font-sans").trim();
  resolved = {
    serif: serif ? `${serif}, ${FALLBACK.serif}` : FALLBACK.serif,
    sans: sans ? `${sans}, ${FALLBACK.sans}` : FALLBACK.sans,
  };
  return resolved;
}

export async function loadCanvasFonts(timeoutMs = 2500): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  const { serif, sans } = canvasFonts();
  const loads = Promise.all([
    document.fonts.load(`italic 500 32px ${serif}`),
    document.fonts.load(`400 32px ${sans}`),
    document.fonts.load(`500 32px ${sans}`),
  ]).catch(() => undefined);
  await Promise.race([loads, new Promise((r) => setTimeout(r, timeoutMs))]);
}
