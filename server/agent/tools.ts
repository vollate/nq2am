import type { AgentAliasResult, AgentCandidateView, AgentConclusion } from "../../src/agent/types.js";
import type { AppleApiSession, AppleSong } from "../../src/apple/api.js";
import { REVIEWED_ARTIST_ALIASES } from "../../src/apple/artistAliases.js";
import type { ArtistAliasSnapshot } from "../../src/apple/artistAliasIndex.js";
import { aliasKey, parseRecordingMetadata } from "../../src/apple/recordingMetadata.js";
import { compareVersionRelation } from "../../src/apple/versionSemantics.js";
import type { AppleCandidate, AppleMatchResult, MatchPreferences } from "../../src/types.js";
import { AgentError } from "./llm.js";
import { parseToolArguments } from "./protocol.js";
import type { AgentTrace } from "./storage.js";

export function lookupAliases(names: string[], snapshot: ArtistAliasSnapshot): AgentAliasResult {
  let remainingGroups = 5;
  return {
    available: !!snapshot.refreshedAt,
    version: snapshot.refreshedAt ?? null,
    results: [...new Set(names.map(aliasKey))].sort().map((name) => {
      const ids =
        snapshot.groupsByKey?.get(name) ?? (snapshot.groupByKey.has(name) ? [snapshot.groupByKey.get(name)!] : []);
      let groups = ids.map((id) => [...(snapshot.namesByGroup?.get(id) ?? [])]);
      // Version-controlled aliases remain available without downloading the catalog.
      if (!groups.length)
        groups = REVIEWED_ARTIST_ALIASES.map((g) => g.map(aliasKey).sort()).filter((g) => g.includes(name));
      const ambiguous = ids.length > 1;
      const count = groups.length;
      groups = groups.slice(0, remainingGroups);
      remainingGroups -= groups.length;
      return {
        name,
        status: ambiguous ? "ambiguous" : count ? "found" : snapshot.refreshedAt ? "not_found" : "unavailable",
        groups: groups.map((aliases) => ({ aliases: aliases.slice(0, 20), truncated: aliases.length > 20 })),
        truncated: count > groups.length
      };
    })
  };
}

export type QueryCache = Map<string, AppleSong[]>;
export function versionConflict(source: string, candidate: string): boolean {
  return compareVersionRelation(parseRecordingMetadata(source), parseRecordingMetadata(candidate)) === "conflict";
}
function fromSong(song: AppleSong, storefront: string): AppleCandidate {
  if (
    !song ||
    typeof song.id !== "string" ||
    !song.id ||
    song.type !== "songs" ||
    typeof song.attributes?.name !== "string" ||
    typeof song.attributes?.artistName !== "string"
  )
    throw new AgentError("Invalid Apple catalog response");
  const a = song.attributes;
  return {
    id: song.id,
    name: a.name,
    artistName: a.artistName,
    albumName: a.albumName,
    durationMs: a.durationInMillis,
    isrc: a.isrc,
    url: a.url,
    releaseDate: a.releaseDate,
    contentRating: a.contentRating,
    storefront,
    score: 0
  };
}

export class TrackTools {
  private readonly candidates = new Map<string, AppleCandidate>();
  private readonly known = new Map<string, string>();
  private readonly evidence = new Set<string>();
  private readonly ambiguousAliasEvidence = new Set<string>();
  private readonly originalKeys: string[] = [];
  queries = 0;
  constructor(
    readonly original: AppleMatchResult,
    private readonly session: AppleApiSession,
    private readonly aliases: ArtistAliasSnapshot,
    private readonly prefs: MatchPreferences,
    readonly accountStore: string,
    private readonly cache: QueryCache,
    private readonly signal: AbortSignal,
    private readonly trace: AgentTrace
  ) {
    for (const candidate of original.candidates ?? [])
      this.originalKeys.push(this.register(structuredClone(candidate)));
  }
  private register(candidate: AppleCandidate): string {
    const identity = `${candidate.storefront ?? "unknown"}:${candidate.id}`;
    const existing = this.known.get(identity);
    if (existing) return existing;
    const key = `candidate-${this.candidates.size + 1}`;
    this.known.set(identity, key);
    this.candidates.set(key, candidate);
    return key;
  }
  private view(key: string): AgentCandidateView {
    this.evidence.add(key);
    const c = this.candidates.get(key)!;
    return {
      candidateKey: key,
      name: c.name,
      artistName: c.artistName,
      albumName: c.albumName,
      durationMs: c.durationMs,
      isrc: c.isrc,
      storefront: c.storefront
    };
  }
  initialCandidates(): AgentCandidateView[] {
    return this.originalKeys.slice(0, 5).map((key) => this.view(key));
  }
  private count(): void {
    this.signal.throwIfAborted();
    if (++this.queries > 16) throw new AgentError("Query tool limit exceeded");
  }
  private store(value: string): string {
    if (!/^[a-z]{2}$/.test(value)) throw new AgentError("Invalid storefront");
    if (!this.prefs.nativeSearch && value !== this.accountStore && value !== this.prefs.storefront)
      throw new AgentError("Cross-store search disabled");
    return value;
  }
  private async query(kind: "search" | "isrc", term: string, store: string): Promise<AppleCandidate[]> {
    this.signal.throwIfAborted();
    const key = JSON.stringify([kind, store, term]);
    let songs = this.cache.get(key);
    if (!songs) {
      try {
        songs =
          kind === "search"
            ? await this.session.search(term, store, this.signal)
            : await this.session.songsByIsrc(term, store, this.signal);
      } catch {
        this.signal.throwIfAborted();
        throw new AgentError("Apple catalog query failed");
      }
      this.signal.throwIfAborted();
      this.cache.set(key, songs);
    }
    return songs.map((song) => fromSong(song, store)).sort((a, b) => a.id.localeCompare(b.id));
  }
  async execute(name: string, text: string, callId: string): Promise<unknown> {
    const args = parseToolArguments(name, text);
    if (name === "complete_match") throw new AgentError("Conclusion must be validated separately");
    this.count();
    let output: unknown;
    if (name === "lookup_artist_aliases") {
      const aliases = lookupAliases(args.names, this.aliases);
      if (aliases.results.some((result) => result.status === "ambiguous")) this.ambiguousAliasEvidence.add(callId);
      output = aliases;
    } else if (name === "get_track_candidates")
      output = {
        offset: args.offset,
        total: this.originalKeys.length,
        candidates: this.originalKeys.slice(args.offset, args.offset + args.limit).map((key) => this.view(key))
      };
    else {
      const store = this.store(args.storefront);
      const candidates = (
        await this.query(name === "search_apple_music" ? "search" : "isrc", args.term ?? args.isrc, store)
      ).slice(0, args.limit ?? 10);
      output = {
        offset: 0,
        total: candidates.length,
        candidates: candidates.map((candidate) => this.view(this.register(candidate)))
      };
    }
    this.evidence.add(callId);
    return output;
  }
  async complete(text: string): Promise<{ conclusion: AgentConclusion; selected?: AppleCandidate }> {
    const conclusion = parseToolArguments("complete_match", text) as AgentConclusion;
    this.signal.throwIfAborted();
    if (conclusion.evidence.some((ref) => !this.evidence.has(ref))) throw new AgentError("Unknown evidence reference");
    if (conclusion.outcome !== "matched") {
      if (conclusion.candidateKey) throw new AgentError("Non-match conclusion cannot select a candidate");
      return { conclusion };
    }
    if (conclusion.evidence.some((ref) => this.ambiguousAliasEvidence.has(ref)))
      throw new AgentError("Ambiguous aliases cannot prove artist identity");
    const candidate = conclusion.candidateKey ? this.candidates.get(conclusion.candidateKey) : undefined;
    if (!candidate || !conclusion.evidence.includes(conclusion.candidateKey!))
      throw new AgentError("Unknown or uncited candidateKey");
    if (versionConflict(this.original.track.originalName, candidate.name))
      throw new AgentError("Explicit recording version conflict");
    const selected = { ...candidate };
    // Never trust an old addableId from another account/storefront. Verify foreign IDs by ISRC now.
    if (candidate.storefront === this.accountStore) selected.addableId = candidate.id;
    else {
      if (candidate.isrc && /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/.test(candidate.isrc)) {
        this.count();
        await this.trace({ event: "mapping_request", isrc: candidate.isrc, storefront: this.accountStore });
        const matches = await this.query("isrc", candidate.isrc, this.accountStore);
        await this.trace({ event: "mapping_result", candidates: matches });
        const mapped = matches.find(
          (c) =>
            c.isrc === candidate.isrc &&
            !versionConflict(candidate.name, c.name) &&
            !versionConflict(this.original.track.originalName, c.name)
        );
        selected.addableId = mapped?.id;
      } else selected.addableId = undefined;
      if (!selected.addableId)
        return {
          conclusion: {
            outcome: "uncertain",
            reason: "Account-store availability could not be verified",
            evidence: conclusion.evidence
          }
        };
    }
    this.signal.throwIfAborted();
    return { conclusion, selected };
  }
  applied(selected: AppleCandidate): AppleMatchResult {
    const candidates = [...(this.original.candidates ?? [])];
    const index = candidates.findIndex((c) => c.id === selected.id && c.storefront === selected.storefront);
    if (index >= 0) candidates[index] = selected;
    else candidates.push(selected);
    const result = {
      ...this.original,
      status: "matched" as const,
      selectedId: selected.id,
      appleMusicId: selected.addableId,
      appleMusicUrl: selected.url,
      selectionSource: "agent" as const,
      candidates,
      reason: undefined
    };
    delete result.requestFailure;
    return result;
  }
}
