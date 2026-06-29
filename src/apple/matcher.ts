import { loadCookies } from "../fetchers/auth.js";
import {
  type AppleCandidate,
  type AppleMatchReport,
  type AppleMatchResult,
  DEFAULT_MATCH_PREFERENCES,
  type MatchPreferences,
  type NormalizedPlaylist,
  type NormalizedTrack
} from "../types.js";
import { type AppleSong, appleCreatePlaylist, appleGetStorefront, appleSearch } from "./api.js";

/** Number of candidates kept per track so the user can override the pick. */
const MAX_CANDIDATES = 8;

/** Tokens that indicate a non-original version (used by preferOriginalVersion). */
const VERSION_TOKENS = ["remaster", "remastered", "live", "karaoke", "instrumental", "cover", "version", "remix"];

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function buildArtworkUrl(song: AppleSong): string | undefined {
  const art = song.attributes.artwork;
  if (!art?.url) return undefined;
  // Apple artwork URLs are templates with {w}/{h} placeholders.
  return art.url.replace("{w}", "200").replace("{h}", "200");
}

function toCandidate(song: AppleSong, score: number): AppleCandidate {
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
    score
  };
}

/**
 * Base text similarity between a track and an Apple song (name + artist).
 * Returns 0–1. Duration/version/explicit rules are applied on top of this.
 */
function baseScore(track: NormalizedTrack, song: AppleSong): number {
  const trackName = normalizeText(track.originalName);
  const songName = normalizeText(song.attributes.name);
  const trackArtist = normalizeText(track.artists[0] ?? "");
  const songArtist = normalizeText(song.attributes.artistName);

  let nameScore = 0;
  if (trackName === songName) {
    nameScore = 1;
  } else if (songName.includes(trackName) || trackName.includes(songName)) {
    nameScore = 0.7;
  }

  let artistScore = 0;
  if (trackArtist === songArtist) {
    artistScore = 1;
  } else if (songArtist.includes(trackArtist) || trackArtist.includes(songArtist)) {
    artistScore = 0.7;
  }

  return nameScore * 0.6 + artistScore * 0.4;
}

/**
 * Apply configurable rule bonuses/penalties to a base score. Kept small so text
 * similarity stays dominant; rules mainly break ties between close versions.
 */
function applyRules(base: number, track: NormalizedTrack, song: AppleSong, prefs: MatchPreferences): number {
  let score = base;

  // Duration closeness: up to +0.1 when within ~2s, fading to 0 by ~30s off.
  if (prefs.preferDurationMatch && track.durationMs && song.attributes.durationInMillis) {
    const diffSec = Math.abs(track.durationMs - song.attributes.durationInMillis) / 1000;
    const bonus = Math.max(0, 0.1 * (1 - diffSec / 30));
    score += bonus;
  }

  // Version type: penalize remaster/live/karaoke/etc. unless the source name
  // also carries that token (so a track literally titled "... (Live)" isn't hurt).
  if (prefs.preferOriginalVersion) {
    const songName = song.attributes.name.toLowerCase();
    const srcName = track.originalName.toLowerCase();
    const hasExtraVersion = VERSION_TOKENS.some((t) => songName.includes(t) && !srcName.includes(t));
    if (hasExtraVersion) {
      score -= 0.08;
    }
  }

  return score;
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

function matchSingleTrack(track: NormalizedTrack, results: AppleSong[], prefs: MatchPreferences): AppleMatchResult {
  if (results.length === 0) {
    return { track, status: "not_found", candidates: [], reason: "No results from Apple Music search" };
  }

  const scored = results
    .map((song) => {
      const score = applyRules(baseScore(track, song), track, song, prefs);
      return toCandidate(song, score);
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Equal score → apply explicit/clean preference as a tie-break.
      return explicitRank(b, prefs) - explicitRank(a, prefs);
    })
    .slice(0, MAX_CANDIDATES);

  const best = scored[0];

  if (best.score < prefs.threshold) {
    return {
      track,
      status: "not_found",
      candidates: scored,
      reason: `Best match score ${best.score.toFixed(2)} below threshold ${prefs.threshold.toFixed(2)}`
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
      return {
        track,
        status: "matched",
        candidates: scored,
        selectedId: winner.id,
        selectionSource: "auto",
        appleMusicId: winner.id,
        appleMusicUrl: winner.url
      };
    }

    return {
      track,
      status: "ambiguous",
      candidates: scored,
      reason: `Multiple close matches (${best.score.toFixed(2)} vs ${second.score.toFixed(2)})`
    };
  }

  return {
    track,
    status: "matched",
    candidates: scored,
    selectedId: best.id,
    selectionSource: "auto",
    appleMusicId: best.id,
    appleMusicUrl: best.url
  };
}

/**
 * Match all tracks in a playlist against the Apple Music catalog.
 * Requires Apple Music login (cookies).
 *
 * `prefs` tunes thresholds and tie-break rules. `onProgress` (optional) is
 * invoked after each track so a caller can surface live progress.
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

  // Resolve storefront: explicit override wins, else auto-detect, else "us".
  let storefront = prefs.storefront.trim();
  if (!storefront) {
    try {
      storefront = await appleGetStorefront();
    } catch {
      storefront = "us";
    }
  }

  const total = playlist.tracks.length;
  const results: AppleMatchResult[] = [];
  for (const track of playlist.tracks) {
    let result: AppleMatchResult;
    try {
      const query = `${track.originalName} ${track.artists[0] ?? ""}`.trim();
      const songs = await appleSearch(query, storefront);
      result = matchSingleTrack(track, songs, prefs);
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
 * Create an Apple Music playlist from matched tracks.
 */
export async function createAppleMusicPlaylist(name: string, description: string, trackIds: string[]): Promise<string> {
  return appleCreatePlaylist(name, description, trackIds);
}
