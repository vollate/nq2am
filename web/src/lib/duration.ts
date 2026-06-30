/** Format a millisecond duration as m:ss, or "—" when unknown. */
export function fmtDuration(ms?: number): string {
  if (!ms) return "—";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Signed second-delta between a candidate and the source, or null if unknown. */
export function fmtDelta(candMs?: number, srcMs?: number): string | null {
  if (!candMs || !srcMs) return null;
  const diff = Math.round((candMs - srcMs) / 1000);
  if (diff === 0) return "exact";
  return `${diff > 0 ? "+" : ""}${diff}s`;
}
