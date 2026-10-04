import { useEffect, useRef, useState } from "react";

/**
 * When `affection` moves, flash +N / -N for a second next to the bar.
 * The first value we see is a baseline so loading an existing score doesn't pop.
 */
export default function AffectionDelta({ affection }: { affection: number }) {
  const prev = useRef<number | undefined>(undefined);
  const [pop, setPop] = useState<{ delta: number; key: number } | null>(null);

  useEffect(() => {
    const last = prev.current;
    prev.current = affection;
    if (last === undefined || last === affection) return;
    setPop({ delta: affection - last, key: Date.now() });
  }, [affection]);

  useEffect(() => {
    if (!pop) return;
    const t = window.setTimeout(() => setPop(null), 1000);
    return () => window.clearTimeout(t);
  }, [pop]);

  if (!pop) return null;
  return (
    <span
      key={pop.key}
      className={`affection-delta${pop.delta > 0 ? " up" : " down"}`}
      aria-live="polite"
    >
      {pop.delta > 0 ? `+${pop.delta}` : pop.delta}
    </span>
  );
}
