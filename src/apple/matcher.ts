import { loadCookies } from "../fetchers/auth.js";
import { getNotFoundIndices } from "../matchFilters.js";
import {
  type AppleCandidate,
  type AppleMatchReport,
  type AppleMatchResult,
  DEFAULT_MATCH_PREFERENCES,
  type MatchPreferences,
  type NormalizedPlaylist,
  type NormalizedTrack
} from "../types.js";
import { type AppleSong, appleCreatePlaylist, appleGetStorefront, appleSearch, appleSongsByIsrc } from "./api.js";
import { chooseByCoverSimilarity } from "./artwork.js";
import { albumSimilarity, compactAlbumText, compactText, scoreAppleSong } from "./scoring.js";

/** Number of candidates kept per track so the user can override the pick. */
const MAX_CANDIDATES = 8;

/**
 * Pick the Apple Music storefront whose catalog best holds a track's original
 * text, so non-English tracks are searched (and scored) in their native script
 * rather than the account store's romanized metadata. Returns undefined when no
 * native region applies (Latin text) — the caller then uses the account store.
 */
export function detectStorefrontForTrack(
  track: NormalizedTrack,
  mode: MatchPreferences["cjkDetection"]
): string | undefined {
  const text = `${track.originalName} ${track.artists.join(" ")} ${track.albumName ?? ""}`;
  const hasKana = /[぀-ゟ゠-ヿ]/u.test(text); // Hiragana / Katakana
  const hasHangul = /[가-힯ᄀ-ᇿ]/u.test(text);
  const hasHan = /[一-鿿㐀-䶿]/u.test(text);

  if (hasHangul) return "kr";
  if (hasKana) return "jp";
  if (hasHan) {
    if (mode === "source") {
      // Chinese providers → Chinese store; otherwise Han-only is usually Japanese.
      return track.source.provider === "qq" || track.source.provider === "netease" ? "cn" : "jp";
    }
    // Pure text mode: Han-only most commonly indicates Japanese kanji titles.
    return "jp";
  }
  return undefined;
}

function buildArtworkUrl(song: AppleSong): string | undefined {
  const art = song.attributes.artwork;
  if (!art?.url) return undefined;
  // Apple artwork URLs are templates with {w}/{h} placeholders.
  return art.url.replace("{w}", "200").replace("{h}", "200");
}

function toCandidate(
  song: AppleSong,
  scoreBreakdown: ReturnType<typeof scoreAppleSong>,
  storefront: string
): AppleCandidate {
  return {
    id: song.id,
    name: song.attributes.name,
    artistName: song.attributes.artistName,
    albumName: song.attributes.albumName,
    url: song.attributes.url,
    artworkUrl: buildArtworkUrl(song),
    durationMs: song.attributes.durationInMillis,
    releaseDate: song.attributes.releaseDate,
    contentRating: song.attributes.contentRating,
    score: scoreBreakdown.total,
    scoreBreakdown,
    isrc: song.attributes.isrc,
    storefront
  };
}

function candidateToSong(candidate: AppleCandidate): AppleSong {
  return {
    id: candidate.id,
    type: "songs",
    attributes: {
      name: candidate.name,
      artistName: candidate.artistName,
      albumName: candidate.albumName ?? "",
      durationInMillis: candidate.durationMs,
      releaseDate: candidate.releaseDate,
      isrc: candidate.isrc,
      url: candidate.url,
      contentRating: candidate.contentRating,
      artwork: candidate.artworkUrl ? { url: candidate.artworkUrl } : undefined
    }
  };
}

function mergePreservedCandidateFields(
  refreshed: AppleMatchResult,
  previousCandidates: AppleCandidate[]
): AppleMatchResult {
  if (!refreshed.candidates) {
    return refreshed;
  }

  const previousById = new Map(previousCandidates.map((candidate) => [candidate.id, candidate]));
  const candidates = refreshed.candidates.map((candidate) => {
    const previous = previousById.get(candidate.id);
    return previous
      ? {
          ...candidate,
          addableId: previous.addableId,
          artworkUrl: previous.artworkUrl ?? candidate.artworkUrl,
          storefront: previous.storefront ?? candidate.storefront
        }
      : candidate;
  });
  const selected = refreshed.selectedId
    ? candidates.find((candidate) => candidate.id === refreshed.selectedId)
    : undefined;

  return {
    ...refreshed,
    candidates,
    appleMusicId: selected?.addableId ?? refreshed.appleMusicId,
    appleMusicUrl: selected?.url ?? refreshed.appleMusicUrl
  };
}

function resultChanged(previous: AppleMatchResult, next: AppleMatchResult): boolean {
  if (previous.status !== next.status) return true;
  if (previous.selectedId !== next.selectedId) return true;
  if (previous.appleMusicId !== next.appleMusicId) return true;
  if (previous.reason !== next.reason) return true;

  const previousCandidates = previous.candidates ?? [];
  const nextCandidates = next.candidates ?? [];
  if (previousCandidates.length !== nextCandidates.length) return true;

  return nextCandidates.some((candidate, index) => {
    const previousCandidate = previousCandidates[index];
    return (
      previousCandidate.id !== candidate.id ||
      previousCandidate.score !== candidate.score ||
      previousCandidate.scoreBreakdown?.total !== candidate.scoreBreakdown?.total
    );
  });
}

function shouldRefreshExistingCandidates(result: AppleMatchResult): result is AppleMatchResult & {
  candidates: AppleCandidate[];
} {
  if (result.selectionSource === "manual") return false;
  if (!result.candidates || result.candidates.length === 0) return false;
  return result.status === "ambiguous" || result.status === "not_found";
}

/** Tie-break preference for explicit/clean when scores are otherwise equal. */
function explicitRank(candidate: AppleCandidate, prefs: MatchPreferences): number {
  if (prefs.explicitPreference === "none") return 0;
  if (prefs.explicitPreference === "explicit") {
    return candidate.contentRating === "explicit" ? 1 : 0;
  }
  // prefer clean
  return candidate.contentRating === "clean" ? 1 : 0;
}

function hasEquivalentDuration(left: AppleCandidate, right: AppleCandidate): boolean {
  if (!left.durationMs || !right.durationMs) {
    return left.durationMs === right.durationMs;
  }
  return Math.abs(left.durationMs - right.durationMs) <= 2_000;
}

function isEquivalentCandidate(left: AppleCandidate, right: AppleCandidate): boolean {
  return (
    compactText(left.name) === compactText(right.name) &&
    compactText(left.artistName) === compactText(right.artistName) &&
    compactAlbumText(left.albumName ?? "") === compactAlbumText(right.albumName ?? "") &&
    hasEquivalentDuration(left, right)
  );
}

function matchesSourceAlbum(track: NormalizedTrack, candidate: AppleCandidate): boolean {
  const sourceAlbum = compactAlbumText(track.albumName ?? "");
  return Boolean(sourceAlbum) && compactAlbumText(candidate.albumName ?? "") === sourceAlbum;
}

function chooseIndistinguishableDuplicate(
  track: NormalizedTrack,
  candidates: AppleCandidate[]
): AppleCandidate | undefined {
  const best = candidates[0];
  if (!best || candidates.length < 2) return undefined;
  if (!candidates.every((candidate) => matchesSourceAlbum(track, candidate))) return undefined;
  return candidates.every((candidate) => isEquivalentCandidate(best, candidate)) ? best : undefined;
}

function chooseByAlbumSimilarity(track: NormalizedTrack, candidates: AppleCandidate[]): AppleCandidate | undefined {
  const sourceAlbum = compactAlbumText(track.albumName ?? "");
  if (!sourceAlbum) return undefined;

  const exactMatches = candidates.filter((candidate) => compactAlbumText(candidate.albumName ?? "") === sourceAlbum);
  if (exactMatches.length === 1) {
    return exactMatches[0];
  }

  const scored = candidates
    .map((candidate) => ({
      candidate,
      albumScore: candidate.scoreBreakdown?.fields.album ?? albumSimilarity(track.albumName, candidate.albumName)
    }))
    .sort((a, b) => b.albumScore - a.albumScore);

  const best = scored[0];
  const second = scored[1];
  if (!best || !second) return undefined;
  if (best.albumScore < 0.72) return undefined;
  if (best.albumScore - second.albumScore < 0.12) return undefined;
  return best.candidate;
}

function chooseByDurationSimilarity(candidates: AppleCandidate[]): AppleCandidate | undefined {
  const scored = candidates
    .map((candidate) => ({
      candidate,
      durationScore: candidate.scoreBreakdown?.fields.duration ?? 0,
      titleScore: candidate.scoreBreakdown?.fields.title ?? 0,
      artistScore: candidate.scoreBreakdown?.fields.artist ?? 0,
      versionScore: candidate.scoreBreakdown?.fields.version ?? 0
    }))
    .sort((a, b) => b.durationScore - a.durationScore);

  const best = scored[0];
  const second = scored[1];
  if (!best || !second) return undefined;
  if (best.durationScore < 0.95) return undefined;
  if (best.durationScore - second.durationScore < 0.5) return undefined;
  if (best.titleScore < 0.8 || best.artistScore < 0.5) return undefined;
  if (best.versionScore < 0.8) return undefined;
  return best.candidate;
}

function scoreGapReason(best: AppleCandidate, second: AppleCandidate | undefined, prefs: MatchPreferences): string {
  if (!second) {
    return `score ${best.score.toFixed(2)}`;
  }

  const gap = best.score - second.score;
  return `best ${best.score.toFixed(2)} vs second ${second.score.toFixed(2)}; gap ${gap.toFixed(2)} / required ${prefs.ambiguousGap.toFixed(2)}`;
}

function matchedResult(
  track: NormalizedTrack,
  candidates: AppleCandidate[],
  winner: AppleCandidate,
  reason?: string
): AppleMatchResult {
  return {
    track,
    status: "matched",
    candidates,
    selectedId: winner.id,
    selectionSource: "auto",
    appleMusicId: winner.id,
    appleMusicUrl: winner.url,
    reason
  };
}

export async function matchSingleTrack(
  track: NormalizedTrack,
  results: AppleSong[],
  storefront: string,
  prefs: MatchPreferences
): Promise<AppleMatchResult> {
  if (results.length === 0) {
    return { track, status: "not_found", candidates: [], reason: "No results from Apple Music search" };
  }

  const scored = results
    .map((song) => {
      const scoreBreakdown = scoreAppleSong(track, song, prefs);
      return toCandidate(song, scoreBreakdown, storefront);
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Equal score → apply explicit/clean preference as a tie-break.
      return explicitRank(b, prefs) - explicitRank(a, prefs);
    })
    .slice(0, MAX_CANDIDATES);

  const best = scored[0];

  if (best.score < prefs.threshold) {
    const durationChoice = chooseByDurationSimilarity(scored);
    if (
      durationChoice &&
      best.score - durationChoice.score < prefs.ambiguousGap &&
      durationChoice.score >= Math.max(0.75, prefs.threshold - 0.1)
    ) {
      const durationScore = durationChoice.scoreBreakdown?.fields.duration ?? 0;
      return matchedResult(
        track,
        scored,
        durationChoice,
        `Selected by duration-backed version match (${durationScore.toFixed(2)}; score ${durationChoice.score.toFixed(2)} below threshold ${prefs.threshold.toFixed(2)} but title/artist/version agree)`
      );
    }

    return {
      track,
      status: "not_found",
      candidates: scored,
      reason: `Best match score ${best.score.toFixed(2)} below threshold ${prefs.threshold.toFixed(2)} (${scoreGapReason(best, scored[1], prefs)})`
    };
  }

  const second = scored[1];
  const isTie = second !== undefined && best.score - second.score < prefs.ambiguousGap;

  if (isTie) {
    // Try to break the tie decisively with the explicit/clean preference.
    const bestRank = explicitRank(best, prefs);
    const secondRank = explicitRank(second, prefs);
    if (prefs.explicitPreference !== "none" && bestRank !== secondRank) {
      const winner = bestRank > secondRank ? best : second;
      return matchedResult(
        track,
        scored,
        winner,
        `Selected by explicit/clean preference (${scoreGapReason(best, second, prefs)})`
      );
    }

    const nearTied = scored.filter((candidate) => best.score - candidate.score < prefs.ambiguousGap);
    const duplicateChoice = chooseIndistinguishableDuplicate(track, nearTied);
    if (duplicateChoice) {
      return matchedResult(
        track,
        scored,
        duplicateChoice,
        `Selected first indistinguishable duplicate (${scoreGapReason(best, second, prefs)})`
      );
    }

    const albumChoice = chooseByAlbumSimilarity(track, nearTied);
    if (albumChoice) {
      const albumScore =
        albumChoice.scoreBreakdown?.fields.album ?? albumSimilarity(track.albumName, albumChoice.albumName);
      return matchedResult(
        track,
        scored,
        albumChoice,
        `Selected by album match/similarity (${albumScore.toFixed(2)}; ${scoreGapReason(best, second, prefs)})`
      );
    }

    const durationChoice = chooseByDurationSimilarity(nearTied);
    if (durationChoice) {
      const durationScore = durationChoice.scoreBreakdown?.fields.duration ?? 0;
      return matchedResult(
        track,
        scored,
        durationChoice,
        `Selected by duration match (${durationScore.toFixed(2)}; ${scoreGapReason(best, second, prefs)})`
      );
    }

    const coverChoice = await chooseByCoverSimilarity(track, nearTied);
    if (coverChoice) {
      return matchedResult(
        track,
        scored,
        coverChoice.candidate,
        `Selected by album cover similarity (${coverChoice.similarity.toFixed(2)}; ${scoreGapReason(best, second, prefs)})`
      );
    }

    return {
      track,
      status: "ambiguous",
      candidates: scored,
      reason: `Multiple close matches (${scoreGapReason(best, second, prefs)}); no decisive explicit, album, duration, or cover tie-breaker`
    };
  }

  return matchedResult(track, scored, best, `Selected best match (${scoreGapReason(best, second, prefs)})`);
}

/**
 * Resolve the account-store (addable) id for each candidate via its ISRC, when
 * the candidate came from a different (native) store. Mutates candidates in
 * place, setting `addableId`. Best-effort: failures leave addableId undefined
 * and are tolerated (the candidate id is used as a fallback at creation time).
 */
async function bridgeCandidatesToAccountStore(candidates: AppleCandidate[], accountStore: string): Promise<void> {
  for (const c of candidates) {
    if (c.storefront === accountStore) {
      c.addableId = c.id;
      continue;
    }
    if (!c.isrc) continue;
    try {
      const matches = await appleSongsByIsrc(c.isrc, accountStore);
      if (matches.length > 0) {
        c.addableId = matches[0].id;
      }
    } catch {
      // leave addableId undefined; createPlaylist falls back to c.id
    }
  }
}

/**
 * Match one track: search its native store (when nativeSearch is on and the
 * track's script implies a non-account region), score there, then bridge the
 * candidates back to the account store via ISRC so they can be added to the
 * user's library.
 */
async function processTrack(
  track: NormalizedTrack,
  accountStore: string,
  prefs: MatchPreferences
): Promise<AppleMatchResult> {
  const query = `${track.originalName} ${track.artists[0] ?? ""}`.trim();
  const nativeStore = prefs.nativeSearch ? detectStorefrontForTrack(track, prefs.cjkDetection) : undefined;
  const searchStore = nativeStore && nativeStore !== accountStore ? nativeStore : accountStore;

  const songs = await appleSearch(query, searchStore);
  const result = await matchSingleTrack(track, songs, searchStore, prefs);

  // Bridge to the account store only when we searched a different region.
  if (searchStore !== accountStore && result.candidates && result.candidates.length > 0) {
    await bridgeCandidatesToAccountStore(result.candidates, accountStore);
    // Re-point the auto-selected id to its addable counterpart when resolved.
    if (result.selectedId) {
      const sel = result.candidates.find((c) => c.id === result.selectedId);
      if (sel?.addableId) {
        result.appleMusicId = sel.addableId;
      }
    }
  }

  return result;
}

/**
 * Match all tracks in a playlist against the Apple Music catalog.
 * Requires Apple Music login (cookies).
 *
 * `prefs` tunes thresholds, tie-break rules, and native-region search.
 * `onProgress` (optional) is invoked after each track so a caller can surface
 * live progress.
 */
export async function matchAppleMusic(
  playlist: NormalizedPlaylist,
  prefs: MatchPreferences = DEFAULT_MATCH_PREFERENCES,
  onProgress?: (processed: number, total: number, result: AppleMatchResult) => void
): Promise<AppleMatchReport> {
  const cookies = await loadCookies("apple");
  if (!cookies || cookies.length === 0) {
    return {
      provider: playlist.provider,
      playlistId: playlist.id,
      playlistName: playlist.name,
      results: playlist.tracks.map((track) => ({
        track,
        status: "not_implemented",
        reason: "Not logged in to Apple Music. Please log in from Settings."
      }))
    };
  }

  // Resolve the account storefront: explicit override wins, else auto-detect.
  let accountStore = prefs.storefront.trim();
  if (!accountStore) {
    try {
      accountStore = await appleGetStorefront();
    } catch {
      accountStore = "us";
    }
  }

  const total = playlist.tracks.length;
  const results: AppleMatchResult[] = [];
  for (const track of playlist.tracks) {
    let result: AppleMatchResult;
    try {
      result = await processTrack(track, accountStore, prefs);
    } catch (error) {
      result = { track, status: "not_found", candidates: [], reason: (error as Error).message };
    }
    results.push(result);
    onProgress?.(results.length, total, result);
    // Small delay to respect rate limits
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return {
    provider: playlist.provider,
    playlistId: playlist.id,
    playlistName: playlist.name,
    results
  };
}

/**
 * Re-run Apple Music matching only for results currently marked not_found,
 * including manual "no match" rows, then merge those refreshed results back
 * into the existing report.
 */
export async function retryNotFoundAppleMusic(
  report: AppleMatchReport,
  prefs: MatchPreferences = DEFAULT_MATCH_PREFERENCES,
  onProgress?: (processed: number, total: number, result: AppleMatchResult) => void
): Promise<AppleMatchReport> {
  return retryAppleMusicResults(report, getNotFoundIndices(report.results), prefs, onProgress);
}

export async function retryAppleMusicResults(
  report: AppleMatchReport,
  indices: readonly number[],
  prefs: MatchPreferences = DEFAULT_MATCH_PREFERENCES,
  onProgress?: (processed: number, total: number, result: AppleMatchResult) => void
): Promise<AppleMatchReport> {
  const retryIndices = Array.from(new Set(indices)).filter(
    (idx) => Number.isInteger(idx) && idx >= 0 && idx < report.results.length
  );
  if (retryIndices.length === 0) {
    return report;
  }

  const retryPlaylist: NormalizedPlaylist = {
    provider: report.provider,
    id: report.playlistId,
    name: report.playlistName,
    tracks: retryIndices.map((idx) => report.results[idx].track),
    raw: {}
  };
  const retryReport = await matchAppleMusic(retryPlaylist, prefs, onProgress);
  const results = report.results.slice();
  for (const [pos, idx] of retryIndices.entries()) {
    const next = retryReport.results[pos];
    if (next) {
      results[idx] = next;
    }
  }

  return {
    ...report,
    results
  };
}

export async function refreshAppleMatchReportCandidates(
  report: AppleMatchReport,
  prefs: MatchPreferences = DEFAULT_MATCH_PREFERENCES
): Promise<AppleMatchReport> {
  const results: AppleMatchResult[] = [];
  let changed = false;

  for (const result of report.results) {
    if (!shouldRefreshExistingCandidates(result)) {
      results.push(result);
      continue;
    }

    try {
      const storefront = result.candidates.find((candidate) => candidate.storefront)?.storefront ?? prefs.storefront;
      const songs = result.candidates.map(candidateToSong);
      const refreshed = mergePreservedCandidateFields(
        await matchSingleTrack(result.track, songs, storefront || "us", prefs),
        result.candidates
      );
      results.push(refreshed);
      changed ||= resultChanged(result, refreshed);
    } catch {
      results.push(result);
    }
  }

  return changed ? { ...report, results } : report;
}

/**
 * Create an Apple Music playlist from matched tracks.
 */
export async function createAppleMusicPlaylist(name: string, description: string, trackIds: string[]): Promise<string> {
  return appleCreatePlaylist(name, description, trackIds);
}
