export type {
  AppleMatchReport,
  AppleMatchResult,
  AppleMatchStatus,
  FetchOptions,
  MusicProvider,
  NormalizedPlaylist,
  NormalizedSource,
  NormalizedTrack
} from "./types.js";

export { normalizeQqPlaylist } from "./adapters/qq.js";
export { normalizeNeteasePlaylist } from "./adapters/netease.js";
export { fetchQqPlaylist, parseQqPlaylistId } from "./fetchers/qq.js";
export { fetchNeteasePlaylist, parseNeteasePlaylistId } from "./fetchers/netease.js";
export { matchAppleMusic } from "./apple/matcher.js";
