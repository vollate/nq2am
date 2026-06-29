export type MusicProvider = "qq" | "netease" | "apple";

export type NormalizedTrack = {
  originalName: string;
  artists: string[];
  albumName?: string;
  albumArtist?: string;
  albumCoverUrl?: string;
  durationMs?: number;
  source: { provider: MusicProvider; playlistId?: string; songId?: string };
};

export type NormalizedPlaylist = {
  provider: MusicProvider;
  id?: string;
  name?: string;
  description?: string;
  coverUrl?: string;
  sourceUrl?: string;
  tracks: NormalizedTrack[];
};

export type AppleMatchStatus =
  | "not_implemented"
  | "matched"
  | "not_found"
  | "ambiguous";

export type AppleContentRating = "explicit" | "clean";

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
};

export type AppleMatchResult = {
  track: NormalizedTrack;
  status: AppleMatchStatus;
  candidates?: AppleCandidate[];
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

export type MatchPreferences = {
  threshold: number;
  ambiguousGap: number;
  preferDurationMatch: boolean;
  explicitPreference: "explicit" | "clean" | "none";
  preferOriginalVersion: boolean;
  storefront: string;
};

export type AuthStatus = {
  qq: boolean;
  netease: boolean;
  apple: boolean;
};

export type TaskStatus =
  | "fetched"
  | "matching"
  | "matched"
  | "match_failed"
  | "creating"
  | "created"
  | "create_failed";

export type TaskSummary = {
  key: string;
  provider: MusicProvider;
  name?: string;
  createdAt: number;
  updatedAt: number;
  status: TaskStatus;
  trackCount: number;
  matched?: number;
  matchProgress?: { processed: number; total: number };
  applePlaylistId?: string;
  error?: string;
};

export type MatchJob = {
  status: TaskStatus;
  progress?: { processed: number; total: number };
  error?: string;
  report: AppleMatchReport | null;
};
