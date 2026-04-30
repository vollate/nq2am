export { normalizeNeteasePlaylist } from "./adapters/netease.js";

export { normalizeQqPlaylist } from "./adapters/qq.js";
export { appleCreatePlaylist, appleGetStorefront, appleSearch } from "./apple/api.js";
export { createAppleMusicPlaylist, matchAppleMusic } from "./apple/matcher.js";
export { interactiveLogin, loadCookies, saveCookies } from "./fetchers/auth.js";
export { closeBrowser, fetchWithBrowser } from "./fetchers/browser.js";
export { fetchNeteasePlaylist, parseNeteasePlaylistId } from "./fetchers/netease.js";
export { fetchQqPlaylist, parseQqPlaylistId } from "./fetchers/qq.js";
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
