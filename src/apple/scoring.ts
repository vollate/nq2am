import type { AppleScoreBreakdown, MatchPreferences, NormalizedTrack } from "../types.js";
import type { AppleSong } from "./api.js";

type ScoreField = keyof AppleScoreBreakdown["fields"];

const BASE_WEIGHTS: AppleScoreBreakdown["weights"] = {
  title: 0.45,
  artist: 0.25,
  album: 0.15,
  duration: 0.1,
  version: 0.05
};

const VERSION_PATTERNS: Array<[RegExp, string]> = [
  [/\boff[\s_-]*vocal\b/u, "off vocal"],
  [/\binstrumental\b/u, "instrumental"],
  [/\bkaraoke\b/u, "karaoke"],
  [/\blive\b/u, "live"],
  [/\bremaster(?:ed)?\b/u, "remaster"],
  [/\bremix\b/u, "remix"],
  [/\bcover\b/u, "cover"]
];

export function normalizeText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/＆/gu, "&").replace(/[’']/gu, "").trim();
}

function comparableText(value: string): string {
  return normalizeText(value)
    .replace(/\s*[[(（【{]\s*(?:feat|featuring|ft|with)\.?\s*[^\])）】}]*[\])）】}]/giu, " ")
    .replace(/\s+\b(?:feat|featuring|ft|with)\.?\s+.+$/iu, " ")
    .replace(/\s*[[(（【{]\s*(?:\d{4}\s*)?remaster(?:ed)?[^\])）】}]*[\])）】}]/giu, " ")
    .replace(/\b\d{4}\s+remaster(?:ed)?\b/giu, " ")
    .replace(/\bremaster(?:ed)?\b/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function stripFlexibleVersionDescriptors(value: string): string {
  return value
    .replace(/\s*[[(（【{]\s*(?:album\s+)?(?:extended|long|full)\s*(?:mix|version|ver\.?)?\s*[\])）】}]/giu, " ")
    .replace(/\s*[[(（【{]\s*ver\.?\s*[\p{L}\p{N}_+-]+\s*[\])）】}]/giu, " ")
    .replace(/\s*[[(（【{]\s*[\p{L}\p{N}_+-]+\s+ver\.?\s*[\])）】}]/giu, " ")
    .replace(/\s*[-–—:]\s*(?:album\s+)?(?:extended|long|full)\s*(?:mix|version|ver\.?)?\s*$/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function albumComparableText(value: string): string {
  return comparableText(value)
    .replace(/\s*[-–—:]\s*(?:single|ep)\s*$/iu, "")
    .trim();
}

export function compactText(value: string): string {
  return comparableText(value).replace(/[^\p{L}\p{N}]/gu, "");
}

export function compactAlbumText(value: string): string {
  return albumComparableText(value).replace(/[^\p{L}\p{N}]/gu, "");
}

function normalizeToken(token: string): string {
  const compacted = compactText(token);
  if (compacted === "ost" || compacted === "soundtracks") return "soundtrack";
  return compacted;
}

function tokensFromComparable(value: string): string[] {
  const matches = value.match(/[\p{L}\p{N}]+/gu) ?? [];
  return matches.map(normalizeToken).filter((token) => token.length > 0);
}

function diceSimilarity(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const rightCounts = new Map<string, number>();
  for (const token of right) {
    rightCounts.set(token, (rightCounts.get(token) ?? 0) + 1);
  }

  let intersection = 0;
  for (const token of left) {
    const count = rightCounts.get(token) ?? 0;
    if (count > 0) {
      intersection += 1;
      rightCounts.set(token, count - 1);
    }
  }
  return (2 * intersection) / (left.length + right.length);
}

function levenshtein(left: string, right: string): number {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  const prev = Array.from({ length: right.length + 1 }, (_, index) => index);
  const curr = Array.from({ length: right.length + 1 }, () => 0);

  for (let i = 1; i <= left.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= right.length; j += 1) {
      prev[j] = curr[j];
    }
  }

  return prev[right.length];
}

function editSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  const distance = levenshtein(left, right);
  return clamp01(1 - distance / Math.max(left.length, right.length));
}

function comparableSimilarity(leftComparable: string, rightComparable: string): number {
  const leftCompact = leftComparable.replace(/[^\p{L}\p{N}]/gu, "");
  const rightCompact = rightComparable.replace(/[^\p{L}\p{N}]/gu, "");
  if (!leftCompact || !rightCompact) return 0;
  if (leftCompact === rightCompact) return 1;

  return roundScore(
    Math.max(
      editSimilarity(leftCompact, rightCompact),
      diceSimilarity(tokensFromComparable(leftComparable), tokensFromComparable(rightComparable))
    )
  );
}

export function textSimilarity(left: string | undefined, right: string | undefined): number {
  if (!left || !right) return 0;

  return comparableSimilarity(comparableText(left), comparableText(right));
}

function durationSupportsFlexibleTitle(sourceMs: number | undefined, candidateMs: number | undefined): boolean {
  if (!sourceMs || !candidateMs) return false;
  return Math.abs(sourceMs - candidateMs) <= 4_000;
}

function titleSimilarity(
  sourceTitle: string,
  candidateTitle: string,
  sourceMs: number | undefined,
  candidateMs: number | undefined
): number {
  const strict = textSimilarity(sourceTitle, candidateTitle);
  if (!durationSupportsFlexibleTitle(sourceMs, candidateMs)) return strict;

  const flexible = comparableSimilarity(
    stripFlexibleVersionDescriptors(comparableText(sourceTitle)),
    stripFlexibleVersionDescriptors(comparableText(candidateTitle))
  );
  return Math.max(strict, flexible);
}

function splitArtistNames(values: string[]): string[] {
  return values
    .flatMap((value) =>
      normalizeText(value)
        .replace(/\b(feat|featuring|ft|with)\.?\b/gu, ",")
        .replace(/\s+(?:and|x)\s+/gu, ",")
        .split(/[,;&/／、，+]|(?:\s*&\s*)/u)
    )
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

function artistSimilarity(sourceArtists: string[], candidateArtist: string): number {
  const source = splitArtistNames(sourceArtists);
  const candidate = splitArtistNames([candidateArtist]);
  if (source.length === 0 || candidate.length === 0) return 0;

  const sourceCoverage =
    source.reduce((sum, name) => sum + Math.max(...candidate.map((other) => textSimilarity(name, other))), 0) /
    source.length;
  const candidateCoverage =
    candidate.reduce((sum, name) => sum + Math.max(...source.map((other) => textSimilarity(name, other))), 0) /
    candidate.length;

  return roundScore((sourceCoverage + candidateCoverage) / 2);
}

export function albumSimilarity(sourceAlbum: string | undefined, candidateAlbum: string | undefined): number {
  if (!sourceAlbum || !candidateAlbum) return 0;

  const sourceComparable = albumComparableText(sourceAlbum);
  const candidateComparable = albumComparableText(candidateAlbum);
  return comparableSimilarity(sourceComparable, candidateComparable);
}

function durationSimilarity(sourceMs: number | undefined, candidateMs: number | undefined): number {
  if (!sourceMs || !candidateMs) return 0;
  const diffSec = Math.abs(sourceMs - candidateMs) / 1000;
  if (diffSec <= 2) return 1;
  return roundScore(Math.max(0, 1 - (diffSec - 2) / 28));
}

function versionTokens(value: string): Set<string> {
  const normalized = normalizeText(value);
  return new Set(VERSION_PATTERNS.filter(([pattern]) => pattern.test(normalized)).map(([, token]) => token));
}

function versionSimilarity(sourceTitle: string, candidateTitle: string): number {
  const source = versionTokens(sourceTitle);
  const candidate = versionTokens(candidateTitle);
  const unwanted = [...candidate].filter((token) => !source.has(token));
  if (unwanted.length > 0) return 0;

  const missingRequested = [...source].filter((token) => !candidate.has(token));
  return missingRequested.length > 0 ? 0.45 : 1;
}

function activeWeights(active: Record<ScoreField, boolean>): AppleScoreBreakdown["weights"] {
  const activeTotal = (Object.keys(BASE_WEIGHTS) as ScoreField[])
    .filter((field) => active[field])
    .reduce((sum, field) => sum + BASE_WEIGHTS[field], 0);

  const weights = { title: 0, artist: 0, album: 0, duration: 0, version: 0 };
  if (activeTotal === 0) return weights;

  for (const field of Object.keys(BASE_WEIGHTS) as ScoreField[]) {
    weights[field] = active[field] ? roundScore(BASE_WEIGHTS[field] / activeTotal) : 0;
  }
  return weights;
}

export function scoreAppleSong(track: NormalizedTrack, song: AppleSong, prefs: MatchPreferences): AppleScoreBreakdown {
  const fields = {
    title: titleSimilarity(
      track.originalName,
      song.attributes.name,
      track.durationMs,
      song.attributes.durationInMillis
    ),
    artist: artistSimilarity(track.artists, song.attributes.artistName),
    album: albumSimilarity(track.albumName, song.attributes.albumName),
    duration: prefs.preferDurationMatch ? durationSimilarity(track.durationMs, song.attributes.durationInMillis) : 0,
    version: prefs.preferOriginalVersion ? versionSimilarity(track.originalName, song.attributes.name) : 1
  };
  const weights = activeWeights({
    title: true,
    artist: true,
    album: Boolean(track.albumName && song.attributes.albumName),
    duration: Boolean(prefs.preferDurationMatch && track.durationMs && song.attributes.durationInMillis),
    version: prefs.preferOriginalVersion
  });
  const total = roundScore(
    (Object.keys(fields) as ScoreField[]).reduce((sum, field) => sum + fields[field] * weights[field], 0)
  );

  return { total, fields, weights };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function roundScore(value: number): number {
  return Math.round(clamp01(value) * 10_000) / 10_000;
}
