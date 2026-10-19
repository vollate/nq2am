export type { PortablePlaylistFile, PortableTrack } from "./adapters/file.js";
export { normalizePlaylistFile, toPortablePlaylist, toPortableTrack } from "./adapters/file.js";
export { normalizeNeteasePlaylist } from "./adapters/netease.js";
export { normalizeQqPlaylist } from "./adapters/qq.js";
export type {
  AppleApiRequestMetric,
  AppleApiSession,
  AppleApiSessionOptions,
  AppleApiSessionStats
} from "./apple/api.js";
export {
  appleCreatePlaylist,
  appleGetStorefront,
  appleSearch,
  appleSongsByIsrc,
  createAppleApiSession
} from "./apple/api.js";
export type {
  ArtistAliasCatalogProgress,
  ArtistAliasCatalogStatus,
  ArtistAliasDumpFetcher
} from "./apple/artistAliasCatalog.js";
export {
  cancelArtistAliasCatalogDownload,
  compileArtistAliasGroups,
  getArtistAliasCatalogStatus,
  loadArtistAliasCatalogSnapshot,
  MUSICBRAINZ_ATTRIBUTION,
  musicBrainzSnapshotDate,
  musicbrainzNames,
  parseMusicBrainzArtistDump,
  parseVocadbArtistDump,
  readArtistAliasCatalogStatus,
  refreshArtistAliasCatalog,
  requestArtistAliasCatalogRefresh,
  TOUHOUDB_ATTRIBUTION,
  UTAITEDB_ATTRIBUTION,
  VOCADB_ATTRIBUTION,
  vocadbNames
} from "./apple/artistAliasCatalog.js";
export type { ArtistAliasSuggestion } from "./apple/artistAliases.js";
export { extractArtistAliasSuggestions, REVIEWED_ARTIST_ALIASES } from "./apple/artistAliases.js";
export {
  catalogNamesAreAliases,
  runWithArtistAliasSnapshot,
  snapshotFromCatalogFile
} from "./apple/artistAliasIndex.js";
export { foldHanToSimplified } from "./apple/hanFold.js";
export type { AppleMatchExecutionOptions, AppleMatchLogEvent } from "./apple/matcher.js";
export {
  createAppleMusicPlaylist,
  createAppleMusicPlaylistFromReport,
  detectStorefrontForTrack,
  matchAppleMusic,
  matchSingleTrack,
  refreshAppleMatchReportCandidates,
  resolveAppleMusicTrackIds,
  retryAppleMusicResults,
  retryNotFoundAppleMusic
} from "./apple/matcher.js";
export {
  areApprovedArtistAliases,
  compareArtistCredits,
  identityCompactText,
  levenshteinDistance,
  levenshteinSimilarity,
  normalizeRecordingText,
  parseRecordingMetadata,
  recordingTextSimilarity,
  splitArtistCredits
} from "./apple/recordingMetadata.js";
export { buildRecordingGroups } from "./apple/recordingResolution.js";
export type {
  DecisionReplayCategory,
  DecisionReplayItem,
  DecisionReplayReport,
  RetrievalReplayItem,
  RetrievalReplayReport,
  ThresholdSweepItem,
  ThresholdSweepRow
} from "./apple/replay.js";
export { evaluateDecisionReplay, evaluateRetrievalReplay, sweepRecordingThresholds } from "./apple/replay.js";
export {
  appleQueryCacheKey,
  buildAppleQueryPlan,
  DEFAULT_APPLE_QUERY_BUDGET,
  extraNativeStorefrontsForTrack,
  queryPlanForTrack,
  unionAppleSearchCandidates
} from "./apple/retrieval.js";
export { albumSimilarity, durationSimilarity, scoreAppleRecordingEvidence, scoreAppleSong } from "./apple/scoring.js";
export { stripAlbumAnnotations, stripTitleAnnotations, titleTextSimilarity } from "./apple/titleNormalization.js";
export { compareVersionRelation } from "./apple/versionSemantics.js";
export { interactiveLogin, loadCookies, saveCookies } from "./fetchers/auth.js";
export { closeBrowser, fetchWithBrowser } from "./fetchers/browser.js";
export { fetchNeteasePlaylist, parseNeteasePlaylistId } from "./fetchers/netease.js";
export { fetchQqPlaylist, parseQqPlaylistId } from "./fetchers/qq.js";
export type {
  AppleArtistEvidence,
  AppleArtistPairEvidence,
  AppleCandidate,
  AppleCandidateEvidence,
  AppleCandidateProvenance,
  AppleContentRating,
  AppleDecisionDiagnostics,
  AppleMatchReport,
  AppleMatchResult,
  AppleMatchStatus,
  AppleQueryVariant,
  AppleRecordingGroupEvidence,
  AppleRequestFailure,
  AppleRequestOperation,
  AppleRetrievalDiagnostics,
  AppleRetrievalQueryDiagnostic,
  AppleScoringVersion,
  FetchOptions,
  MatchPreferences,
  MusicProvider,
  NormalizedPlaylist,
  NormalizedSource,
  NormalizedTrack,
  ParsedRecordingMetadata
} from "./types.js";
export { CURRENT_SCORING_VERSION, DEFAULT_MATCH_PREFERENCES } from "./types.js";
