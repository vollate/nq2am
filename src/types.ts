export type MusicProvider = "qq" | "netease" | "apple";

export type NormalizedSource = {
  provider: MusicProvider;
  playlistId?: string;
  songId?: string;
  raw: unknown;
};

export type NormalizedTrack = {
  originalName: string;
  artists: string[];
  albumName?: string;
  albumArtist?: string;
  albumCoverUrl?: string;
  /** Track length in milliseconds, when the source provides it. */
  durationMs?: number;
  source: NormalizedSource;
};

export type NormalizedPlaylist = {
  provider: MusicProvider;
  id?: string;
  name?: string;
  description?: string;
  coverUrl?: string;
  sourceUrl?: string;
  tracks: NormalizedTrack[];
  raw: unknown;
};

export type AppleMatchStatus = "not_implemented" | "matched" | "not_found" | "ambiguous";

export type AppleContentRating = "explicit" | "clean";

export type AppleScoreBreakdown = {
  total: number;
  fields: {
    title: number;
    artist: number;
    album: number;
    duration: number;
    version: number;
  };
  weights: {
    title: number;
    artist: number;
    album: number;
    duration: number;
    version: number;
  };
};

/** A single Apple Music catalog candidate for a normalized track. */
export type AppleCandidate = {
  id: string;
  name: string;
  artistName: string;
  albumName?: string;
  url?: string;
  artworkUrl?: string;
  durationMs?: number;
  releaseDate?: string;
  contentRating?: AppleContentRating;
  score: number;
  scoreBreakdown?: AppleScoreBreakdown;
  /** ISRC recording id, when available — used to bridge across storefronts. */
  isrc?: string;
  /**
   * Catalog id of the same recording in the user's account storefront,
   * resolved via ISRC. Falls back to `id` when the candidate already comes
   * from the account store. This is the id that can actually be added to the
   * user's library.
   */
  addableId?: string;
  /** Storefront this candidate's metadata was fetched from (e.g. "jp"). */
  storefront?: string;
};

export type AppleMatchResult = {
  track: NormalizedTrack;
  status: AppleMatchStatus;
  /** Top scored candidates (best first); kept so a user can override the pick. */
  candidates?: AppleCandidate[];
  /** The chosen candidate id (mirrors appleMusicId for the selected one). */
  selectedId?: string;
  selectionSource?: "auto" | "manual";
  appleMusicId?: string;
  appleMusicUrl?: string;
  reason?: string;
};

export type AppleMatchReport = {
  provider: MusicProvider;
  playlistId?: string;
  playlistName?: string;
  results: AppleMatchResult[];
};

/**
 * User-tunable matching preferences. Persisted server-side and edited only
 * through the Settings UI — never hand-written.
 */
export type MatchPreferences = {
  /** Minimum score for an automatic match (0–1). */
  threshold: number;
  /** If best − secondBest < this, the match is ambiguous. */
  ambiguousGap: number;
  /** Favor candidates whose duration is closest to the source track. */
  preferDurationMatch: boolean;
  /** Tie-break preference when both explicit and clean versions exist. */
  explicitPreference: "explicit" | "clean" | "none";
  /** Prefer original/studio versions over remaster/live/karaoke/instrumental. */
  preferOriginalVersion: boolean;
  /** Apple storefront override; empty string means auto-detect. */
  storefront: string;
  /**
   * Search non-English tracks in their native Apple Music region (jp/kr/cn) for
   * better matches, bridging back to the account store via ISRC.
   */
  nativeSearch: boolean;
  /**
   * How to pick the native region for a track:
   * - "source": use the playlist provider (qq/netease → cn) plus script hints.
   * - "text": infer purely from the track text (kana→jp, hangul→kr, han→jp).
   */
  cjkDetection: "source" | "text";
};

export const DEFAULT_MATCH_PREFERENCES: MatchPreferences = {
  threshold: 0.7,
  ambiguousGap: 0.1,
  preferDurationMatch: true,
  explicitPreference: "none",
  preferOriginalVersion: true,
  storefront: "",
  nativeSearch: true,
  cjkDetection: "source"
};

export type FetchOptions = {
  cookie?: string;
  headers?: Record<string, string>;
  userAgent?: string;
  cookieDir?: string;
  skipCookieCache?: boolean;
};
