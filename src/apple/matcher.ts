import { loadCookies } from "../fetchers/auth.js";
import type { AppleMatchReport, AppleMatchResult, NormalizedPlaylist, NormalizedTrack } from "../types.js";
import { type AppleSong, appleCreatePlaylist, appleGetStorefront, appleSearch } from "./api.js";

/**
 * Score how well an Apple Music song matches a normalized track.
 * Returns 0–1 where 1 is a perfect match.
 */
function scoreMatch(track: NormalizedTrack, song: AppleSong): number {
  const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

  const trackName = normalize(track.originalName);
  const songName = normalize(song.attributes.name);

  const trackArtist = normalize(track.artists[0] ?? "");
  const songArtist = normalize(song.attributes.artistName);

  // Exact name match
  let nameScore = 0;
  if (trackName === songName) {
    nameScore = 1;
  } else if (songName.includes(trackName) || trackName.includes(songName)) {
    nameScore = 0.7;
  }

  // Artist match
  let artistScore = 0;
  if (trackArtist === songArtist) {
    artistScore = 1;
  } else if (songArtist.includes(trackArtist) || trackArtist.includes(songArtist)) {
    artistScore = 0.7;
  }

  return nameScore * 0.6 + artistScore * 0.4;
}

const MATCH_THRESHOLD = 0.7;
const AMBIGUOUS_GAP = 0.1;

async function matchSingleTrack(track: NormalizedTrack, storefront: string): Promise<AppleMatchResult> {
  const query = `${track.originalName} ${track.artists[0] ?? ""}`.trim();

  try {
    const results = await appleSearch(query, storefront);

    if (results.length === 0) {
      return { track, status: "not_found", reason: "No results from Apple Music search" };
    }

    const scored = results.map((song) => ({ song, score: scoreMatch(track, song) })).sort((a, b) => b.score - a.score);

    const best = scored[0];

    if (best.score < MATCH_THRESHOLD) {
      return { track, status: "not_found", reason: `Best match score ${best.score.toFixed(2)} below threshold` };
    }

    if (scored.length > 1 && best.score - scored[1].score < AMBIGUOUS_GAP) {
      return {
        track,
        status: "ambiguous",
        appleMusicId: best.song.id,
        appleMusicUrl: best.song.attributes.url,
        reason: `Multiple close matches (${best.score.toFixed(2)} vs ${scored[1].score.toFixed(2)})`
      };
    }

    return {
      track,
      status: "matched",
      appleMusicId: best.song.id,
      appleMusicUrl: best.song.attributes.url
    };
  } catch (error) {
    return { track, status: "not_found", reason: (error as Error).message };
  }
}

/**
 * Match all tracks in a playlist against Apple Music catalog.
 * Requires Apple Music login (cookies).
 */
export async function matchAppleMusic(playlist: NormalizedPlaylist): Promise<AppleMatchReport> {
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

  // Get user's storefront
  let storefront = "us";
  try {
    storefront = await appleGetStorefront();
  } catch {
    // Fallback to "us"
  }

  // Process tracks with rate limiting
  const results: AppleMatchResult[] = [];
  for (const track of playlist.tracks) {
    const result = await matchSingleTrack(track, storefront);
    results.push(result);
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
