import type { AppleArtistEvidence, AppleArtistPairEvidence, ParsedRecordingMetadata } from "../types.js";
import { REVIEWED_ARTIST_ALIASES } from "./artistAliases.js";
import { catalogNamesAreAliases, currentArtistAliasSnapshot } from "./artistAliasIndex.js";
import { foldHanToSimplified } from "./hanFold.js";
import { classifyVersionSegment, descriptorsAreMetadata } from "./versionSemantics.js";

export type RecordingFacetCategory = "recording" | "structural" | "release";

type FacetRule = {
  category: RecordingFacetCategory;
  facet: string;
  pattern: RegExp;
};

const FACET_RULES: readonly FacetRule[] = [
  { category: "recording", facet: "off_vocal", pattern: /\boff[\s_-]*vocal\b/iu },
  {
    category: "recording",
    facet: "instrumental",
    pattern: /\binstrumental(?:\s+version)?\b|インスト(?:ゥルメンタル)?|伴奏/iu
  },
  { category: "recording", facet: "karaoke", pattern: /\bkaraoke\b|カラオケ/iu },
  {
    category: "recording",
    facet: "live",
    pattern: /\blive(?:\s+(?:at|from|in)\b)?|ライブ(?:版|ver(?:sion)?\.?)?|现场(?:\s*版)?|演唱会/iu
  },
  { category: "recording", facet: "remix", pattern: /\bremix(?:ed)?\b|リミックス|dj\s*版/iu },
  { category: "recording", facet: "cover", pattern: /\bcover(?:ed)?\b|カバー|翻唱/iu },
  { category: "recording", facet: "acoustic", pattern: /\bacoustic\b|アコースティック/iu },
  { category: "recording", facet: "demo", pattern: /\bdemo\b/iu },
  { category: "recording", facet: "edit", pattern: /\b(?:tv\s*size|short\s+(?:edit|version)|edited\s+version)\b/iu },
  { category: "structural", facet: "radio_edit", pattern: /\bradio\s+(?:edit|version)\b/iu },
  { category: "structural", facet: "extended", pattern: /\bextended(?:\s+(?:mix|version|ver\.?))?\b/iu },
  { category: "structural", facet: "long", pattern: /\blong(?:\s+(?:mix|version|ver\.?))?\b/iu },
  { category: "structural", facet: "full", pattern: /\bfull(?:\s+(?:mix|version|ver\.?))?\b|完整版/iu },
  { category: "structural", facet: "album_version", pattern: /\balbum\s+(?:mix|version|ver\.?)\b/iu },
  {
    category: "structural",
    facet: "generic_version",
    pattern: /\bver(?:sion)?\.?\s*[\p{L}\p{N}_+.-]*|[\p{L}\p{N}_+.-]+\s+ver\.?\b/iu
  },
  { category: "release", facet: "remaster", pattern: /\b(?:\d{4}\s+)?remaster(?:ed)?\b|リマスター/iu },
  { category: "release", facet: "anniversary", pattern: /\b(?:\d+(?:st|nd|rd|th)\s+)?anniversary\b/iu },
  { category: "release", facet: "deluxe", pattern: /\bdeluxe\b/iu },
  { category: "release", facet: "single", pattern: /\bsingle\b/iu },
  { category: "release", facet: "edition", pattern: /\b(?:special|expanded|limited|collector(?:s)?)\s+edition\b/iu },
  { category: "release", facet: "theme", pattern: /主题曲|片头曲|片尾曲|插曲/iu },
  { category: "release", facet: "media_tie", pattern: /(?:电影|电视剧|电视|动画|动漫)\s*[《「『]?/iu }
] as const;

const FEATURED_PATTERN = /\b(?:feat(?:uring)?|ft|with)\.?\s+([^()[\]{}]+?)(?=$|\s*[-–—]|\s*[)\]】}])/giu;
// NFKC normalization has already folded full-width brackets and colons to ASCII by this point.
const VOICE_ACTOR_PATTERN = /[([{【]\s*(?:cv|c\.v)[.:]?\s*([^)\]}】]+)[)\]}】]/giu;
const WRAPPED_SEGMENT = /([([{（【])([^()[\]{}（）【】]+)([)\]}）】])/gu;

export function normalizeRecordingText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/＆/gu, "&")
    .replace(/[’`']/gu, "")
    .replace(/[‐‑‒–—―]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeFacetText(value: string): string {
  return normalizeRecordingText(value).replace(/[_.]/gu, " ");
}

function matchingFacets(value: string): FacetRule[] {
  const normalized = normalizeFacetText(value);
  return FACET_RULES.filter((rule) => rule.pattern.test(normalized));
}

function splitCredits(value: string): string[] {
  return value
    .replace(/\s+(?:and|x)\s+/giu, ",")
    .split(/[,;&/／、，+]|\s+&\s+/u)
    .map((artist) => artist.trim())
    .filter(Boolean);
}

function removeFeaturedCredits(value: string, featuredArtists: string[]): string {
  return value.replace(FEATURED_PATTERN, (_whole, artists: string) => {
    featuredArtists.push(...splitCredits(artists));
    return " ";
  });
}

function segmentIsMetadata(segment: string): boolean {
  const normalized = normalizeFacetText(segment);
  if (descriptorsAreMetadata(normalized) || matchingFacets(normalized).length > 0) return true;
  return /^(?:feat(?:uring)?|ft|with)\.?\b/iu.test(normalized);
}

function stripFacetSegments(value: string): string {
  let next = value.replace(WRAPPED_SEGMENT, (whole, _open: string, segment: string) =>
    segmentIsMetadata(segment) ? " " : whole
  );

  // Remove only suffix descriptors after a separator. Keeping arbitrary
  // parenthesized text protects titles where parentheses are part of the name.
  next = next.replace(/\s*[-:：]\s*([^\n]+)$/u, (whole, segment: string) => (segmentIsMetadata(segment) ? " " : whole));
  // Some services append an unwrapped suffix ("Song Extended") while others
  // omit it. Strip only a recognized trailing descriptor when a base title is
  // present; a title that consists solely of "Live", for example, is kept.
  next = next.replace(
    /(?<=\S)\s+(?:(?:album\s+)?(?:extended|long|full)\s*(?:mix|version|ver\.?)?|radio\s+(?:edit|version)|off[\s_-]*vocal|instrumental(?:\s+version)?|karaoke|live|remix|cover|(?:\d{4}\s+)?remaster(?:ed)?|(?:special|expanded|limited)\s+edition|伴奏|翻唱|现场(?:\s*版)?|演唱会|dj\s*版|完整版|主题曲|片头曲|片尾曲|插曲|[\p{L}\p{N}_+.-]+(?:\s+)?(?:ver(?:sion)?\.?|版|アレンジ)|#\s*\d+\s*ver(?:sion)?\.?)\s*$/iu,
    " "
  );
  return next;
}

export function parseRecordingMetadata(title: string): ParsedRecordingMetadata {
  const normalized = normalizeRecordingText(title);
  const featuredArtists: string[] = [];
  const withoutFeatured = removeFeaturedCredits(normalized, featuredArtists);
  const versionDescriptors = collectVersionDescriptors(withoutFeatured);
  const facets = matchingFacets(withoutFeatured);
  const fromDescriptors = facetsFromDescriptors(versionDescriptors);
  const baseTitle = stripFacetSegments(withoutFeatured)
    .replace(/[([{（【]\s*[)\]}）】]/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/^[-:：\s]+|[-:：\s]+$/gu, "")
    .trim();

  return {
    baseTitle: baseTitle || normalized,
    featuredArtists: [...new Set(featuredArtists.map(normalizeRecordingText).filter(Boolean))],
    recordingFacets: uniqueSorted([
      ...fromDescriptors.recordingFacets,
      ...facets.filter((rule) => rule.category === "recording").map((rule) => rule.facet)
    ]),
    structuralFacets: uniqueSorted([
      ...fromDescriptors.structuralFacets,
      ...facets.filter((rule) => rule.category === "structural").map((rule) => rule.facet)
    ]),
    releaseFacets: uniqueSorted([
      ...fromDescriptors.releaseFacets,
      ...facets.filter((rule) => rule.category === "release").map((rule) => rule.facet)
    ]),
    versionDescriptors
  };
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function collectVersionDescriptors(title: string): ParsedRecordingMetadata["versionDescriptors"] {
  const descriptors: ParsedRecordingMetadata["versionDescriptors"] = [];
  const seen = new Set<string>();
  const consider = (segment: string) => {
    const classified = classifyVersionSegment(segment);
    if (!classified) return;
    const key = `${classified.kind}:${classified.payload}:${classified.ordinal ?? ""}:${classified.identityRelevant ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    descriptors.push(classified);
  };
  for (const match of title.matchAll(WRAPPED_SEGMENT)) consider(match[2]);
  const suffix = title.match(/\s*[-:：]\s*([^\n]+)$/u);
  if (suffix) consider(suffix[1]);
  const trailing = title.match(
    /(?<=\S)\s+((?:(?:album\s+)?(?:extended|long|full)\s*(?:mix|version|ver\.?)?|radio\s+(?:edit|version)|off[\s_-]*vocal|instrumental(?:\s+version)?|karaoke|live|remix|cover|#\s*\d+\s*ver(?:sion)?\.?|[\p{L}\p{N}_+.-]+\s+ver(?:sion)?\.?)\s*)$/iu
  );
  if (trailing) consider(trailing[1]);
  return descriptors;
}

function facetsFromDescriptors(descriptors: ParsedRecordingMetadata["versionDescriptors"]): {
  recordingFacets: string[];
  structuralFacets: string[];
  releaseFacets: string[];
} {
  const recordingFacets: string[] = [];
  const structuralFacets: string[] = [];
  const releaseFacets: string[] = [];
  for (const descriptor of descriptors) {
    if (descriptor.category === "recording") {
      recordingFacets.push(descriptor.kind === "tv" ? "edit" : descriptor.kind);
    } else if (descriptor.category === "structural") {
      structuralFacets.push(descriptor.kind);
    } else if (descriptor.kind === "anniversary" && descriptor.identityRelevant === false) {
      releaseFacets.push("anniversary");
    } else if (descriptor.kind === "remaster") {
      releaseFacets.push("remaster");
    } else if (descriptor.payload === "theme") {
      releaseFacets.push("theme");
    } else if (descriptor.category === "named" || descriptor.kind === "anniversary") {
      structuralFacets.push("generic_version");
    }
  }
  return { recordingFacets, structuralFacets, releaseFacets };
}

export function identityCompactText(value: string): string {
  return foldHanToSimplified(normalizeRecordingText(value)).replace(/[^\p{L}\p{N}]/gu, "");
}

/** Unicode code-point Levenshtein edit distance. */
export function levenshteinDistance(leftValue: string, rightValue: string): number {
  const left = Array.from(leftValue);
  const right = Array.from(rightValue);
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  let current = new Array<number>(right.length + 1).fill(0);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost
      );
    }
    [previous, current] = [current, previous];
  }
  return previous[right.length];
}

/** Levenshtein distance normalized to 0–1 by the longer string's code-point length. */
export function levenshteinSimilarity(left: string, right: string): number {
  const length = Math.max(Array.from(left).length, Array.from(right).length);
  if (length === 0) return 1;
  return roundEvidence(1 - levenshteinDistance(left, right) / length);
}

export function recordingTextSimilarity(left: string, right: string): number {
  const a = identityCompactText(left);
  const b = identityCompactText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  return levenshteinSimilarity(a, b);
}

export function splitArtistCredits(values: readonly string[]): string[] {
  const credits = values.flatMap((value) => {
    const normalized = normalizeRecordingText(value);
    return [...voiceActorCredits(normalized), ...splitCreditList(normalized)];
  });
  const seen = new Set<string>();
  return credits
    .map((artist) => artist.trim())
    .filter((artist) => {
      if (!artist || seen.has(artist)) return false;
      seen.add(artist);
      return true;
    });
}

function splitCreditList(normalized: string): string[] {
  return normalized
    .replace(/\b(?:feat(?:uring)?|ft|with)\.?\b/giu, ",")
    .replace(/\s+(?:and|x)\s+/giu, ",")
    .split(/[,;&/／、，+]|\s+&\s+/u);
}

/**
 * `角色(CV:声优)` credits name the performer alongside the character. The performer is a real
 * credit for the recording and is listed separately so it can be paired, while the character
 * itself stays a distinct name rather than becoming an alias of the performer.
 */
function voiceActorCredits(normalized: string): string[] {
  return [...normalized.matchAll(VOICE_ACTOR_PATTERN)].flatMap(([, performers]) => splitCreditList(performers));
}

export function aliasKey(value: string): string {
  return identityCompactText(value);
}

const ALIAS_GROUP_BY_NAME = new Map<string, number>();
for (const [groupIndex, group] of REVIEWED_ARTIST_ALIASES.entries()) {
  for (const name of group) ALIAS_GROUP_BY_NAME.set(aliasKey(name), groupIndex);
}

export function areApprovedArtistAliases(left: string, right: string): boolean {
  const leftKey = aliasKey(left);
  const rightKey = aliasKey(right);
  if (!leftKey || leftKey === rightKey) return false;
  const leftGroup = ALIAS_GROUP_BY_NAME.get(leftKey);
  if (leftGroup !== undefined && leftGroup === ALIAS_GROUP_BY_NAME.get(rightKey)) return true;
  return catalogNamesAreAliases(leftKey, rightKey, currentArtistAliasSnapshot());
}

function artistPair(left: string, right: string): AppleArtistPairEvidence {
  const alias = areApprovedArtistAliases(left, right);
  return {
    source: left,
    candidate: right,
    similarity: alias ? 1 : recordingTextSimilarity(left, right),
    alias
  };
}

/** Greedy maximum one-to-one credit pairing with deterministic tie ordering. */
export function compareArtistCredits(
  sourceValues: readonly string[],
  candidateValues: readonly string[]
): AppleArtistEvidence {
  const source = splitArtistCredits(sourceValues);
  const candidate = splitArtistCredits(candidateValues);
  if (source.length === 0 || candidate.length === 0) {
    return {
      primaryPair: 0,
      candidateCoverage: 0,
      sourceCoverage: 0,
      pairs: [],
      aliases: [],
      hasPrimaryRelationship: false
    };
  }

  const possibilities = source.flatMap((sourceName, sourceIndex) =>
    candidate.map((candidateName, candidateIndex) => ({
      ...artistPair(sourceName, candidateName),
      sourceIndex,
      candidateIndex
    }))
  );
  possibilities.sort(
    (left, right) =>
      right.similarity - left.similarity ||
      left.sourceIndex - right.sourceIndex ||
      left.candidateIndex - right.candidateIndex
  );

  const usedSource = new Set<number>();
  const usedCandidate = new Set<number>();
  const pairs: AppleArtistPairEvidence[] = [];
  for (const possibility of possibilities) {
    if (usedSource.has(possibility.sourceIndex) || usedCandidate.has(possibility.candidateIndex)) continue;
    usedSource.add(possibility.sourceIndex);
    usedCandidate.add(possibility.candidateIndex);
    pairs.push({
      source: possibility.source,
      candidate: possibility.candidate,
      similarity: possibility.similarity,
      alias: possibility.alias
    });
  }

  const sourceScores = source.map((name) => Math.max(...candidate.map((other) => artistPair(name, other).similarity)));
  const candidateScores = candidate.map((name) =>
    Math.max(...source.map((other) => artistPair(other, name).similarity))
  );
  const primaryPair = Math.max(...source.map((name) => artistPair(name, candidate[0]).similarity));
  const aliases = pairs.filter((pair) => pair.alias).map((pair) => `${pair.source} = ${pair.candidate}`);

  return {
    primaryPair: roundEvidence(primaryPair),
    candidateCoverage: roundEvidence(candidateScores.reduce((sum, score) => sum + score, 0) / candidateScores.length),
    sourceCoverage: roundEvidence(sourceScores.reduce((sum, score) => sum + score, 0) / sourceScores.length),
    pairs,
    aliases,
    hasPrimaryRelationship: primaryPair >= 0.72 || pairs.some((pair) => pair.alias)
  };
}

export function roundEvidence(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 10_000) / 10_000;
}
