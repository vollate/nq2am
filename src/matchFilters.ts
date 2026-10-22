type MatchFilterResult = {
  status: "not_implemented" | "matched" | "not_found" | "score_rejected" | "ambiguous" | "request_failed";
  candidates?: readonly unknown[];
};

export type MatchRetryScope = "not_found" | "score_rejected" | "ambiguous" | "request_failed" | "selected" | "all";
export type MatchReviewTab = "all" | "ambiguous" | "score_rejected" | "not_found" | "request_failed" | "matched";

/** Shared quick scopes for ordinary Retry and Agent matching. */
export const MATCH_SCOPES: readonly MatchRetryScope[] = [
  "request_failed",
  "not_found",
  "score_rejected",
  "ambiguous",
  "selected",
  "all"
];

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

export function getScoreRejectedIndices(results: readonly MatchFilterResult[]): number[] {
  return results
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.status === "score_rejected")
    .map(({ i }) => i);
}

export function getRequestFailedIndices(results: readonly MatchFilterResult[]): number[] {
  return results
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.status === "request_failed")
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
  if (scope === "request_failed") {
    return getRequestFailedIndices(results);
  }
  if (scope === "score_rejected") {
    return getScoreRejectedIndices(results);
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

export function retryScopeForTab(tab: MatchReviewTab, currentScope: MatchRetryScope): MatchRetryScope {
  if (tab === "ambiguous" || tab === "score_rejected" || tab === "not_found" || tab === "request_failed") {
    return tab;
  }
  return currentScope;
}
