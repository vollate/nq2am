type MatchFilterResult = {
  status: "not_implemented" | "matched" | "not_found" | "ambiguous";
  candidates?: readonly unknown[];
};

export function getReviewIndices(results: readonly MatchFilterResult[]): number[] {
  return results
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.status === "ambiguous" || (r.status === "not_found" && (r.candidates?.length ?? 0) > 0))
    .map(({ i }) => i);
}

export function getNotFoundIndices(results: readonly MatchFilterResult[]): number[] {
  return results
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.status === "not_found")
    .map(({ i }) => i);
}
