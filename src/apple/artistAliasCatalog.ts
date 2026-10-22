import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getDataDir } from "../fetchers/auth.js";
import {
  type ArtistAliasCatalogFile,
  type ArtistAliasCatalogSource,
  type ArtistAliasSnapshot,
  emptyArtistAliasSnapshot,
  setLoadedArtistAliasSnapshot,
  snapshotFromCatalogFile
} from "./artistAliasIndex.js";
import { type DownloadRateSample, nextDownloadRate } from "./downloadRate.js";
import { aliasKey } from "./recordingMetadata.js";
import { aliasDumpCacheDir, downloadResumableFile, pruneDumpCache } from "./resumableDownload.js";
import { isXzBuffer, iterateTarStream, parseTar, xzChunks, xzChunksFromFile } from "./tarArchive.js";
import { unzipToMap } from "./zipArchive.js";

export const MUSICBRAINZ_ATTRIBUTION =
  "Artist name data from MusicBrainz (https://musicbrainz.org), dedicated to the public domain under CC0.";
export const VOCADB_ATTRIBUTION = "Artist name data from VocaDB (https://vocadb.net), licensed under CC BY 4.0.";
export const UTAITEDB_ATTRIBUTION = "Artist name data from UtaiteDB (https://utaitedb.net), licensed under CC BY 4.0.";
export const TOUHOUDB_ATTRIBUTION = "Artist name data from TouhouDB (https://touhoudb.com), licensed under CC BY 4.0.";

const MUSICBRAINZ_DUMP_INDEX = "https://data.metabrainz.org/pub/musicbrainz/data/json-dumps/";
const VOCADB_DUMP_URL = "https://vocaloid.eu/vocadb/dump.zip";
const UTAITEDB_DUMP_URL = "https://vocaloid.eu/utaitedb/dump.zip";
const TOUHOUDB_DUMP_URL = "https://vocaloid.eu/touhoudb/dump.zip";
const CATALOG_VERSION = 1 as const;
const CATALOG_FILE = "artist-alias-catalog.json";

const MUSICBRAINZ_SOURCE: ArtistAliasCatalogSource = {
  id: "musicbrainz",
  license: "CC0",
  attribution: MUSICBRAINZ_ATTRIBUTION,
  url: "https://musicbrainz.org/"
};

const VOCADB_SOURCE: ArtistAliasCatalogSource = {
  id: "vocadb",
  license: "CC BY 4.0",
  attribution: VOCADB_ATTRIBUTION,
  url: "https://vocadb.net/"
};

const UTAITEDB_SOURCE: ArtistAliasCatalogSource = {
  id: "utaitedb",
  license: "CC BY 4.0",
  attribution: UTAITEDB_ATTRIBUTION,
  url: "https://utaitedb.net/"
};

const TOUHOUDB_SOURCE: ArtistAliasCatalogSource = {
  id: "touhoudb",
  license: "CC BY 4.0",
  attribution: TOUHOUDB_ATTRIBUTION,
  url: "https://touhoudb.com/"
};

export type MusicBrainzAlias = {
  name?: string;
  locale?: string | null;
  type?: string | { name?: string } | null;
};

export type MusicBrainzArtist = {
  id?: string;
  name?: string;
  "sort-name"?: string;
  aliases?: MusicBrainzAlias[];
};

export type VocadbLocalizedName = {
  language?: string;
  value?: string;
};

export type VocadbArtist = {
  id?: number | string;
  names?: VocadbLocalizedName[];
  translatedName?: {
    japanese?: string;
    romaji?: string;
    english?: string;
  };
};

export type ArtistAliasDownloadContext = {
  signal: AbortSignal;
  onProgress?: (source: ArtistAliasCatalogSource["id"], received: number, total?: number) => void;
  onDumpDate?: (date: string) => void;
  onLocalPath?: (source: ArtistAliasCatalogSource["id"], path: string) => void;
};

export type ArtistAliasDumpFetcher = {
  fetchMusicBrainzArtistDump: (ctx?: ArtistAliasDownloadContext) => Promise<Uint8Array>;
  fetchVocadbDump: (ctx?: ArtistAliasDownloadContext) => Promise<Uint8Array>;
  fetchUtaitedbDump?: (ctx?: ArtistAliasDownloadContext) => Promise<Uint8Array>;
  fetchTouhoudbDump?: (ctx?: ArtistAliasDownloadContext) => Promise<Uint8Array>;
};

export type ArtistAliasCatalogProgress = {
  phase: "listing" | "downloading" | "compiling";
  bytesReceived: number;
  bytesTotal?: number;
  percent?: number;
  currentSource?: ArtistAliasCatalogSource["id"];
  bytesPerSecond?: number;
  etaSeconds?: number;
};

export type ArtistAliasCatalogStatus = {
  status: "idle" | "downloading" | "failed";
  refreshedAt?: string;
  dumpDate?: string;
  sources: ArtistAliasCatalogSource[];
  groupCount: number;
  sourceCounts?: Partial<Record<ArtistAliasCatalogSource["id"], number>>;
  error?: string;
  progress?: ArtistAliasCatalogProgress;
};

type TransferProgress = { received: number; total?: number };

const defaultFetcher: ArtistAliasDumpFetcher = {
  fetchMusicBrainzArtistDump: (ctx) => downloadMusicBrainzArtistDump(ctx),
  fetchVocadbDump: (ctx) => downloadFamilyDump(VOCADB_DUMP_URL, "vocadb", ctx),
  fetchUtaitedbDump: (ctx) => downloadFamilyDump(UTAITEDB_DUMP_URL, "utaitedb", ctx),
  fetchTouhoudbDump: (ctx) => downloadFamilyDump(TOUHOUDB_DUMP_URL, "touhoudb", ctx)
};

let refreshInFlight: Promise<ArtistAliasCatalogFile> | undefined;
let abortController: AbortController | undefined;
let lastError: string | undefined;
let statusBeforeDownload: ArtistAliasCatalogStatus | undefined;
let errorBeforeDownload: string | undefined;
let downloadEpoch = 0;
let statusSnapshot: ArtistAliasCatalogStatus = {
  status: "idle",
  sources: [],
  groupCount: 0
};

export function artistAliasCatalogPath(): string {
  return join(getDataDir(), CATALOG_FILE);
}

export function getArtistAliasCatalogStatus(): ArtistAliasCatalogStatus {
  return {
    ...statusSnapshot,
    status: refreshInFlight && statusSnapshot.status === "downloading" ? "downloading" : statusSnapshot.status
  };
}

export async function loadArtistAliasCatalogSnapshot(includeReverse = false): Promise<ArtistAliasSnapshot> {
  try {
    const raw = await readFile(artistAliasCatalogPath(), "utf8");
    const file = JSON.parse(raw) as ArtistAliasCatalogFile;
    if (file.version !== CATALOG_VERSION || !Array.isArray(file.groups)) {
      setLoadedArtistAliasSnapshot(emptyArtistAliasSnapshot());
      statusSnapshot = { status: "idle", sources: [], groupCount: 0 };
      return emptyArtistAliasSnapshot();
    }
    const snapshot = snapshotFromCatalogFile(file, includeReverse);
    setLoadedArtistAliasSnapshot(snapshot);
    statusSnapshot = {
      status: "idle",
      refreshedAt: file.refreshedAt,
      dumpDate: file.dumpDate,
      sources: file.sources,
      groupCount: file.groups.length,
      sourceCounts: file.sourceCounts
    };
    lastError = undefined;
    return snapshot;
  } catch {
    setLoadedArtistAliasSnapshot(emptyArtistAliasSnapshot());
    statusSnapshot = { status: lastError ? "failed" : "idle", sources: [], groupCount: 0, error: lastError };
    return emptyArtistAliasSnapshot();
  }
}

export function requestArtistAliasCatalogRefresh(
  fetcher: ArtistAliasDumpFetcher = defaultFetcher
): "started" | "already-running" {
  if (refreshInFlight) return "already-running";
  const previousStatus: ArtistAliasCatalogStatus = { ...statusSnapshot, progress: undefined };
  const previousError = lastError;
  statusBeforeDownload = previousStatus;
  errorBeforeDownload = previousError;
  abortController = new AbortController();
  const epoch = ++downloadEpoch;
  statusSnapshot = {
    ...statusSnapshot,
    status: "downloading",
    error: undefined,
    progress: { phase: "listing", bytesReceived: 0 }
  };
  refreshInFlight = compileAndReplace(fetcher, abortController.signal, previousStatus, previousError, epoch).finally(
    () => {
      if (downloadEpoch !== epoch) return;
      refreshInFlight = undefined;
      abortController = undefined;
      statusBeforeDownload = undefined;
      errorBeforeDownload = undefined;
    }
  );
  void refreshInFlight.catch(() => undefined);
  return "started";
}

export function cancelArtistAliasCatalogDownload(): boolean {
  if (!refreshInFlight || !abortController) return false;
  abortController.abort();
  lastError = errorBeforeDownload;
  if (statusBeforeDownload) {
    statusSnapshot = { ...statusBeforeDownload, progress: undefined };
  }
  downloadEpoch += 1;
  const pending = refreshInFlight;
  refreshInFlight = undefined;
  abortController = undefined;
  statusBeforeDownload = undefined;
  errorBeforeDownload = undefined;
  void pending.catch(() => undefined);
  return true;
}

export function artistAliasCatalogRefreshPromise(): Promise<ArtistAliasCatalogFile> | undefined {
  return refreshInFlight;
}

export async function refreshArtistAliasCatalog(
  fetcher: ArtistAliasDumpFetcher = defaultFetcher
): Promise<"started" | "already-running"> {
  const result = requestArtistAliasCatalogRefresh(fetcher);
  if (result === "already-running") return result;
  await refreshInFlight;
  return "started";
}

export async function readArtistAliasCatalogStatus(): Promise<ArtistAliasCatalogStatus> {
  if (refreshInFlight && statusSnapshot.status === "downloading") return getArtistAliasCatalogStatus();
  if (statusSnapshot.status === "failed") return getArtistAliasCatalogStatus();
  await loadArtistAliasCatalogSnapshot();
  return getArtistAliasCatalogStatus();
}

export function compileArtistAliasGroups(input: {
  musicbrainzArtists?: readonly MusicBrainzArtist[];
  vocadbArtists?: readonly VocadbArtist[];
}): string[][] {
  const groups: string[][] = [];
  for (const artist of input.musicbrainzArtists ?? []) {
    const group = compactDistinct(musicbrainzNames(artist));
    if (group.length >= 2) groups.push(group);
  }
  for (const artist of input.vocadbArtists ?? []) {
    const group = compactDistinct(vocadbNames(artist));
    if (group.length >= 2) groups.push(group);
  }
  return groups;
}

export function musicbrainzNames(artist: MusicBrainzArtist): string[] {
  const names: string[] = [];
  if (artist.name) names.push(artist.name);
  if (artist["sort-name"]) names.push(artist["sort-name"]);
  for (const alias of artist.aliases ?? []) {
    if (!alias.name || !includeMusicbrainzAlias(alias)) continue;
    names.push(alias.name);
  }
  return names;
}

export function vocadbNames(artist: VocadbArtist): string[] {
  const names: string[] = [];
  const translated = artist.translatedName;
  if (translated?.japanese) names.push(translated.japanese);
  if (translated?.romaji) names.push(translated.romaji);
  if (translated?.english) names.push(translated.english);
  for (const item of artist.names ?? []) {
    if (!item.value || !includeVocadbLanguage(item.language)) continue;
    names.push(item.value);
  }
  return names;
}

function includeMusicbrainzAlias(alias: MusicBrainzAlias): boolean {
  const type = aliasTypeName(alias).toLowerCase();
  if (type === "search hint" || type === "legal name") return false;
  const locale = (alias.locale ?? "").toLowerCase();
  if (!locale) return type === "artist name" || type === "";
  return locale.startsWith("ja") || locale.startsWith("en") || locale.startsWith("zh");
}

function aliasTypeName(alias: MusicBrainzAlias): string {
  if (typeof alias.type === "string") return alias.type;
  return alias.type?.name ?? "";
}

function includeVocadbLanguage(language: string | undefined): boolean {
  const value = (language ?? "").toLowerCase();
  return value === "japanese" || value === "romaji" || value === "english";
}

function compactDistinct(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const name of names) {
    const key = aliasKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

async function compileAndReplace(
  fetcher: ArtistAliasDumpFetcher,
  signal: AbortSignal,
  previousStatus: ArtistAliasCatalogStatus,
  previousError: string | undefined,
  epoch: number
): Promise<ArtistAliasCatalogFile> {
  const transfers: Record<ArtistAliasCatalogSource["id"], TransferProgress> = {
    musicbrainz: { received: 0 },
    vocadb: { received: 0 },
    utaitedb: { received: 0 },
    touhoudb: { received: 0 }
  };
  let dumpDate: string | undefined;
  let currentSource: ArtistAliasCatalogSource["id"] | undefined;
  let rateSamples: DownloadRateSample[] = [];

  const publishProgress = (phase: ArtistAliasCatalogProgress["phase"]): void => {
    if (epoch !== downloadEpoch || signal.aborted) return;
    const bytesReceived =
      transfers.musicbrainz.received +
      transfers.vocadb.received +
      transfers.utaitedb.received +
      transfers.touhoudb.received;
    const mbTotal = positiveByteCount(transfers.musicbrainz.total);
    const vocaTotal = positiveByteCount(transfers.vocadb.total);
    const utaiteTotal = positiveByteCount(transfers.utaitedb.total);
    const touhouTotal = positiveByteCount(transfers.touhoudb.total);
    const knownTotals = [mbTotal, vocaTotal, utaiteTotal, touhouTotal].filter(
      (value): value is number => value !== undefined
    );
    const bytesTotal =
      knownTotals.length > 0 ? (mbTotal ?? 0) + (vocaTotal ?? 0) + (utaiteTotal ?? 0) + (touhouTotal ?? 0) : undefined;
    let percent: number | undefined;
    let bytesPerSecond: number | undefined;
    let etaSeconds: number | undefined;
    if (phase === "downloading" && bytesTotal && bytesTotal > 0) {
      percent = Math.min(100, Math.round((bytesReceived / bytesTotal) * 100));
    }
    if (phase === "downloading") {
      const rate = nextDownloadRate(rateSamples, Date.now(), bytesReceived, bytesTotal);
      rateSamples = rate.samples;
      bytesPerSecond = rate.bytesPerSecond;
      etaSeconds = rate.etaSeconds;
    } else {
      rateSamples = [];
    }
    statusSnapshot = {
      ...statusSnapshot,
      status: "downloading",
      progress: {
        phase,
        bytesReceived,
        bytesTotal,
        percent,
        currentSource: phase === "downloading" ? currentSource : undefined,
        bytesPerSecond,
        etaSeconds
      }
    };
  };

  const localPaths: Partial<Record<ArtistAliasCatalogSource["id"], string>> = {};
  const ctx: ArtistAliasDownloadContext = {
    signal,
    onDumpDate: (date) => {
      dumpDate = date;
    },
    onLocalPath: (source, path) => {
      localPaths[source] = path;
    },
    onProgress: (source, received, total) => {
      if (epoch !== downloadEpoch || signal.aborted) return;
      currentSource = source;
      transfers[source] = { received, total: total ?? transfers[source].total };
      publishProgress("downloading");
    }
  };

  try {
    throwIfAborted(signal);
    publishProgress("listing");
    const mbDump = await fetcher.fetchMusicBrainzArtistDump(ctx);
    throwIfAborted(signal);
    const vocaDump = await fetcher.fetchVocadbDump(ctx);
    throwIfAborted(signal);
    const utaiteDump = fetcher.fetchUtaitedbDump ? await fetcher.fetchUtaitedbDump(ctx) : undefined;
    throwIfAborted(signal);
    const touhouDump = fetcher.fetchTouhoudbDump ? await fetcher.fetchTouhoudbDump(ctx) : undefined;
    throwIfAborted(signal);
    publishProgress("compiling");
    const musicbrainz = localPaths.musicbrainz
      ? await groupsFromMusicBrainzFile(localPaths.musicbrainz)
      : await groupsFromMusicBrainzDump(mbDump);
    const vocadb = groupsFromVocadbFamilyDump(vocaDump);
    const utaitedb = groupsFromVocadbFamilyDump(utaiteDump);
    const touhoudb = groupsFromVocadbFamilyDump(touhouDump);
    throwIfAborted(signal);
    if (epoch !== downloadEpoch) throw abortError();
    const sourceCounts = {
      musicbrainz: musicbrainz.length,
      vocadb: vocadb.length,
      utaitedb: utaitedb.length,
      touhoudb: touhoudb.length
    };
    const groups = [...musicbrainz, ...vocadb, ...utaitedb, ...touhoudb];
    const file: ArtistAliasCatalogFile = {
      version: CATALOG_VERSION,
      refreshedAt: new Date().toISOString(),
      dumpDate,
      sources: [
        MUSICBRAINZ_SOURCE,
        VOCADB_SOURCE,
        ...(utaiteDump ? [UTAITEDB_SOURCE] : []),
        ...(touhouDump ? [TOUHOUDB_SOURCE] : [])
      ],
      groups,
      sourceCounts
    };
    await writeCatalogAtomically(file);
    if (epoch !== downloadEpoch) return file;
    setLoadedArtistAliasSnapshot(snapshotFromCatalogFile(file));
    lastError = undefined;
    statusSnapshot = {
      status: "idle",
      refreshedAt: file.refreshedAt,
      dumpDate: file.dumpDate,
      sources: file.sources,
      groupCount: file.groups.length,
      sourceCounts: file.sourceCounts
    };
    return file;
  } catch (error) {
    if (epoch !== downloadEpoch) {
      throw isAbortError(error) || signal.aborted ? abortError() : error;
    }
    if (isAbortError(error) || signal.aborted) {
      lastError = previousError;
      statusSnapshot = { ...previousStatus, progress: undefined };
      throw abortError();
    }
    lastError = error instanceof Error ? error.message : String(error);
    statusSnapshot = {
      ...previousStatus,
      status: "failed",
      error: lastError,
      progress: undefined
    };
    throw error;
  }
}

async function writeCatalogAtomically(file: ArtistAliasCatalogFile): Promise<void> {
  const path = artistAliasCatalogPath();
  const tempPath = `${path}.${process.pid}.tmp`;
  await mkdir(getDataDir(), { recursive: true });
  await writeFile(tempPath, JSON.stringify(file), "utf8");
  await rename(tempPath, path);
}

async function groupsFromMusicBrainzDump(buffer: Uint8Array): Promise<string[][]> {
  const groups: string[][] = [];
  const add = (artist: MusicBrainzArtist): void => {
    const group = compactDistinct(musicbrainzNames(artist));
    if (group.length >= 2) groups.push(group);
  };
  if (isXzBuffer(buffer)) {
    let records = 0;
    for await (const artist of iterateMusicBrainzArtistsFromXzTar(xzChunks(buffer))) {
      records += 1;
      add(artist);
    }
    if (records === 0) {
      throw new Error("MusicBrainz artist dump decompressed but contained no artist records");
    }
    return groups;
  }
  for (const artist of parseMusicBrainzArtistDump(buffer)) add(artist);
  return groups;
}

async function groupsFromMusicBrainzFile(path: string): Promise<string[][]> {
  const header = Buffer.alloc(6);
  const handle = await open(path, "r");
  try {
    await handle.read(header, 0, 6, 0);
  } finally {
    await handle.close();
  }
  if (!isXzBuffer(header)) {
    return groupsFromMusicBrainzDump(await readFile(path));
  }
  const groups: string[][] = [];
  let records = 0;
  for await (const artist of iterateMusicBrainzArtistsFromXzTar(xzChunksFromFile(path))) {
    records += 1;
    const group = compactDistinct(musicbrainzNames(artist));
    if (group.length >= 2) groups.push(group);
  }
  if (records === 0) {
    throw new Error("MusicBrainz artist dump decompressed but contained no artist records");
  }
  return groups;
}

async function* iterateMusicBrainzArtistsFromXzTar(
  chunks: AsyncIterable<Uint8Array>
): AsyncGenerator<MusicBrainzArtist> {
  for await (const entry of iterateTarStream(chunks)) {
    if (!isMusicBrainzArtistEntry(entry.name)) {
      await entry.skip();
      continue;
    }
    let leftover = "";
    for (;;) {
      const chunk = await entry.read(64 * 1024);
      if (chunk.length === 0) break;
      leftover += chunk.toString("utf8");
      const lines = leftover.split(/\r?\n/u);
      leftover = lines.pop() ?? "";
      for (const line of lines) {
        const artist = parseMusicBrainzArtistLine(line);
        if (artist) yield artist;
      }
    }
    const last = parseMusicBrainzArtistLine(leftover);
    if (last) yield last;
  }
}

function isMusicBrainzArtistEntry(name: string): boolean {
  return (
    /artist\.jsonl$/i.test(name) ||
    /\/artist$/i.test(name) ||
    name === "artist" ||
    name.endsWith("artist") ||
    name.includes("artist.json")
  );
}

function parseMusicBrainzArtistLine(line: string): MusicBrainzArtist | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    return JSON.parse(trimmed) as MusicBrainzArtist;
  } catch {
    return undefined;
  }
}

function groupsFromVocadbFamilyDump(buffer: Uint8Array | undefined): string[][] {
  if (!buffer || buffer.byteLength === 0) return [];
  return compileArtistAliasGroups({ vocadbArtists: parseVocadbArtistDump(buffer) });
}

export function parseMusicBrainzArtistDump(tarBuffer: Uint8Array): MusicBrainzArtist[] {
  const artists: MusicBrainzArtist[] = [];
  for (const entry of parseTar(tarBuffer)) {
    if (!/artist\.jsonl$/i.test(entry.name) && !/\/artist$/i.test(entry.name) && entry.name !== "artist") {
      if (!entry.name.endsWith("artist") && !entry.name.includes("artist.json")) continue;
    }
    const text = entry.data.toString("utf8");
    if (text.startsWith("{") || text.startsWith("[")) {
      for (const line of text.split(/\r?\n/u)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          artists.push(JSON.parse(trimmed) as MusicBrainzArtist);
        } catch {
          // Skip malformed dump lines rather than failing the whole refresh.
        }
      }
    }
  }
  if (artists.length === 0) {
    const asText = Buffer.from(tarBuffer).toString("utf8");
    if (asText.includes("{")) {
      for (const line of asText.split(/\r?\n/u)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        try {
          artists.push(JSON.parse(trimmed) as MusicBrainzArtist);
        } catch {
          // ignore
        }
      }
    }
  }
  return artists;
}

export function parseVocadbArtistDump(zipBuffer: Uint8Array): VocadbArtist[] {
  const files = unzipToMap(zipBuffer, (name) => /artist/i.test(name) && /\.json$/i.test(name) && !name.endsWith("/"));
  const artists: VocadbArtist[] = [];
  for (const [name, data] of files) {
    if (!/artist/i.test(name) || name.endsWith("/")) continue;
    if (!/\.json$/i.test(name)) continue;
    try {
      const parsed: unknown = JSON.parse(data.toString("utf8"));
      pushVocadbRecords(parsed, artists);
    } catch {
      // Skip malformed dump files rather than failing the whole refresh.
    }
  }
  return artists;
}

function pushVocadbRecords(parsed: unknown, artists: VocadbArtist[]): void {
  if (Array.isArray(parsed)) {
    for (const item of parsed) pushVocadbRecords(item, artists);
    return;
  }
  if (!parsed || typeof parsed !== "object") return;
  const record = parsed as VocadbArtist & { artistType?: string; translatedName?: VocadbArtist["translatedName"] };
  if (record.translatedName || Array.isArray(record.names)) artists.push(record);
}

async function downloadFamilyDump(
  url: string,
  source: "vocadb" | "utaitedb" | "touhoudb",
  ctx?: ArtistAliasDownloadContext
): Promise<Uint8Array> {
  const dest = join(aliasDumpCacheDir(getDataDir()), `${source}-dump.zip`);
  await downloadResumableFile(url, dest, {
    signal: ctx?.signal,
    onProgress: (received, total) => ctx?.onProgress?.(source, received, total)
  });
  ctx?.onLocalPath?.(source, dest);
  return readFile(dest);
}

async function downloadMusicBrainzArtistDump(ctx?: ArtistAliasDownloadContext): Promise<Uint8Array> {
  const index = await downloadText(MUSICBRAINZ_DUMP_INDEX, ctx?.signal);
  const dates = [...index.matchAll(/href="(\d{8}-\d{6})\/"/g)].map((match) => match[1]);
  const latest = dates.sort().at(-1);
  if (!latest) throw new Error("MusicBrainz JSON dump listing had no dated snapshots");
  const dumpDate = musicBrainzSnapshotDate(latest);
  if (dumpDate) ctx?.onDumpDate?.(dumpDate);
  const fileName = `musicbrainz-${latest}-artist.tar.xz`;
  const dest = join(aliasDumpCacheDir(getDataDir()), fileName);
  await pruneDumpCache(aliasDumpCacheDir(getDataDir()), [fileName], "musicbrainz-");
  await downloadResumableFile(`${MUSICBRAINZ_DUMP_INDEX}${latest}/artist.tar.xz`, dest, {
    signal: ctx?.signal,
    onProgress: (received, total) => ctx?.onProgress?.("musicbrainz", received, total)
  });
  ctx?.onLocalPath?.("musicbrainz", dest);
  return new Uint8Array();
}

export function musicBrainzSnapshotDate(snapshotId: string): string | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})-\d{6}$/u.exec(snapshotId);
  if (!match) return undefined;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

async function downloadText(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Failed to download ${url} (${response.status})`);
  return response.text();
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function positiveByteCount(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function abortError(): Error {
  const error = new Error("Download cancelled");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
}
