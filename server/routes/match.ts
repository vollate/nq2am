import { randomUUID } from "node:crypto";
import { type Response, Router, type Router as RouterType } from "express";
import { matchAppleMusic, retryAppleMusicResults } from "../../src/index.js";
import { getRetryIndices, type MatchRetryScope } from "../../src/matchFilters.js";
import { getPreferences } from "../preferences.js";
import {
  getMatchReport,
  getTask,
  setMatchProgress,
  setMatchReport,
  setTaskStatus,
  setTrackSelection
} from "../state.js";
import { acquireTask, releaseTask, taskLock } from "../taskLocks.js";

const router: RouterType = Router();
const RETRY_SCOPES = new Set<MatchRetryScope>([
  "not_found",
  "score_rejected",
  "ambiguous",
  "request_failed",
  "selected",
  "all"
]);

type RetryBody = {
  scope?: unknown;
  indices?: unknown;
};

function isRetryScope(value: unknown): value is MatchRetryScope {
  return typeof value === "string" && RETRY_SCOPES.has(value as MatchRetryScope);
}

function parseSelectedIndices(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const indices: number[] = [];
  for (const item of value) {
    if (typeof item !== "number" || !Number.isInteger(item)) {
      return undefined;
    }
    indices.push(item);
  }
  return indices;
}

async function enqueueRetry(
  playlistId: string,
  scope: MatchRetryScope,
  selectedIndices: number[],
  res: Response
): Promise<void> {
  const task = await getTask(playlistId);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const report = getMatchReport(playlistId);
  if (!report) {
    res.status(404).json({ error: "Match report not found" });
    return;
  }

  const identity = JSON.stringify([scope, [...new Set(selectedIndices)].sort((a, b) => a - b)]);
  const lock = taskLock(playlistId);
  if (lock) {
    res
      .status(lock.operation === "retry" && lock.identity === identity ? 202 : 409)
      .json({ status: "matching", error: "Task is busy" });
    return;
  }

  const retryIndices = getRetryIndices(report.results, scope, selectedIndices);
  if (retryIndices.length === 0) {
    res.json({ status: "matched", retried: 0 });
    return;
  }

  const token = randomUUID();
  acquireTask(playlistId, { operation: "retry", token, identity });
  task.agentRun = undefined;
  setTaskStatus(playlistId, "matching");
  setMatchProgress(playlistId, 0, retryIndices.length);

  void (async () => {
    try {
      const prefs = await getPreferences();
      const nextReport = await retryAppleMusicResults(report, retryIndices, prefs, (processed, total) => {
        setMatchProgress(playlistId, processed, total);
      });
      setMatchReport(playlistId, nextReport);
    } catch (error) {
      setTaskStatus(playlistId, "match_failed", (error as Error).message);
    } finally {
      releaseTask(playlistId, token);
    }
  })();

  res.status(202).json({ status: "matching", retried: retryIndices.length });
}

router.post("/match-apple", async (req, res) => {
  const { playlistId } = req.body as { playlistId?: string };
  if (!playlistId) {
    res.status(400).json({ error: "playlistId is required" });
    return;
  }

  const task = await getTask(playlistId);
  const playlist = task?.playlist;
  if (!playlist) {
    res.status(404).json({ error: "Playlist not found" });
    return;
  }

  const lock = taskLock(playlistId);
  if (lock) {
    res.status(lock.operation === "match" ? 202 : 409).json({ status: "matching", error: "Task is busy" });
    return;
  }

  // Kick off the match in the background and return immediately, so the match
  // survives the client navigating away — progress lives in the task store.
  const token = randomUUID();
  acquireTask(playlistId, { operation: "match", token, identity: "match" });
  if (task) task.agentRun = undefined;
  setTaskStatus(playlistId, "matching");
  setMatchProgress(playlistId, 0, playlist.tracks.length);

  void (async () => {
    try {
      const prefs = await getPreferences();
      const report = await matchAppleMusic(playlist, prefs, (processed, total) => {
        setMatchProgress(playlistId, processed, total);
      });
      setMatchReport(playlistId, report);
    } catch (error) {
      setTaskStatus(playlistId, "match_failed", (error as Error).message);
    } finally {
      releaseTask(playlistId, token);
    }
  })();

  res.status(202).json({ status: "matching" });
});

router.get("/match-apple/:playlistId", async (req, res) => {
  const task = await getTask(req.params.playlistId);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  // Polling is read-only: never rescore or overwrite a running/Agent result.
  const report = getMatchReport(req.params.playlistId);

  res.json({
    status: task.status,
    ...(task.agentRun ? { agentRun: task.agentRun } : {}),
    progress: task.matchProgress,
    error: task.error,
    sourcePlaylist: {
      name: task.playlist.name,
      description: task.playlist.description
    },
    report: report ?? null
  });
});

router.post("/match-apple/:playlistId/retry-not-found", async (req, res) => {
  await enqueueRetry(req.params.playlistId, "not_found", [], res);
});

router.post("/match-apple/:playlistId/retry", async (req, res) => {
  const body = req.body as RetryBody;
  if (!isRetryScope(body.scope)) {
    res.status(400).json({ error: "scope is required" });
    return;
  }

  const selectedIndices = body.scope === "selected" ? parseSelectedIndices(body.indices) : [];
  if (!selectedIndices) {
    res.status(400).json({ error: "indices are required for selected retry" });
    return;
  }

  await enqueueRetry(req.params.playlistId, body.scope, selectedIndices, res);
});

// Manually choose an Apple Music candidate for a track in the report.
router.put("/match-apple/:playlistId/tracks/:idx", async (req, res) => {
  const idx = Number.parseInt(req.params.idx, 10);
  const { appleMusicId } = req.body as { appleMusicId?: string | null };
  const invalidAppleMusicId = appleMusicId !== null && (typeof appleMusicId !== "string" || appleMusicId.length === 0);
  if (Number.isNaN(idx) || invalidAppleMusicId) {
    res.status(400).json({ error: "idx and appleMusicId are required" });
    return;
  }
  await getTask(req.params.playlistId);
  if (taskLock(req.params.playlistId)) {
    res.status(409).json({ error: "Task is busy" });
    return;
  }
  const result = setTrackSelection(req.params.playlistId, idx, appleMusicId);
  if (!result) {
    res.status(404).json({ error: "Task, track, or candidate not found" });
    return;
  }
  res.json(result);
});

export default router;
