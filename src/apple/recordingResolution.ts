import type {
  AppleCandidate,
  AppleDecisionDiagnostics,
  AppleMatchResult,
  AppleRecordingGroupEvidence,
  AppleRetrievalDiagnostics,
  MatchPreferences,
  NormalizedTrack
} from "../types.js";
import type { CandidateSimilarity } from "./artwork.js";
import { compareArtistCredits } from "./recordingMetadata.js";
import { roundScore } from "./scoring.js";
import { titleTextSimilarity } from "./titleNormalization.js";
import { compareVersionRelation, versionConflictSummary, versionsCanGroup } from "./versionSemantics.js";

export type CoverSimilarityChooser = (
  track: NormalizedTrack,
  candidates: AppleCandidate[]
) => Promise<CandidateSimilarity | undefined>;

type MutableRecordingGroup = {
  id: string;
  candidates: AppleCandidate[];
  isrc?: string;
  conflicts: string[];
};

function candidateKey(candidate: AppleCandidate): string {
  return `${candidate.storefront ?? ""}:${candidate.id}`;
}

function durationDifference(left: AppleCandidate, right: AppleCandidate): number | undefined {
  if (!left.durationMs || !right.durationMs) return undefined;
  return Math.abs(left.durationMs - right.durationMs);
}

function compatibleVersion(left: AppleCandidate, right: AppleCandidate): boolean {
  const leftEvidence = left.evidence;
  const rightEvidence = right.evidence;
  if (!leftEvidence || !rightEvidence) return false;
  if (!versionsCanGroup(leftEvidence.parsedCandidate, rightEvidence.parsedCandidate)) return false;
  if (
    leftEvidence.parsedCandidate.recordingFacets.join("|") !== rightEvidence.parsedCandidate.recordingFacets.join("|")
  ) {
    return false;
  }
  const relation = compareVersionRelation(leftEvidence.parsedCandidate, rightEvidence.parsedCandidate);
  if (relation === "agree") return true;
  if (relation === "named_omit") return false;
  const difference = durationDifference(left, right);
  return difference !== undefined && difference <= 4_000;
}

function metadataCompatible(left: AppleCandidate, right: AppleCandidate, isrcBacked: boolean): boolean {
  const leftEvidence = left.evidence;
  const rightEvidence = right.evidence;
  if (!leftEvidence || !rightEvidence || !compatibleVersion(left, right)) return false;
  const title = titleTextSimilarity(leftEvidence.parsedCandidate.baseTitle, rightEvidence.parsedCandidate.baseTitle);
  const artist = compareArtistCredits([left.artistName], [right.artistName]);
  const difference = durationDifference(left, right);

  if (isrcBacked) {
    return title >= 0.8 && artist.primaryPair >= 0.65 && (difference === undefined || difference <= 12_000);
  }
  if (left.isrc && right.isrc && left.isrc !== right.isrc) {
    // A recording is commonly re-registered per release, so two releases of one recording often
    // carry different ISRCs. Differing codes therefore only raise the bar for grouping instead of
    // ruling it out, which otherwise leaves duplicate releases competing as rival recordings.
    return (
      title >= 0.98 &&
      artist.primaryPair >= 0.9 &&
      difference !== undefined &&
      difference <= 2_000 &&
      featuredCreditsAgree(leftEvidence, rightEvidence)
    );
  }
  return title >= 0.96 && artist.primaryPair >= 0.82 && difference !== undefined && difference <= 10_000;
}

/** Featured performers only block grouping when both sides name performers and they disagree. */
function featuredCreditsAgree(
  leftEvidence: NonNullable<AppleCandidate["evidence"]>,
  rightEvidence: NonNullable<AppleCandidate["evidence"]>
): boolean {
  const leftNames = leftEvidence.parsedCandidate.featuredArtists;
  const rightNames = rightEvidence.parsedCandidate.featuredArtists;
  if (leftNames.length === 0 && rightNames.length === 0) return true;
  if (leftNames.length === 0 || rightNames.length === 0) {
    return compareVersionRelation(leftEvidence.parsedCandidate, rightEvidence.parsedCandidate) !== "conflict";
  }
  return compareArtistCredits(leftNames, rightNames).hasPrimaryRelationship;
}

function candidatesCanGroup(left: AppleCandidate, right: AppleCandidate): boolean {
  const sharedIsrc = Boolean(left.isrc && right.isrc && left.isrc === right.isrc);
  return metadataCompatible(left, right, sharedIsrc);
}

/** Group release entries into conservative recording identities. */
export function buildRecordingGroups(candidates: readonly AppleCandidate[]): MutableRecordingGroup[] {
  const ordered = [...candidates].sort((left, right) => candidateKey(left).localeCompare(candidateKey(right)));
  const groups: MutableRecordingGroup[] = [];

  for (const candidate of ordered) {
    // Requiring compatibility with every member prevents transitive duration
    // chains from merging endpoints that do not satisfy the grouping rules.
    const group = groups.find((current) => current.candidates.every((other) => candidatesCanGroup(candidate, other)));
    if (group) {
      group.candidates.push(candidate);
    } else {
      groups.push({ id: "", candidates: [candidate], isrc: candidate.isrc, conflicts: [] });
    }
  }

  for (const group of groups) {
    const isrcs = [...new Set(group.candidates.map((candidate) => candidate.isrc).filter(Boolean))];
    group.isrc = isrcs.length === 1 ? isrcs[0] : undefined;
    const stableKey = candidateKey(group.candidates[0]);
    group.id = group.isrc ? `isrc:${group.isrc}:${stableKey}` : `meta:${stableKey}`;
    for (const candidate of group.candidates) candidate.recordingGroupId = group.id;
  }

  for (let left = 0; left < ordered.length; left += 1) {
    for (let right = left + 1; right < ordered.length; right += 1) {
      const a = ordered[left];
      const b = ordered[right];
      if (!a.isrc || a.isrc !== b.isrc || candidatesCanGroup(a, b)) continue;
      const reason = `ISRC ${a.isrc} conflicts with title, artist, version, or duration evidence`;
      for (const group of groups.filter(
        (current) => current.candidates.includes(a) || current.candidates.includes(b)
      )) {
        if (!group.conflicts.includes(reason)) group.conflicts.push(reason);
      }
    }
  }

  return groups.sort((left, right) => left.id.localeCompare(right.id));
}

function explicitRank(candidate: AppleCandidate, prefs: MatchPreferences): number {
  if (prefs.explicitPreference === "explicit") return candidate.contentRating === "explicit" ? 1 : 0;
  if (prefs.explicitPreference === "clean") return candidate.contentRating === "clean" ? 1 : 0;
  return 0;
}

function addabilityRank(candidate: AppleCandidate, accountStorefront: string): number {
  if (candidate.addableId) return 2;
  return candidate.storefront === accountStorefront ? 1 : 0;
}

function rankReleases(
  group: MutableRecordingGroup,
  prefs: MatchPreferences,
  accountStorefront: string
): AppleCandidate[] {
  return [...group.candidates].sort(
    (left, right) =>
      right.score - left.score ||
      addabilityRank(right, accountStorefront) - addabilityRank(left, accountStorefront) ||
      explicitRank(right, prefs) - explicitRank(left, prefs) ||
      candidateKey(left).localeCompare(candidateKey(right))
  );
}

function groupConfidence(group: MutableRecordingGroup): number {
  return Math.max(...group.candidates.map((candidate) => candidate.evidence?.confidence ?? candidate.score));
}

function groupIdentityConfidence(group: MutableRecordingGroup): number {
  return Math.max(...group.candidates.map((candidate) => candidate.evidence?.identityConfidence ?? candidate.score));
}

function strongestCandidate(group: MutableRecordingGroup): AppleCandidate {
  return [...group.candidates].sort(
    (left, right) =>
      (right.evidence?.confidence ?? right.score) - (left.evidence?.confidence ?? left.score) ||
      candidateKey(left).localeCompare(candidateKey(right))
  )[0];
}

/**
 * The plain recording and a labelled variant of it routinely land within a hair of each other,
 * because a duration inside the two-second tolerance scores the same either way and the version
 * weight alone is tiny. When only the runner-up carries a label the source never asked for, that
 * label is itself the separation, so the thin score gap is not genuine ambiguity.
 */
function versionLabelSeparates(
  best: MutableRecordingGroup | undefined,
  runnerUp: MutableRecordingGroup | undefined
): boolean {
  if (!best || !runnerUp) return false;
  const bestEvidence = strongestCandidate(best).evidence;
  const runnerUpEvidence = strongestCandidate(runnerUp).evidence;
  if (!bestEvidence || !runnerUpEvidence) return false;
  return !bestEvidence.unrequestedStructuralVariant && runnerUpEvidence.unrequestedStructuralVariant;
}

function toGroupEvidence(
  group: MutableRecordingGroup,
  selectedRelease: AppleCandidate | undefined
): AppleRecordingGroupEvidence {
  const strongest = strongestCandidate(group);
  const evidence = strongest.evidence;
  return {
    id: group.id,
    candidateIds: group.candidates.map((candidate) => candidate.id),
    isrc: group.isrc,
    confidence: groupConfidence(group),
    identityConfidence: groupIdentityConfidence(group),
    automaticEligible: group.candidates.some((candidate) => candidate.evidence?.automaticEligible ?? true),
    deterministicIdentity: group.candidates.some((candidate) => candidate.evidence?.deterministicIdentity ?? false),
    strongestCandidateId: strongest.id,
    selectedReleaseId: selectedRelease?.id,
    decisiveEvidence: evidence?.decisiveEvidence ?? [],
    conflicts: group.conflicts,
    versionRelation: evidence?.versionRelation,
    versionConflict: evidence ? versionConflictSummary(evidence.parsedSource, evidence.parsedCandidate) : undefined
  };
}

function applyArtworkEvidence(candidate: AppleCandidate, similarity: number): void {
  const evidence = candidate.evidence;
  if (!evidence) return;
  const artworkBonus = roundScore(0.12 * Math.max(0, (similarity - 0.7) / 0.3));
  evidence.artworkBonus = artworkBonus;
  evidence.confidence = roundScore(evidence.identityConfidence + evidence.albumBonus + artworkBonus);
  if (artworkBonus > 0) evidence.decisiveEvidence.push("source artwork agrees decisively");
  candidate.score = evidence.confidence;
  if (candidate.scoreBreakdown) candidate.scoreBreakdown.total = evidence.confidence;
}

function retainedCandidates(
  groups: readonly MutableRecordingGroup[],
  winner?: AppleCandidate,
  limit = 8
): AppleCandidate[] {
  const ranked = groups
    .flatMap((group) => group.candidates)
    .sort((left, right) => right.score - left.score || candidateKey(left).localeCompare(candidateKey(right)));
  const retained = ranked.slice(0, limit);
  if (!winner || retained.includes(winner)) return retained;
  return [...retained.slice(0, limit - 1), winner];
}

function retrievalSummary(retrieval: AppleRetrievalDiagnostics | undefined): string {
  if (!retrieval) return "local candidate set";
  return `${retrieval.queries.length} retrieval pass${retrieval.queries.length === 1 ? "" : "es"}, ${retrieval.uniqueCandidateCount} unique candidate${retrieval.uniqueCandidateCount === 1 ? "" : "s"}`;
}

export async function resolveRecordingDecision(
  track: NormalizedTrack,
  candidates: AppleCandidate[],
  prefs: MatchPreferences,
  accountStorefront: string,
  chooseCover: CoverSimilarityChooser,
  retrieval?: AppleRetrievalDiagnostics
): Promise<AppleMatchResult> {
  if (candidates.length === 0) {
    return {
      track,
      status: "not_found",
      candidates: [],
      scoringVersion: prefs.scoringVersion,
      retrieval,
      reason: "No candidates were available for recording resolution"
    };
  }

  let groups = buildRecordingGroups(candidates);
  const plausibleFloor = Math.max(0.5, prefs.reviewThreshold - 0.1);
  const plausibleCandidates = groups
    .filter(
      (group) =>
        groupConfidence(group) >= plausibleFloor &&
        group.candidates.some((candidate) => candidate.evidence?.automaticEligible ?? false)
    )
    .flatMap((group) => group.candidates);

  // Artwork is positive-only. Compare it only among plausible competing
  // recordings or release alternatives and leave metadata untouched on failure.
  if (plausibleCandidates.length >= 2 && track.albumCoverUrl) {
    const artworkChoice = await chooseCover(track, plausibleCandidates).catch(() => undefined);
    if (artworkChoice) applyArtworkEvidence(artworkChoice.candidate, artworkChoice.similarity);
  }

  groups = groups.sort(
    (left, right) => groupConfidence(right) - groupConfidence(left) || left.id.localeCompare(right.id)
  );
  const best = groups[0];
  const rivalGroups = groups.filter((group) =>
    group.candidates.some((candidate) => candidate.evidence?.automaticEligible ?? false)
  );
  const runnerUp = rivalGroups.find((group) => group !== best);
  const bestConfidence = best ? groupConfidence(best) : undefined;
  const runnerUpConfidence = runnerUp ? groupConfidence(runnerUp) : undefined;
  const margin = bestConfidence === undefined ? undefined : roundScore(bestConfidence - (runnerUpConfidence ?? 0));
  const rankedReleases = best ? rankReleases(best, prefs, accountStorefront) : [];
  const winner = rankedReleases[0];
  const bestAutomaticEligible =
    best?.candidates.some((candidate) => candidate.evidence?.automaticEligible ?? true) ?? false;
  const deterministic =
    best?.candidates.some((candidate) => candidate.evidence?.deterministicIdentity ?? false) ?? false;
  const labelSeparatesRunnerUp = versionLabelSeparates(best, runnerUp);
  const decisiveEvidence = best ? [...(strongestCandidate(best).evidence?.decisiveEvidence ?? [])] : [];
  if (labelSeparatesRunnerUp) {
    decisiveEvidence.push("runner-up advertises a version the source did not ask for");
  }
  const decision: AppleDecisionDiagnostics = {
    scoringVersion: prefs.scoringVersion,
    bestGroupConfidence: bestConfidence,
    runnerUpGroupConfidence: runnerUpConfidence,
    margin,
    automaticThreshold: prefs.threshold,
    reviewThreshold: prefs.reviewThreshold,
    requiredMargin: prefs.ambiguousGap,
    decisiveEvidence
  };

  const groupEvidence = groups.map((group) => toGroupEvidence(group, group === best ? winner : undefined));
  const common = {
    track,
    scoringVersion: prefs.scoringVersion,
    retrieval,
    recordingGroups: groupEvidence,
    decision
  };

  const passes = retrievalSummary(retrieval);
  const meetsMargin = margin !== undefined && (margin >= prefs.ambiguousGap || labelSeparatesRunnerUp);
  const automatic =
    winner &&
    bestAutomaticEligible &&
    (((bestConfidence ?? 0) >= prefs.threshold && meetsMargin) || (deterministic && !runnerUp));

  if (automatic) {
    return {
      ...common,
      status: "matched",
      candidates: retainedCandidates(groups, winner),
      selectedId: winner.id,
      selectionSource: "auto",
      appleMusicId: winner.addableId ?? winner.id,
      appleMusicUrl: winner.url,
      reason: `Scoring v${prefs.scoringVersion}: recording group ${bestConfidence?.toFixed(2)} vs ${runnerUpConfidence?.toFixed(2) ?? "none"}; margin ${margin?.toFixed(2)} / required ${prefs.ambiguousGap.toFixed(2)} after ${passes}. Selected release ${winner.id}${winner.evidence?.artworkBonus ? " by album cover similarity" : winner.evidence?.albumBonus ? ` by album match (album similarity ${winner.evidence.albumSimilarity.toFixed(2)})` : ""}${best.candidates.length > 1 ? " among equivalent duplicate releases" : ""}. Evidence: ${decisiveEvidence.join("; ") || "weighted metadata agreement"}`
    };
  }

  if ((bestConfidence ?? 0) >= prefs.reviewThreshold) {
    decision.rejectionCause = !bestAutomaticEligible
      ? "no related primary artist"
      : (bestConfidence ?? 0) < prefs.threshold
        ? "best group is below the automatic threshold"
        : "recording-group margin is too small";
    return {
      ...common,
      status: "ambiguous",
      candidates: retainedCandidates(groups),
      reason: `Scoring v${prefs.scoringVersion}: review required; best recording group ${bestConfidence?.toFixed(2)} vs ${runnerUpConfidence?.toFixed(2) ?? "none"}, margin ${margin?.toFixed(2)} / required ${prefs.ambiguousGap.toFixed(2)} after ${passes}; ${decision.rejectionCause}`
    };
  }

  const strongest = strongestCandidate(best);
  const causes = strongest.evidence?.incompatibilities ?? [];
  decision.rejectionCause = causes[0] ?? "best recording group is below the review threshold";
  return {
    ...common,
    status: "score_rejected",
    candidates: retainedCandidates(groups),
    reason: `Scoring v${prefs.scoringVersion}: best recording group ${bestConfidence?.toFixed(2)} below review threshold ${prefs.reviewThreshold.toFixed(2)} after ${passes}; ${decision.rejectionCause}`
  };
}
