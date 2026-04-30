export type MusicProvider = "qq" | "netease" | "apple";

export type NormalizedTrack = {
  originalName: string;
  artists: string[];
  albumName?: string;
  albumArtist?: string;
  albumCoverUrl?: string;
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

export type AppleMatchResult = {
  track: NormalizedTrack;
  status: AppleMatchStatus;
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

export type AuthStatus = {
  qq: boolean;
  netease: boolean;
  apple: boolean;
};
