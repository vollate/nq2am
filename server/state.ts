import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getDataDir } from "../src/fetchers/auth.js";
import type { AppleMatchReport, MusicProvider, NormalizedPlaylist, NormalizedTrack } from "../src/types.js";

/**
 * A Task is the unit of resumable work in nq2am: one imported playlist as it
 * moves through fetch → match → create-on-Apple-Music. All progress lives here,
 * server-side and persisted to disk, so navigating the UI (or restarting the
 * server) never loses where you were.
 */
export type TaskStatus = "fetched" | "matching" | "matched" | "match_failed" | "creating" | "created" | "create_failed";

export type Task = {
  key: string;
  provider: MusicProvider;
  name?: string;
  createdAt: number;
  updatedAt: number;
  status: TaskStatus;
  playlist: NormalizedPlaylist;
  matchReport?: AppleMatchReport;
  /** Live progress while status === "matching". */
  matchProgress?: { processed: number; total: number };
  applePlaylistId?: string;
  error?: string;
};

/** Public shape returned to the web client (excludes bulky raw payloads). */
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

const tasks = new Map<string, Task>();
const STORE_PATH = join(getDataDir(), "tasks.json");

let loaded = false;
let saveChain: Promise<void> = Promise.resolve();

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const arr = JSON.parse(raw) as Task[];
    for (const t of arr) {
      // A match interrupted by a restart is no longer running — mark it failed
      // so the UI offers a clean retry rather than spinning forever.
      if (t.status === "matching") {
        t.status = "match_failed";
        t.error = "Match interrupted by server restart. Please retry.";
      }
      if (t.status === "creating") {
        t.status = "match_failed";
      }
      tasks.set(t.key, t);
    }
  } catch {
    // No store yet — start empty.
  }
}

function persist(): void {
  // Serialize writes so concurrent updates don't clobber the file.
  saveChain = saveChain.then(async () => {
    try {
      await mkdir(getDataDir(), { recursive: true });
      await writeFile(STORE_PATH, JSON.stringify([...tasks.values()], null, 2), "utf8");
    } catch {
      // Persistence is best-effort; in-memory state remains authoritative.
    }
  });
}

function makeKey(playlist: NormalizedPlaylist): string {
  return `${playlist.provider}-${playlist.id ?? Date.now()}`;
}

function matchedCount(task: Task): number | undefined {
  if (!task.matchReport) return undefined;
  return task.matchReport.results.filter((r) => r.status === "matched").length;
}

export function toSummary(task: Task): TaskSummary {
  return {
    key: task.key,
    provider: task.provider,
    name: task.name,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    status: task.status,
    trackCount: task.playlist.tracks.length,
    matched: matchedCount(task),
    matchProgress: task.matchProgress,
    applePlaylistId: task.applePlaylistId,
    error: task.error
  };
}

// --- Playlist / task lifecycle ------------------------------------------------

export async function addPlaylist(playlist: NormalizedPlaylist): Promise<string> {
  await ensureLoaded();
  const key = makeKey(playlist);
  const now = Date.now();
  const existing = tasks.get(key);
  tasks.set(key, {
    key,
    provider: playlist.provider,
    name: playlist.name,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    status: "fetched",
    playlist,
    // Re-fetching a playlist drops any stale match report.
    matchReport: undefined,
    matchProgress: undefined,
    applePlaylistId: existing?.applePlaylistId,
    error: undefined
  });
  persist();
  return key;
}

export async function getTask(key: string): Promise<Task | undefined> {
  await ensureLoaded();
  return tasks.get(key);
}

export async function getPlaylist(key: string): Promise<NormalizedPlaylist | undefined> {
  await ensureLoaded();
  return tasks.get(key)?.playlist;
}

export async function getAllTasks(): Promise<TaskSummary[]> {
  await ensureLoaded();
  return [...tasks.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(toSummary);
}

/**
 * Delete the given tasks. Returns the number actually removed.
 */
export async function deleteTasks(keys: string[]): Promise<number> {
  await ensureLoaded();
  let removed = 0;
  for (const key of keys) {
    if (tasks.delete(key)) {
      removed += 1;
    }
  }
  if (removed > 0) {
    persist();
  }
  return removed;
}

/**
 * Remove every task that has reached a terminal "created" state (its Apple
 * Music playlist exists, so there's nothing left to resume). Returns the keys
 * removed.
 */
export async function clearCompletedTasks(): Promise<string[]> {
  await ensureLoaded();
  const removed: string[] = [];
  for (const [key, task] of tasks) {
    if (task.status === "created") {
      tasks.delete(key);
      removed.push(key);
    }
  }
  if (removed.length > 0) {
    persist();
  }
  return removed;
}

export async function updateTrack(
  key: string,
  idx: number,
  data: Partial<NormalizedTrack>
): Promise<NormalizedTrack | undefined> {
  await ensureLoaded();
  const task = tasks.get(key);
  if (!task || idx < 0 || idx >= task.playlist.tracks.length) {
    return undefined;
  }
  task.playlist.tracks[idx] = { ...task.playlist.tracks[idx], ...data };
  task.updatedAt = Date.now();
  persist();
  return task.playlist.tracks[idx];
}

export async function deleteTracks(key: string, indices: number[]): Promise<boolean> {
  await ensureLoaded();
  const task = tasks.get(key);
  if (!task) {
    return false;
  }
  const sorted = [...indices].sort((a, b) => b - a);
  for (const idx of sorted) {
    if (idx >= 0 && idx < task.playlist.tracks.length) {
      task.playlist.tracks.splice(idx, 1);
    }
  }
  task.updatedAt = Date.now();
  persist();
  return true;
}

export function setTaskStatus(key: string, status: TaskStatus, error?: string): void {
  const task = tasks.get(key);
  if (!task) return;
  task.status = status;
  task.error = error;
  task.updatedAt = Date.now();
  persist();
}

export function setMatchProgress(key: string, processed: number, total: number): void {
  const task = tasks.get(key);
  if (!task) return;
  task.matchProgress = { processed, total };
  task.updatedAt = Date.now();
  // Skip persisting every tick — the final report write captures the result.
}

export function setMatchReport(key: string, report: AppleMatchReport): void {
  const task = tasks.get(key);
  if (!task) return;
  task.matchReport = report;
  task.matchProgress = undefined;
  task.status = "matched";
  task.error = undefined;
  task.updatedAt = Date.now();
  persist();
}

export function getMatchReport(key: string): AppleMatchReport | undefined {
  return tasks.get(key)?.matchReport;
}

/**
 * Manually choose an Apple Music candidate for a track in a task's match report.
 * Returns the updated result, or undefined if the task/track/candidate is absent.
 */
export function setTrackSelection(key: string, idx: number, appleMusicId: string) {
  const task = tasks.get(key);
  const result = task?.matchReport?.results[idx];
  if (!task || !result) return undefined;

  const candidate = result.candidates?.find((c) => c.id === appleMusicId);
  if (!candidate) return undefined;

  result.selectedId = candidate.id;
  result.selectionSource = "manual";
  result.status = "matched";
  result.appleMusicId = candidate.id;
  result.appleMusicUrl = candidate.url;
  result.reason = undefined;
  task.updatedAt = Date.now();
  persist();
  return result;
}

export function setApplePlaylistId(key: string, applePlaylistId: string): void {
  const task = tasks.get(key);
  if (!task) return;
  task.applePlaylistId = applePlaylistId;
  task.status = "created";
  task.error = undefined;
  task.updatedAt = Date.now();
  persist();
}
