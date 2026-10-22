import { performance } from "node:perf_hooks";
import { loadCookies } from "../fetchers/auth.js";
import { getNotFoundIndices } from "../matchFilters.js";
import {
  type AppleCandidate,
  type AppleMatchReport,
  type AppleMatchResult,
  type AppleRetrievalDiagnostics,
  CURRENT_SCORING_VERSION,
  DEFAULT_MATCH_PREFERENCES,
  type MatchPreferences,
  type NormalizedPlaylist,
  type NormalizedTrack
} from "../types.js";
import {
  type AppleApiRequestMetric,
  type AppleApiSession,
  type AppleApiSessionOptions,
  type AppleSong,
  appleCreatePlaylist,
  createAppleApiSession
} from "./api.js";
import { loadArtistAliasCatalogSnapshot } from "./artistAliasCatalog.js";
import { artistAliasSnapshotFromContext, runWithArtistAliasSnapshot } from "./artistAliasIndex.js";
import {
  type ArtworkComparator,
  type ArtworkComparatorOptions,
  chooseByCoverSimilarity,
  createArtworkComparator
} from "./artwork.js";
import { mapWithConcurrency } from "./concurrency.js";
import { type CoverSimilarityChooser, resolveRecordingDecision } from "./recordingResolution.js";
import { describeAppleRequestFailure } from "./requestFailure.js";
import {
  type AppleQueryPlanItem,
  appleQueryCacheKey,
  queryPlanForTrack,
  type RetrievedAppleSong,
  unionAppleSearchCandidates
} from "./retrieval.js";
import { scoreAppleRecordingEvidence, scoreAppleSong } from "./scoring.js";

const MAX_RETRIEVED_CANDIDATES = 60;

export type AppleMatchLogEvent = {
  event: "request" | "stage" | "job_complete";
  jobId?: string;
  stage?: "session" | "search" | "candidate_evaluation" | "artwork" | "isrc" | "track" | "job";
  trackIndex?: number;
  durationMs: number;
  outcome?: "success" | "error";
  operation?: AppleApiRequestMetric["operation"];
  attempt?: number;
  status?: number;
  processedTracks?: number;
  requestCount?: number;
  retryCount?: number;
};

export type AppleMatchExecutionOptions = {
  concurrency?: number;
  logger?: (event: AppleMatchLogEvent) => void;
  sessionFactory?: (options: AppleApiSessionOptions) => Promise<AppleApiSession>;
  artworkComparatorFactory?: (options: ArtworkComparatorOptions) => ArtworkComparator;
};

type QueryCache = Map<string, Promise<AppleSong[]>>;

type RetrievalResult = {
  candidates: RetrievedAppleSong[];
  diagnostics: AppleRetrievalDiagnostics;
  requiredFailure?: unknown;
};

function requestFailedResult(
  track: NormalizedTrack,
  error: unknown,
  operation: "session" | "search",
  retrieval?: AppleRetrievalDiagnostics
): AppleMatchResult {
  const { reason, requestFailure } = describeAppleRequestFailure(error, { operation });
  return {
    track,
    status: "request_failed",
    candidates: [],
    reason,
    requestFailure,
    scoringVersion: CURRENT_SCORING_VERSION,
    retrieval
  };
}

function defaultMatchLogger(event: AppleMatchLogEvent): void {
  process.stderr.write(`[apple-match] ${JSON.stringify(event)}\n`);
}

function safeLogger(logger: (event: AppleMatchLogEvent) => void): (event: AppleMatchLogEvent) => void {
  return (event) => {
    try {
      logger(event);
    } catch {
      // Diagnostics must never change matching behavior.
    }
  };
}

function durationSince(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

function apiSessionOptions(
  prefs: MatchPreferences,
  onRequest?: AppleApiSessionOptions["onRequest"]
): AppleApiSessionOptions {
  return {
    requestTimeoutMs: prefs.appleRequestTimeoutMs,
    minRequestIntervalMs: prefs.appleRequestIntervalMs,
    maxAttempts: prefs.appleMaxAttempts,
    baseRetryDelayMs: prefs.appleRetryBaseDelayMs,
    randomPauseEnabled: prefs.appleRandomPauseEnabled,
    randomPauseMinMs: prefs.appleRandomPauseMinMs,
    randomPauseMaxMs: prefs.appleRandomPauseMaxMs,
    onRequest
  };
}

/** Pick the native Apple storefront suggested by the track's script. */
export function detectStorefrontForTrack(
  track: NormalizedTrack,
  mode: MatchPreferences["cjkDetection"]
): string | undefined {
  const text = `${track.originalName} ${track.artists.join(" ")} ${track.albumName ?? ""}`;
  const hasKana = /[぀-ゟ゠-ヿ]/u.test(text);
  const hasHangul = /[가-힯ᄀ-ᇿ]/u.test(text);
  const hasHan = /[一-鿿㐀-䶿]/u.test(text);
  if (hasHangul) return "kr";
  if (hasKana) return "jp";
  if (hasHan) {
    if (mode === "source") {
      return track.source.provider === "qq" || track.source.provider === "netease" ? "cn" : "jp";
    }
    return "jp";
  }
  return undefined;
}

function buildArtworkUrl(song: AppleSong): string | undefined {
  const url = song.attributes.artwork?.url;
  return url?.replace("{w}", "200").replace("{h}", "200");
}

function toCandidate(track: NormalizedTrack, retrieved: RetrievedAppleSong, prefs: MatchPreferences): AppleCandidate {
  const breakdown = scoreAppleSong(track, retrieved.song, prefs);
  const song = retrieved.song;
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
    score: breakdown.total,
    scoreBreakdown: breakdown,
    evidence: breakdown.evidence,
    isrc: song.attributes.isrc,
    storefront: retrieved.storefront,
    provenance: retrieved.provenance
  };
}

function candidateToSong(candidate: AppleCandidate): AppleSong {
  return {
    id: candidate.id,
    type: "songs",
    attributes: {
      name: candidate.name,
      artistName: candidate.artistName,
      albumName: candidate.albumName ?? "",
      durationInMillis: candidate.durationMs,
      releaseDate: candidate.releaseDate,
      isrc: candidate.isrc,
      url: candidate.url,
      contentRating: candidate.contentRating,
      artwork: candidate.artworkUrl ? { url: candidate.artworkUrl } : undefined
    }
  };
}

function syntheticRetrieval(results: readonly AppleSong[], storefront: string): AppleRetrievalDiagnostics {
  return {
    outcome: "success",
    queryBudget: 1,
    queries: [
      {
        queryId: "saved-candidates",
        variant: "base_title",
        term: "saved candidates",
        storefront,
        required: true,
        status: "success",
        candidateCount: results.length
      }
    ],
    uniqueCandidateCount: results.length,
    earlyStopped: false,
    cacheHits: 0
  };
}

export async function matchSingleTrack(
  track: NormalizedTrack,
  results: AppleSong[],
  storefront: string,
  prefs: MatchPreferences,
  chooseCover: CoverSimilarityChooser = chooseByCoverSimilarity
): Promise<AppleMatchResult> {
  const contextual = artistAliasSnapshotFromContext();
  if (contextual) {
    return matchSingleTrackWithLoadedAliases(track, results, storefront, prefs, chooseCover);
  }
  const snapshot = await loadArtistAliasCatalogSnapshot();
  return runWithArtistAliasSnapshot(snapshot, () =>
    matchSingleTrackWithLoadedAliases(track, results, storefront, prefs, chooseCover)
  );
}

function matchSingleTrackWithLoadedAliases(
  track: NormalizedTrack,
  results: AppleSong[],
  storefront: string,
  prefs: MatchPreferences,
  chooseCover: CoverSimilarityChooser
): Promise<AppleMatchResult> {
  const retrieval = syntheticRetrieval(results, storefront);
  if (results.length === 0) {
    return Promise.resolve({
      track,
      status: "not_found",
      candidates: [],
      scoringVersion: prefs.scoringVersion,
      retrieval,
      reason: `No results from Apple Music search (attempted saved candidates in ${storefront})`
    });
  }

  const retrieved = results.map(
    (song, index): RetrievedAppleSong => ({
      song,
      storefront,
      firstSeen: index,
      provenance: [
        {
          queryId: "saved-candidates",
          variant: "base_title",
          term: "saved candidates",
          storefront,
          rank: index + 1
        }
      ]
    })
  );
  const candidates = retrieved.map((item) => toCandidate(track, item, prefs));
  return resolveRecordingDecision(track, candidates, prefs, storefront, chooseCover, retrieval);
}

function hasDeterministicRecording(
  track: NormalizedTrack,
  values: Iterable<RetrievedAppleSong>,
  prefs: MatchPreferences
): boolean {
  for (const item of values) {
    const evidence = scoreAppleRecordingEvidence(track, item.song, prefs);
    if (evidence.deterministicIdentity && evidence.automaticEligible) return true;
  }
  return false;
}

async function runQuery(
  query: AppleQueryPlanItem,
  session: AppleApiSession,
  cache: QueryCache
): Promise<{ songs: AppleSong[]; fromCache: boolean }> {
  const key = appleQueryCacheKey(query.term, query.storefront);
  const cached = cache.get(key);
  if (cached) return { songs: await cached, fromCache: true };
  const pending = session.search(query.term, query.storefront);
  cache.set(key, pending);
  return { songs: await pending, fromCache: false };
}

async function retrieveTrackCandidates(
  track: NormalizedTrack,
  trackIndex: number,
  accountStorefront: string,
  prefs: MatchPreferences,
  session: AppleApiSession,
  cache: QueryCache,
  logger: (event: AppleMatchLogEvent) => void,
  jobId: string | undefined
): Promise<RetrievalResult> {
  const plan = queryPlanForTrack(track, accountStorefront, prefs, detectStorefrontForTrack);
  const union = new Map<string, RetrievedAppleSong>();
  let ordinal = 0;
  let successfulResponses = 0;
  let earlyStopped = false;
  let cacheHits = 0;
  const queries: AppleRetrievalDiagnostics["queries"] = [];

  for (const query of plan) {
    if (query.fallback && hasDeterministicRecording(track, union.values(), prefs)) break;
    const startedAt = performance.now();
    try {
      const { songs, fromCache } = await runQuery(query, session, cache);
      successfulResponses += 1;
      if (fromCache) cacheHits += 1;
      unionAppleSearchCandidates(union, songs, query, () => ordinal++);
      queries.push({
        queryId: query.id,
        variant: query.variant,
        term: query.term,
        storefront: query.storefront,
        required: query.required,
        status: "success",
        candidateCount: songs.length,
        fromCache: fromCache || undefined
      });
      logger({
        event: "stage",
        jobId,
        stage: "search",
        trackIndex,
        durationMs: durationSince(startedAt),
        outcome: "success"
      });
      if (hasDeterministicRecording(track, union.values(), prefs)) {
        earlyStopped = true;
        break;
      }
    } catch (error) {
      queries.push({
        queryId: query.id,
        variant: query.variant,
        term: query.term,
        storefront: query.storefront,
        required: query.required,
        status: "failed",
        candidateCount: 0,
        reason: error instanceof Error ? error.message : String(error)
      });
      logger({
        event: "stage",
        jobId,
        stage: "search",
        trackIndex,
        durationMs: durationSince(startedAt),
        outcome: "error"
      });
      if (query.required && successfulResponses === 0) {
        return {
          candidates: [],
          requiredFailure: error,
          diagnostics: {
            outcome: "failed",
            queryBudget: plan.length,
            queries,
            uniqueCandidateCount: 0,
            earlyStopped: false,
            cacheHits
          }
        };
      }
      // Optional failures are isolated; later passes may still complete.
    }
  }

  const candidates = [...union.values()]
    .sort((left, right) => left.firstSeen - right.firstSeen)
    .slice(0, MAX_RETRIEVED_CANDIDATES);
  return {
    candidates,
    diagnostics: {
      outcome: successfulResponses > 0 ? "success" : "failed",
      queryBudget: plan.length,
      queries,
      uniqueCandidateCount: candidates.length,
      earlyStopped,
      cacheHits
    }
  };
}

async function resolveCandidateId(
  candidate: AppleCandidate,
  accountStore: string,
  session: AppleApiSession
): Promise<string> {
  if (candidate.addableId) return candidate.addableId;
  if (!candidate.storefront || candidate.storefront === accountStore) {
    candidate.addableId = candidate.id;
    return candidate.id;
  }
  if (!candidate.isrc) return candidate.id;
  try {
    const matches = await session.songsByIsrc(candidate.isrc, accountStore);
    if (matches.length > 0) {
      candidate.addableId = matches[0].id;
      return candidate.addableId;
    }
  } catch {
    // Cross-store bridging is best-effort and not a retrieval failure.
  }
  return candidate.id;
}

async function processTrack(
  track: NormalizedTrack,
  trackIndex: number,
  accountStore: string,
  prefs: MatchPreferences,
  session: AppleApiSession,
  cache: QueryCache,
  artworkComparator: ArtworkComparator,
  logger: (event: AppleMatchLogEvent) => void,
  jobId: string | undefined
): Promise<AppleMatchResult> {
  const retrieval = await retrieveTrackCandidates(
    track,
    trackIndex,
    accountStore,
    prefs,
    session,
    cache,
    logger,
    jobId
  );
  if (retrieval.requiredFailure) {
    return requestFailedResult(track, retrieval.requiredFailure, "search", retrieval.diagnostics);
  }
  if (retrieval.candidates.length === 0) {
    const attempted = retrieval.diagnostics.queries
      .map((query) => `${query.variant} "${query.term}" (${query.storefront}, ${query.status})`)
      .join("; ");
    return {
      track,
      status: "not_found",
      candidates: [],
      scoringVersion: prefs.scoringVersion,
      retrieval: retrieval.diagnostics,
      reason: `No results from Apple Music search after ${retrieval.diagnostics.queries.length} bounded passes: ${attempted}`
    };
  }

  const candidates = retrieval.candidates.map((item) => toCandidate(track, item, prefs));
  const evaluationStartedAt = performance.now();
  const result = await resolveRecordingDecision(
    track,
    candidates,
    prefs,
    accountStore,
    async (sourceTrack, plausibleCandidates) => {
      const artworkStartedAt = performance.now();
      try {
        return await artworkComparator.choose(sourceTrack, plausibleCandidates);
      } catch {
        return undefined;
      } finally {
        logger({
          event: "stage",
          jobId,
          stage: "artwork",
          trackIndex,
          durationMs: durationSince(artworkStartedAt)
        });
      }
    },
    retrieval.diagnostics
  );
  logger({
    event: "stage",
    jobId,
    stage: "candidate_evaluation",
    trackIndex,
    durationMs: durationSince(evaluationStartedAt),
    outcome: "success"
  });

  if (result.selectedId && result.candidates) {
    const selected = result.candidates.find((candidate) => candidate.id === result.selectedId);
    if (selected) {
      if (selected.storefront === accountStore) {
        selected.addableId = selected.id;
      } else {
        const isrcStartedAt = performance.now();
        result.appleMusicId = await resolveCandidateId(selected, accountStore, session);
        logger({
          event: "stage",
          jobId,
          stage: "isrc",
          trackIndex,
          durationMs: durationSince(isrcStartedAt),
          outcome: selected.addableId ? "success" : "error"
        });
      }
    }
  }
  return result;
}

export async function matchAppleMusic(
  playlist: NormalizedPlaylist,
  prefs: MatchPreferences = DEFAULT_MATCH_PREFERENCES,
  onProgress?: (processed: number, total: number, result: AppleMatchResult) => void,
  execution: AppleMatchExecutionOptions = {}
): Promise<AppleMatchReport> {
  if (!execution.sessionFactory) {
    const cookies = await loadCookies("apple");
    if (!cookies || cookies.length === 0) {
      return {
        provider: playlist.provider,
        playlistId: playlist.id,
        playlistName: playlist.name,
        scoringVersion: prefs.scoringVersion,
        results: playlist.tracks.map((track) => ({
          track,
          status: "not_implemented",
          scoringVersion: prefs.scoringVersion,
          reason: "Not logged in to Apple Music. Please log in from Settings."
        }))
      };
    }
  }

  const logger = safeLogger(execution.logger ?? defaultMatchLogger);
  const sessionFactory = execution.sessionFactory ?? createAppleApiSession;
  const artworkComparatorFactory = execution.artworkComparatorFactory ?? createArtworkComparator;
  const jobStartedAt = performance.now();
  const jobId = playlist.id;
  let session: AppleApiSession;
  const sessionStartedAt = performance.now();
  try {
    session = await sessionFactory(
      apiSessionOptions(prefs, (metric) => {
        logger({
          event: "request",
          jobId,
          durationMs: Math.round(metric.durationMs * 100) / 100,
          operation: metric.operation,
          attempt: metric.attempt,
          outcome: metric.outcome,
          status: metric.status
        });
      })
    );
    logger({
      event: "stage",
      jobId,
      stage: "session",
      durationMs: durationSince(sessionStartedAt),
      outcome: "success"
    });
  } catch (error) {
    logger({ event: "stage", jobId, stage: "session", durationMs: durationSince(sessionStartedAt), outcome: "error" });
    return {
      provider: playlist.provider,
      playlistId: playlist.id,
      playlistName: playlist.name,
      scoringVersion: prefs.scoringVersion,
      results: playlist.tracks.map((track) => requestFailedResult(track, error, "session"))
    };
  }

  const artworkComparator = artworkComparatorFactory({ timeoutMs: prefs.artworkTimeoutMs });
  const queryCache: QueryCache = new Map();
  try {
    let accountStore = prefs.storefront.trim();
    if (!accountStore) {
      try {
        accountStore = await session.getStorefront();
      } catch {
        accountStore = "us";
      }
    }

    const total = playlist.tracks.length;
    const aliasSnapshot = await loadArtistAliasCatalogSnapshot();
    const results = await runWithArtistAliasSnapshot(aliasSnapshot, () =>
      mapWithConcurrency(
        playlist.tracks,
        execution.concurrency ?? prefs.matchConcurrency,
        async (track, trackIndex): Promise<AppleMatchResult> => {
          const trackStartedAt = performance.now();
          let outcome: "success" | "error" = "success";
          try {
            return await processTrack(
              track,
              trackIndex,
              accountStore,
              prefs,
              session,
              queryCache,
              artworkComparator,
              logger,
              jobId
            );
          } catch (error) {
            outcome = "error";
            return requestFailedResult(track, error, "search");
          } finally {
            logger({
              event: "stage",
              jobId,
              stage: "track",
              trackIndex,
              durationMs: durationSince(trackStartedAt),
              outcome
            });
          }
        },
        (result, _index, completed) => onProgress?.(completed, total, result)
      )
    );

    return {
      provider: playlist.provider,
      playlistId: playlist.id,
      playlistName: playlist.name,
      scoringVersion: prefs.scoringVersion,
      results
    };
  } finally {
    await Promise.allSettled([artworkComparator.close(), session.close()]);
    const stats = session.getStats();
    logger({
      event: "job_complete",
      jobId,
      stage: "job",
      durationMs: durationSince(jobStartedAt),
      processedTracks: playlist.tracks.length,
      requestCount: stats.requestCount,
      retryCount: stats.retryCount
    });
  }
}

export async function retryNotFoundAppleMusic(
  report: AppleMatchReport,
  prefs: MatchPreferences = DEFAULT_MATCH_PREFERENCES,
  onProgress?: (processed: number, total: number, result: AppleMatchResult) => void,
  execution: AppleMatchExecutionOptions = {}
): Promise<AppleMatchReport> {
  return retryAppleMusicResults(report, getNotFoundIndices(report.results), prefs, onProgress, execution);
}

export async function retryAppleMusicResults(
  report: AppleMatchReport,
  indices: readonly number[],
  prefs: MatchPreferences = DEFAULT_MATCH_PREFERENCES,
  onProgress?: (processed: number, total: number, result: AppleMatchResult) => void,
  execution: AppleMatchExecutionOptions = {}
): Promise<AppleMatchReport> {
  const retryIndices = Array.from(new Set(indices)).filter(
    (index) => Number.isInteger(index) && index >= 0 && index < report.results.length
  );
  if (retryIndices.length === 0) return report;

  const retryPlaylist: NormalizedPlaylist = {
    provider: report.provider,
    id: report.playlistId,
    name: report.playlistName,
    tracks: retryIndices.map((index) => report.results[index].track),
    raw: {}
  };
  const retryReport = await matchAppleMusic(retryPlaylist, prefs, onProgress, execution);
  const results = report.results.slice();
  retryIndices.forEach((index, position) => {
    const next = retryReport.results[position];
    if (next) results[index] = next;
  });
  return { ...report, scoringVersion: prefs.scoringVersion, results };
}

function shouldRefreshExistingCandidates(
  result: AppleMatchResult
): result is AppleMatchResult & { candidates: AppleCandidate[] } {
  if (
    result.selectionSource === "manual" ||
    result.selectionSource === "agent" ||
    result.agentAttempt ||
    !result.candidates?.length
  )
    return false;
  return result.status === "ambiguous" || result.status === "not_found" || result.status === "score_rejected";
}

function mergePreservedCandidateFields(refreshed: AppleMatchResult, previous: AppleCandidate[]): AppleMatchResult {
  if (!refreshed.candidates) return refreshed;
  const byKey = new Map(previous.map((candidate) => [`${candidate.storefront ?? ""}:${candidate.id}`, candidate]));
  const candidates = refreshed.candidates.map((candidate) => {
    const old =
      byKey.get(`${candidate.storefront ?? ""}:${candidate.id}`) ?? previous.find((item) => item.id === candidate.id);
    return old
      ? {
          ...candidate,
          addableId: old.addableId,
          artworkUrl: old.artworkUrl ?? candidate.artworkUrl,
          storefront: old.storefront ?? candidate.storefront,
          provenance: old.provenance ?? candidate.provenance
        }
      : candidate;
  });
  const selected = refreshed.selectedId
    ? candidates.find((candidate) => candidate.id === refreshed.selectedId)
    : undefined;
  return {
    ...refreshed,
    candidates,
    appleMusicId: selected?.addableId ?? refreshed.appleMusicId,
    appleMusicUrl: selected?.url ?? refreshed.appleMusicUrl
  };
}

function resultChanged(previous: AppleMatchResult, next: AppleMatchResult): boolean {
  if (previous.status !== next.status || previous.selectedId !== next.selectedId || previous.reason !== next.reason)
    return true;
  const left = previous.candidates ?? [];
  const right = next.candidates ?? [];
  return (
    left.length !== right.length ||
    right.some((candidate, index) => left[index]?.id !== candidate.id || left[index]?.score !== candidate.score)
  );
}

export async function refreshAppleMatchReportCandidates(
  report: AppleMatchReport,
  prefs: MatchPreferences = DEFAULT_MATCH_PREFERENCES
): Promise<AppleMatchReport> {
  const results: AppleMatchResult[] = [];
  let changed = false;
  const artworkComparator = createArtworkComparator({ timeoutMs: prefs.artworkTimeoutMs });
  try {
    const aliasSnapshot = await loadArtistAliasCatalogSnapshot();
    await runWithArtistAliasSnapshot(aliasSnapshot, async () => {
      for (const result of report.results) {
        if (!shouldRefreshExistingCandidates(result)) {
          results.push(result);
          continue;
        }
        try {
          const storefront =
            (result.candidates.find((candidate) => candidate.storefront)?.storefront ?? prefs.storefront) || "us";
          const refreshed = mergePreservedCandidateFields(
            await matchSingleTrackWithLoadedAliases(
              result.track,
              result.candidates.map(candidateToSong),
              storefront,
              prefs,
              (track, candidates) => artworkComparator.choose(track, candidates)
            ),
            result.candidates
          );
          results.push(refreshed);
          changed ||= resultChanged(result, refreshed);
        } catch {
          results.push(result);
        }
      }
    });
  } finally {
    await artworkComparator.close();
  }
  return changed ? { ...report, scoringVersion: prefs.scoringVersion, results } : report;
}

export async function resolveAppleMusicTrackIds(
  report: AppleMatchReport,
  accountStore: string,
  session: AppleApiSession,
  concurrency = DEFAULT_MATCH_PREFERENCES.matchConcurrency
): Promise<string[]> {
  const matched = report.results.filter((result) => result.status === "matched");
  const resolved = await mapWithConcurrency(matched, concurrency, async (result) => {
    const selected = result.candidates?.find((candidate) => candidate.id === result.selectedId);
    if (!selected) return result.appleMusicId;
    const id = await resolveCandidateId(selected, accountStore, session);
    result.appleMusicId = id;
    return id;
  });
  return resolved.filter((id): id is string => Boolean(id));
}

export async function createAppleMusicPlaylist(name: string, description: string, trackIds: string[]): Promise<string> {
  return appleCreatePlaylist(name, description, trackIds);
}

export async function createAppleMusicPlaylistFromReport(
  report: AppleMatchReport,
  prefs: MatchPreferences,
  name: string,
  description: string,
  execution: AppleMatchExecutionOptions = {}
): Promise<string> {
  const sessionFactory = execution.sessionFactory ?? createAppleApiSession;
  const session = await sessionFactory(apiSessionOptions(prefs));
  try {
    let accountStore = prefs.storefront.trim();
    if (!accountStore) accountStore = await session.getStorefront().catch(() => "us");
    const trackIds = await resolveAppleMusicTrackIds(
      report,
      accountStore,
      session,
      execution.concurrency ?? prefs.matchConcurrency
    );
    if (trackIds.length === 0) throw new Error("No matched tracks to add to playlist");
    return session.createPlaylist(name, description, trackIds);
  } finally {
    await session.close();
  }
}
