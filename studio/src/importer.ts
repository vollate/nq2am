import { createHash } from "node:crypto";
import { constants, type Dirent } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ObservabilityStorage } from "@mastra/core/storage";
import {
  object,
  parseEvents,
  projectedManifest,
  projectTrack,
  type SkipReason,
  SkipTrace,
  traceIdFor
} from "./project.js";

const runName = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const trackName = /^track-(0|[1-9][0-9]*)$/;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
export const AUTO_REFRESH_MIN_INTERVAL_MS = 1000;
type SourceSnapshot = { stamp: string; skipped?: SkipReason };
type ManifestSnapshot = { stamp: string; value: ReturnType<typeof projectedManifest>; fingerprint: string };
export type ImportReport = {
  imported: number;
  unchanged: number;
  skipped: Array<{ path: string; reason: SkipReason | "unreadable" }>;
  completedAt: string | null;
};

/** Nanosecond timestamps plus inode/ctime detect append, same-size edits, and atomic replacement. Never follow symlinks. */
async function fileStamp(path: string): Promise<string> {
  const info = await lstat(path, { bigint: true });
  if (!info.isFile() || info.size > BigInt(MAX_FILE_BYTES)) throw new Error("Invalid source file");
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
}

async function readLocalFile(path: string): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error("Invalid source file");
    // A bounded read even if another process appends while we read it.
    const bytes = Buffer.alloc(info.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const read = await file.read(bytes, size, bytes.length - size, size);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    if (size > info.size) throw new SkipTrace("incomplete");
    return bytes.subarray(0, size).toString("utf8");
  } finally {
    await file.close();
  }
}

/** An offline, serialized indexer. Source files are opened read-only; only Mastra's derived DB is written. */
export class LogImporter {
  private pending?: Promise<ImportReport>;
  private readonly fingerprints = new Map<string, string>();
  private readonly sources = new Map<string, SourceSnapshot>();
  private readonly manifests = new Map<string, ManifestSnapshot>();
  private scannedAt = -Infinity;
  report: ImportReport = { imported: 0, unchanged: 0, skipped: [], completedAt: null };
  constructor(
    private readonly dataDir: string,
    private readonly storage: ObservabilityStorage,
    private readonly now: () => number = Date.now
  ) {}

  /** Called before Studio reads traces. Coalesce simultaneous requests and cap scans during UI fan-out. */
  refresh(): Promise<ImportReport> {
    if (this.pending) return this.pending;
    const elapsed = this.now() - this.scannedAt;
    if (elapsed >= 0 && elapsed < AUTO_REFRESH_MIN_INTERVAL_MS) return Promise.resolve(this.report);
    return this.sync();
  }

  sync(): Promise<ImportReport> {
    if (!this.pending)
      this.pending = this.scan()
        .then((report) => {
          this.scannedAt = this.now();
          return report;
        })
        .finally(() => {
          this.pending = undefined;
        });
    return this.pending;
  }

  private async scan(): Promise<ImportReport> {
    const report: ImportReport = { imported: 0, unchanged: 0, skipped: [], completedAt: null };
    const runsDir = join(this.dataDir, "agent-runs");
    let runs: Dirent[];
    try {
      if (!(await lstat(runsDir)).isDirectory()) throw new Error("Invalid runs directory");
      runs = await readdir(runsDir, { withFileTypes: true });
    } catch (error) {
      if (object(error).code !== "ENOENT") report.skipped.push({ path: "agent-runs", reason: "unreadable" });
      report.completedAt = new Date().toISOString();
      this.report = report;
      return report;
    }
    for (const run of runs.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!run.isDirectory() || !runName.test(run.name)) continue;
      const runDir = join(runsDir, run.name);
      let manifest: ManifestSnapshot;
      let tracks: Dirent[];
      try {
        const manifestFile = join(runDir, "manifest.json");
        const stamp = await fileStamp(manifestFile);
        const cached = this.manifests.get(run.name);
        if (cached?.stamp === stamp) manifest = cached;
        else {
          const value = projectedManifest(JSON.parse(await readLocalFile(manifestFile)));
          manifest = { stamp, value, fingerprint: JSON.stringify(value) };
          this.manifests.set(run.name, manifest);
        }
        tracks = await readdir(runDir, { withFileTypes: true });
      } catch {
        report.skipped.push({ path: run.name, reason: "unreadable" });
        continue;
      }
      for (const track of tracks.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
        const match = trackName.exec(track.name);
        if (!track.isDirectory() || !match || !Number.isSafeInteger(Number(match[1]))) continue;
        const relativePath = `${run.name}/${track.name}`;
        const index = Number(match[1]);
        const traceId = traceIdFor(run.name, index);
        let stamp: string | undefined;
        try {
          const traceFile = join(runDir, track.name, "trace.jsonl");
          const resultFile = join(runDir, track.name, "result.json");
          const stamps = await Promise.all([fileStamp(traceFile), fileStamp(resultFile)]);
          stamp = JSON.stringify([manifest.fingerprint, ...stamps]);
          const cached = this.sources.get(traceId);
          if (cached?.stamp === stamp) {
            if (cached.skipped) report.skipped.push({ path: relativePath, reason: cached.skipped });
            else report.unchanged++;
            continue;
          }
          const [traceText, resultText] = await Promise.all([readLocalFile(traceFile), readLocalFile(resultFile)]);
          const fingerprint = createHash("sha256")
            .update("nq2am-studio-projection-v4\0")
            .update(manifest.fingerprint)
            .update("\0")
            .update(traceText)
            .update("\0")
            .update(resultText)
            .digest("hex");
          if (this.fingerprints.get(traceId) === fingerprint) {
            this.sources.set(traceId, { stamp });
            report.unchanged++;
            continue;
          }
          const projection = projectTrack({
            runId: run.name,
            index,
            manifest: manifest.value,
            result: object(JSON.parse(resultText)),
            events: parseEvents(traceText)
          });
          const previous = await this.storage.getRootSpan({ traceId });
          if (previous?.span.metadata?.sourceFingerprint !== fingerprint) {
            // These IDs belong exclusively to this versioned, rebuildable projection, never to source logs.
            if (previous) await this.storage.batchDeleteTraces({ traceIds: [traceId] });
            projection.spans[0].metadata = { ...projection.spans[0].metadata, sourceFingerprint: fingerprint };
            await this.storage.batchCreateSpans({ records: projection.spans });
            report.imported++;
          } else report.unchanged++;
          this.fingerprints.set(traceId, fingerprint);
          this.sources.set(traceId, { stamp });
        } catch (error) {
          // Do not leave an old green success visible after the source has become inconsistent or corrupt.
          this.fingerprints.delete(traceId);
          this.sources.delete(traceId);
          // Only cache a skipped snapshot after stale derived data has actually been removed.
          let removed = false;
          try {
            await this.storage.batchDeleteTraces({ traceIds: [traceId] });
            removed = true;
          } catch {
            /* Retry storage errors on the next read; never cache them as unchanged. */
          }
          if (removed && stamp && error instanceof SkipTrace)
            this.sources.set(traceId, { stamp, skipped: error.reason });
          report.skipped.push({ path: relativePath, reason: error instanceof SkipTrace ? error.reason : "unreadable" });
        }
      }
    }
    report.completedAt = new Date().toISOString();
    this.report = report;
    return report;
  }
}
