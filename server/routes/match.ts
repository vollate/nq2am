import { Router, type Router as RouterType } from "express";
import { matchAppleMusic } from "../../src/index.js";
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

  const report = getMatchReport(req.params.playlistId);
  res.json({
    status: task.status,
    progress: task.matchProgress,
    error: task.error,
    report: report ?? null
  });
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
