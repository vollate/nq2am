import { type Response, Router, type Router as RouterType } from "express";
import { matchAppleMusic, refreshAppleMatchReportCandidates, retryAppleMusicResults } from "../../src/index.js";
import { getRetryIndices, type MatchRetryScope } from "../../src/matchFilters.js";
import { getPreferences } from "../preferences.js";
import {
  getMatchReport,
  getPlaylist,
  getTask,
  setMatchProgress,
  setMatchReport,
  setTaskStatus,
  setTrackSelection
} from "../state.js";

const router: RouterType = Router();

// Keys with an in-flight match, so a duplicate POST doesn't start a second run.
const running = new Set<string>();
const RETRY_SCOPES = new Set<MatchRetryScope>(["not_found", "ambiguous", "selected", "all"]);

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

  if (running.has(playlistId)) {
    res.status(202).json({ status: "matching" });
    return;
  }

  const retryIndices = getRetryIndices(report.results, scope, selectedIndices);
  if (retryIndices.length === 0) {
    res.json({ status: "matched", retried: 0 });
    return;
  }

  running.add(playlistId);
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
      running.delete(playlistId);
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

  const playlist = await getPlaylist(playlistId);
  if (!playlist) {
    res.status(404).json({ error: "Playlist not found" });
    return;
  }

  if (running.has(playlistId)) {
    res.status(202).json({ status: "matching" });
    return;
  }

  // Kick off the match in the background and return immediately, so the match
  // survives the client navigating away — progress lives in the task store.
  running.add(playlistId);
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
      running.delete(playlistId);
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

  let report = getMatchReport(req.params.playlistId);
  if (report) {
    const prefs = await getPreferences();
    const refreshed = await refreshAppleMatchReportCandidates(report, prefs);
    if (refreshed !== report) {
      setMatchReport(req.params.playlistId, refreshed);
      report = refreshed;
    }
  }

  res.json({
    status: task.status,
    progress: task.matchProgress,
    error: task.error,
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
  const result = setTrackSelection(req.params.playlistId, idx, appleMusicId);
  if (!result) {
    res.status(404).json({ error: "Task, track, or candidate not found" });
    return;
  }
  res.json(result);
});

export default router;
