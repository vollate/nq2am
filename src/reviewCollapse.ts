type CollapsibleReviewResult = {
  status: "not_implemented" | "matched" | "not_found" | "ambiguous";
  selectionSource?: "auto" | "manual";
  candidates?: readonly unknown[];
};

export function collapseReviewOptionsAfterChoice(collapsed: ReadonlySet<number>, idx: number): Set<number> {
  const next = new Set(collapsed);
  next.add(idx);
  return next;
}

export function toggleReviewOptions(collapsed: ReadonlySet<number>, idx: number): Set<number> {
  const next = new Set(collapsed);
  if (next.has(idx)) {
    next.delete(idx);
  } else {
    next.add(idx);
  }
  return next;
}

export function areReviewOptionsCollapsed(
  result: CollapsibleReviewResult,
  idx: number,
  collapsed: ReadonlySet<number>,
  expanded: ReadonlySet<number>
): boolean {
  if (expanded.has(idx)) return false;
  return collapsed.has(idx) || shouldAutoCollapseReviewOptions(result);
}

function shouldAutoCollapseReviewOptions(result: CollapsibleReviewResult): boolean {
  return result.status === "not_found" && result.selectionSource === "manual" && (result.candidates?.length ?? 0) > 0;
}
