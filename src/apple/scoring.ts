import type { AppleCandidateEvidence, AppleScoreBreakdown, MatchPreferences, NormalizedTrack } from "../types.js";
import type { AppleSong } from "./api.js";
import {
  compareArtistCredits,
  normalizeRecordingText,
  parseRecordingMetadata,
  recordingTextSimilarity,
  roundEvidence
} from "./recordingMetadata.js";
import { stripAlbumAnnotations, titleTextSimilarity } from "./titleNormalization.js";
import {
  candidateCarriesUnrequestedNamedVersion,
  compareVersionRelation,
  NAMED_VERSION_CONFLICT_CAP,
  versionConflictSummary
} from "./versionSemantics.js";

type ScoreField = keyof AppleScoreBreakdown["fields"];

const IDENTITY_WEIGHTS: AppleScoreBreakdown["weights"] = {
  title: 0.5,
  artist: 0.3,
  album: 0,
  duration: 0.12,
  version: 0.08
};

export function normalizeText(value: string): string {
  return normalizeRecordingText(value);
}

export function compactText(value: string): string {
  return parseRecordingMetadata(value).baseTitle.replace(/[^\p{L}\p{N}]/gu, "");
}

function albumComparableText(value: string): string {
  return normalizeRecordingText(stripAlbumAnnotations(value))
    .replace(/\s*[-–—:]\s*(?:single|ep)\s*$/iu, "")
    .replace(/\s*[([{]\s*(?:deluxe|special|expanded|limited)(?:\s+edition)?\s*[)\]}]\s*$/iu, "")
    .trim();
}

export function compactAlbumText(value: string): string {
  return albumComparableText(value).replace(/[^\p{L}\p{N}]/gu, "");
}

export function textSimilarity(left: string | undefined, right: string | undefined): number {
  if (!left || !right) return 0;
  return recordingTextSimilarity(left, right);
}

export function albumSimilarity(sourceAlbum: string | undefined, candidateAlbum: string | undefined): number {
  if (!sourceAlbum || !candidateAlbum) return 0;
  return recordingTextSimilarity(albumComparableText(sourceAlbum), albumComparableText(candidateAlbum));
}

export function durationSimilarity(sourceMs: number | undefined, candidateMs: number | undefined): number {
  if (!sourceMs || !candidateMs) return 0;
  const diffSeconds = Math.abs(sourceMs - candidateMs) / 1_000;
  if (diffSeconds <= 2) return 1;
  return roundEvidence(Math.max(0, 1 - (diffSeconds - 2) / 28));
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function versionEvidence(
  sourceTitle: string,
  candidateTitle: string,
  sourceDurationMs: number | undefined,
  candidateDurationMs: number | undefined,
  enforceVersions: boolean
): {
  score: number;
  incompatibilities: string[];
  decisiveEvidence: string[];
  unrequestedVariant: boolean;
  relation: ReturnType<typeof compareVersionRelation>;
} {
  const source = parseRecordingMetadata(sourceTitle);
  const candidate = parseRecordingMetadata(candidateTitle);
  const unrequestedVariant = candidateCarriesUnrequestedNamedVersion(source, candidate);
  if (!enforceVersions) {
    return { score: 1, incompatibilities: [], decisiveEvidence: [], unrequestedVariant, relation: "agree" };
  }
  const incompatibilities: string[] = [];
  const decisiveEvidence: string[] = [];
  const relation = compareVersionRelation(source, candidate);

  if (!sameSet(source.recordingFacets, candidate.recordingFacets)) {
    incompatibilities.push(
      `recording version differs (${source.recordingFacets.join(", ") || "original"} vs ${candidate.recordingFacets.join(", ") || "original"})`
    );
    return { score: 0, incompatibilities, decisiveEvidence, unrequestedVariant, relation: "conflict" };
  }
  if (source.recordingFacets.length > 0)
    decisiveEvidence.push(`requested ${source.recordingFacets.join(", ")} version agrees`);

  if (relation === "conflict") {
    const summary = versionConflictSummary(source, candidate);
    incompatibilities.push(
      summary ? `named version differs (${summary.source} vs ${summary.candidate})` : "named version differs"
    );
    return { score: 0, incompatibilities, decisiveEvidence, unrequestedVariant, relation };
  }

  if (relation === "agree") {
    return { score: 1, incompatibilities, decisiveEvidence, unrequestedVariant, relation };
  }

  if (relation === "named_omit") {
    decisiveEvidence.push("named version label is present on only one title");
    return { score: 0.92, incompatibilities, decisiveEvidence, unrequestedVariant, relation };
  }

  if (sourceDurationMs && candidateDurationMs) {
    const difference = Math.abs(sourceDurationMs - candidateDurationMs);
    if (difference <= 4_000) {
      decisiveEvidence.push("structural title suffix differs but duration agrees");
      return { score: 0.92, incompatibilities, decisiveEvidence, unrequestedVariant, relation };
    }
    if (difference > 15_000) {
      incompatibilities.push("structural version and duration disagree");
      return { score: 0.15, incompatibilities, decisiveEvidence, unrequestedVariant, relation };
    }
    return { score: 0.55, incompatibilities, decisiveEvidence, unrequestedVariant, relation };
  }

  return { score: 0.7, incompatibilities, decisiveEvidence, unrequestedVariant, relation };
}

function activeIdentityWeights(hasDuration: boolean): AppleScoreBreakdown["weights"] {
  const active: Record<ScoreField, boolean> = {
    title: true,
    artist: true,
    album: false,
    duration: hasDuration,
    version: true
  };
  const total = (Object.keys(IDENTITY_WEIGHTS) as ScoreField[])
    .filter((field) => active[field])
    .reduce((sum, field) => sum + IDENTITY_WEIGHTS[field], 0);
  const weights = { title: 0, artist: 0, album: 0, duration: 0, version: 0 };
  for (const field of Object.keys(IDENTITY_WEIGHTS) as ScoreField[]) {
    weights[field] = active[field] ? roundScore(IDENTITY_WEIGHTS[field] / total) : 0;
  }
  return weights;
}

export function scoreAppleRecordingEvidence(
  track: NormalizedTrack,
  song: AppleSong,
  prefs: MatchPreferences
): AppleCandidateEvidence {
  const parsedSource = parseRecordingMetadata(track.originalName);
  const parsedCandidate = parseRecordingMetadata(song.attributes.name);
  const sourceArtists = [...track.artists, ...parsedSource.featuredArtists];
  const candidateArtists = [song.attributes.artistName, ...parsedCandidate.featuredArtists];
  const artist = compareArtistCredits(sourceArtists, candidateArtists);
  const artistScore = roundEvidence(
    artist.primaryPair * 0.65 + artist.candidateCoverage * 0.25 + artist.sourceCoverage * 0.1
  );
  const baseTitleSimilarity = titleTextSimilarity(parsedSource.baseTitle, parsedCandidate.baseTitle);
  const fullTitleSimilarity = titleTextSimilarity(track.originalName, song.attributes.name);
  const titleSimilarity = roundEvidence(Math.max(baseTitleSimilarity, fullTitleSimilarity * 0.94));
  const duration = prefs.preferDurationMatch
    ? durationSimilarity(track.durationMs, song.attributes.durationInMillis)
    : 0;
  const version = versionEvidence(
    track.originalName,
    song.attributes.name,
    track.durationMs,
    song.attributes.durationInMillis,
    prefs.preferOriginalVersion
  );
  const album = albumSimilarity(track.albumName, song.attributes.albumName);
  const weights = activeIdentityWeights(
    Boolean(prefs.preferDurationMatch && track.durationMs && song.attributes.durationInMillis)
  );

  // Reserve part of the calibrated confidence range for positive release
  // evidence. This prevents a metadata-identical wrong release from saturating
  // at 1.0 before album/artwork evidence is considered.
  let identityConfidence = roundScore(
    0.88 *
      (titleSimilarity * weights.title +
        artistScore * weights.artist +
        duration * weights.duration +
        version.score * weights.version)
  );
  const incompatibilities = [...version.incompatibilities];
  if (titleSimilarity < 0.42) incompatibilities.push("base title has insufficient similarity");
  const namedConflict =
    version.relation === "conflict" &&
    version.incompatibilities.some((reason) => reason.startsWith("named version differs"));
  if (!artist.hasPrimaryRelationship) {
    // A title-only result may still be shown for review, but can never become
    // an automatic match and is capped below the default review boundary.
    identityConfidence = Math.min(identityConfidence, 0.6);
  }
  if (version.incompatibilities.some((reason) => reason.startsWith("recording version differs"))) {
    identityConfidence = Math.min(identityConfidence, 0.35);
  }
  if (namedConflict) identityConfidence = Math.min(identityConfidence, NAMED_VERSION_CONFLICT_CAP);
  if (version.incompatibilities.includes("structural version and duration disagree")) {
    identityConfidence = Math.min(identityConfidence, 0.48);
  }
  if (titleSimilarity < 0.42) identityConfidence = Math.min(identityConfidence, 0.45);

  const albumBonus = album >= 0.82 ? roundScore(((album - 0.82) / 0.18) * 0.12) : 0;
  const confidence = roundScore(identityConfidence + albumBonus);
  const versionAllowsDeterministic = version.relation === "agree" || version.relation === "structural_omit";
  const deterministicIdentity =
    baseTitleSimilarity === 1 &&
    artist.primaryPair >= 0.98 &&
    version.score >= 0.92 &&
    versionAllowsDeterministic &&
    Boolean(track.durationMs && song.attributes.durationInMillis) &&
    duration >= 0.96 &&
    incompatibilities.length === 0;
  const automaticEligible =
    artist.hasPrimaryRelationship &&
    incompatibilities.length === 0 &&
    version.relation !== "named_omit" &&
    version.relation !== "conflict";
  const decisiveEvidence = [...version.decisiveEvidence];
  if (baseTitleSimilarity === 1) decisiveEvidence.push("base title agrees exactly");
  if (artist.primaryPair >= 0.98) decisiveEvidence.push("primary artist agrees");
  if (duration >= 0.96) decisiveEvidence.push("duration agrees");
  if (albumBonus > 0) decisiveEvidence.push("source album agrees");
  decisiveEvidence.push(...artist.aliases.map((alias) => `approved artist alias ${alias}`));

  return {
    parsedSource,
    parsedCandidate,
    baseTitleSimilarity,
    titleSimilarity,
    artist,
    durationSimilarity: duration,
    versionCompatibility: version.score,
    versionRelation: version.relation,
    unrequestedStructuralVariant: version.unrequestedVariant,
    albumSimilarity: album,
    albumBonus,
    artworkBonus: 0,
    identityConfidence: roundScore(identityConfidence),
    confidence,
    automaticEligible,
    deterministicIdentity,
    incompatibilities,
    decisiveEvidence
  };
}

export function scoreAppleSong(track: NormalizedTrack, song: AppleSong, prefs: MatchPreferences): AppleScoreBreakdown {
  const evidence = scoreAppleRecordingEvidence(track, song, prefs);
  const artistScore = roundScore(
    evidence.artist.primaryPair * 0.65 + evidence.artist.candidateCoverage * 0.25 + evidence.artist.sourceCoverage * 0.1
  );
  const weights = activeIdentityWeights(
    Boolean(prefs.preferDurationMatch && track.durationMs && song.attributes.durationInMillis)
  );
  return {
    total: evidence.confidence,
    fields: {
      title: evidence.titleSimilarity,
      artist: artistScore,
      album: evidence.albumSimilarity,
      duration: evidence.durationSimilarity,
      version: evidence.versionCompatibility
    },
    weights,
    evidence
  };
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function roundScore(value: number): number {
  return Math.round(clamp01(value) * 10_000) / 10_000;
}
