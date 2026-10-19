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

/** A provider-agnostic track in a portable playlist file. */
export type PortableTrack = {
  name?: string;
  artists?: string[];
  album?: string;
  durationMs?: number;
};

/** The `nq2am-playlist` JSON envelope exported/imported by the UI. */
export type PortablePlaylistFile = {
  format: "nq2am-playlist";
  version: 1;
  name?: string;
  description?: string;
  provider?: MusicProvider;
  tracks: PortableTrack[];
};

export type AppleMatchStatus =
  | "not_implemented"
  | "matched"
  | "not_found"
  | "score_rejected"
  | "ambiguous"
  | "request_failed";

export type AppleQueryVariant =
  | "original_primary_artist"
  | "base_primary_artist"
  | "base_additional_artist"
  | "base_album"
  | "base_title";

export type AppleCandidateProvenance = {
  queryId: string;
  variant: AppleQueryVariant;
  term: string;
  storefront: string;
  rank: number;
};

export type ParsedRecordingMetadata = {
  baseTitle: string;
  featuredArtists: string[];
  recordingFacets: string[];
  structuralFacets: string[];
  releaseFacets: string[];
  versionDescriptors?: Array<{
    category: string;
    kind: string;
    ordinal?: string;
    payload: string;
    raw: string;
    identityRelevant?: boolean;
  }>;
};

export type AppleArtistEvidence = {
  primaryPair: number;
  candidateCoverage: number;
  sourceCoverage: number;
  pairs: Array<{
    source: string;
    candidate: string;
    similarity: number;
    alias: boolean;
  }>;
  aliases: string[];
  hasPrimaryRelationship: boolean;
};

export type AppleCandidateEvidence = {
  parsedSource: ParsedRecordingMetadata;
  parsedCandidate: ParsedRecordingMetadata;
  baseTitleSimilarity: number;
  titleSimilarity: number;
  artist: AppleArtistEvidence;
  durationSimilarity: number;
  versionCompatibility: number;
  versionRelation?: "agree" | "structural_omit" | "named_omit" | "conflict";
  unrequestedStructuralVariant?: boolean;
  albumSimilarity: number;
  albumBonus: number;
  artworkBonus: number;
  identityConfidence: number;
  confidence: number;
  automaticEligible: boolean;
  deterministicIdentity: boolean;
  incompatibilities: string[];
  decisiveEvidence: string[];
};

export type AppleRetrievalDiagnostics = {
  outcome: "success" | "failed";
  queryBudget: number;
  queries: Array<{
    queryId: string;
    variant: AppleQueryVariant;
    term: string;
    storefront: string;
    required: boolean;
    status: "success" | "failed";
    candidateCount: number;
    fromCache?: boolean;
    reason?: string;
  }>;
  uniqueCandidateCount: number;
  earlyStopped: boolean;
  cacheHits: number;
};

export type AppleRecordingGroupEvidence = {
  id: string;
  candidateIds: string[];
  isrc?: string;
  confidence: number;
  identityConfidence: number;
  automaticEligible: boolean;
  deterministicIdentity: boolean;
  strongestCandidateId: string;
  selectedReleaseId?: string;
  decisiveEvidence: string[];
  conflicts: string[];
  versionRelation?: "agree" | "structural_omit" | "named_omit" | "conflict";
  versionConflict?: { source: string; candidate: string };
};

export type AppleRequestFailure = {
  kind: "timeout" | "rate_limited" | "http" | "network" | "session" | "unknown";
  operation?: "session" | "storefront" | "search" | "isrc" | "create_playlist";
  status?: number;
  attempts?: number;
};

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
  evidence?: AppleCandidateEvidence;
};

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
  isrc?: string;
  addableId?: string;
  storefront?: string;
  provenance?: AppleCandidateProvenance[];
  evidence?: AppleCandidateEvidence;
  recordingGroupId?: string;
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
  requestFailure?: AppleRequestFailure;
  scoringVersion?: 2 | 3;
  retrieval?: AppleRetrievalDiagnostics;
  recordingGroups?: AppleRecordingGroupEvidence[];
  decision?: {
    scoringVersion: 2 | 3;
    bestGroupConfidence?: number;
    runnerUpGroupConfidence?: number;
    margin?: number;
    automaticThreshold: number;
    reviewThreshold: number;
    requiredMargin: number;
    rejectionCause?: string;
    decisiveEvidence: string[];
  };
};

export type AppleMatchReport = {
  provider: MusicProvider;
  playlistId?: string;
  playlistName?: string;
  scoringVersion?: 2 | 3;
  results: AppleMatchResult[];
};

export type MatchRetryScope = "not_found" | "score_rejected" | "ambiguous" | "request_failed" | "selected" | "all";
export type MatchReviewTab = "all" | "ambiguous" | "score_rejected" | "not_found" | "request_failed" | "matched";

export type ArtistAliasCatalogProgress = {
  phase: "listing" | "downloading" | "compiling";
  bytesReceived: number;
  bytesTotal?: number;
  percent?: number;
  currentSource?: string;
  bytesPerSecond?: number;
  etaSeconds?: number;
};

export type ArtistAliasCatalogStatus = {
  status: "idle" | "downloading" | "failed";
  refreshedAt?: string;
  dumpDate?: string;
  sources: Array<{ id: string; license: string; attribution: string; url: string }>;
  groupCount: number;
  sourceCounts?: Partial<Record<string, number>>;
  error?: string;
  progress?: ArtistAliasCatalogProgress;
};

export type MatchPreferences = {
  scoringVersion: 3;
  threshold: number;
  reviewThreshold: number;
  ambiguousGap: number;
  preferDurationMatch: boolean;
  explicitPreference: "explicit" | "clean" | "none";
  preferOriginalVersion: boolean;
  storefront: string;
  nativeSearch: boolean;
  cjkDetection: "source" | "text";
  matchConcurrency: number;
  appleRequestIntervalMs: number;
  appleRequestTimeoutMs: number;
  appleMaxAttempts: number;
  appleRetryBaseDelayMs: number;
  appleRandomPauseEnabled: boolean;
  appleRandomPauseMinMs: number;
  appleRandomPauseMaxMs: number;
  artworkTimeoutMs: number;
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
  sourcePlaylist: {
    name?: string;
    description?: string;
  };
  report: AppleMatchReport | null;
};
