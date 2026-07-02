export { normalizeNeteasePlaylist } from "./adapters/netease.js";

export { normalizeQqPlaylist } from "./adapters/qq.js";
export { appleCreatePlaylist, appleGetStorefront, appleSearch, appleSongsByIsrc } from "./apple/api.js";
export {
  createAppleMusicPlaylist,
  detectStorefrontForTrack,
  matchAppleMusic,
  retryAppleMusicResults,
  retryNotFoundAppleMusic
} from "./apple/matcher.js";
export { interactiveLogin, loadCookies, saveCookies } from "./fetchers/auth.js";
export { closeBrowser, fetchWithBrowser } from "./fetchers/browser.js";
export { fetchNeteasePlaylist, parseNeteasePlaylistId } from "./fetchers/netease.js";
export { fetchQqPlaylist, parseQqPlaylistId } from "./fetchers/qq.js";
export type {
  AppleCandidate,
  AppleContentRating,
  AppleMatchReport,
  AppleMatchResult,
  AppleMatchStatus,
  FetchOptions,
  MatchPreferences,
  MusicProvider,
  NormalizedPlaylist,
  NormalizedSource,
  NormalizedTrack
} from "./types.js";
export { DEFAULT_MATCH_PREFERENCES } from "./types.js";
