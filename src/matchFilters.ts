type MatchFilterResult = {
  status: "not_implemented" | "matched" | "not_found" | "ambiguous";
  candidates?: readonly unknown[];
};

export type MatchRetryScope = "not_found" | "ambiguous" | "selected" | "all";

export function getAmbiguousIndices(results: readonly MatchFilterResult[]): number[] {
  return results
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.status === "ambiguous")
    .map(({ i }) => i);
}

export function getNotFoundIndices(results: readonly MatchFilterResult[]): number[] {
  return results
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.status === "not_found")
    .map(({ i }) => i);
}

export function getRetryIndices(
  results: readonly MatchFilterResult[],
  scope: MatchRetryScope,
  selectedIndices: readonly number[] = []
): number[] {
  if (scope === "all") {
    return results.map((_, i) => i);
  }
  if (scope === "ambiguous") {
    return getAmbiguousIndices(results);
  }
  if (scope === "selected") {
    const seen = new Set<number>();
    return selectedIndices.filter((idx) => {
      if (!Number.isInteger(idx) || idx < 0 || idx >= results.length) return false;
      if (seen.has(idx)) return false;
      seen.add(idx);
      return true;
    });
  }
  return getNotFoundIndices(results);
}
