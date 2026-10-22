import { randomUUID } from "node:crypto";
import { Router, type Router as RouterType } from "express";
import { createAppleMusicPlaylistFromReport } from "../../src/apple/matcher.js";
import { getPreferences } from "../preferences.js";
import { getMatchReport, getPlaylist, setApplePlaylistId, setMatchReport, setTaskStatus } from "../state.js";
import { acquireTask, releaseTask, taskLock } from "../taskLocks.js";

type CreatePlaylistFromReport = typeof createAppleMusicPlaylistFromReport;

export function createAppleRouter(
  createPlaylistFromReport: CreatePlaylistFromReport = createAppleMusicPlaylistFromReport
): RouterType {
  const router: RouterType = Router();

  router.post("/create-playlist", async (req, res) => {
    const { playlistId, name, description } = req.body as {
      playlistId?: unknown;
      name?: unknown;
      description?: unknown;
    };
    if (typeof playlistId !== "string" || playlistId.trim().length === 0) {
      res.status(400).json({ error: "playlistId is required" });
      return;
    }
    if (name !== undefined && (typeof name !== "string" || name.trim().length === 0)) {
      res.status(400).json({ error: "name must be a non-empty string" });
      return;
    }
    if (description !== undefined && typeof description !== "string") {
      res.status(400).json({ error: "description must be a string" });
      return;
    }

    const playlist = await getPlaylist(playlistId);
    const report = getMatchReport(playlistId);
    if (!report) {
      res.status(404).json({ error: "Match report not found. Run match first." });
      return;
    }

    if (taskLock(playlistId)) {
      res.status(409).json({ error: "Task is busy" });
      return;
    }

    const matchedCount = report.results.filter((result) => result.status === "matched").length;
    if (matchedCount === 0) {
      res.status(400).json({ error: "No matched tracks to add to playlist" });
      return;
    }

    const sourceName = playlist?.name?.trim();
    const playlistName = typeof name === "string" ? name.trim() : sourceName || "Imported Playlist";
    const playlistDescription =
      typeof description === "string" ? description.trim() : (playlist?.description?.trim() ?? "");

    const token = randomUUID();
    acquireTask(playlistId, { operation: "create", token, identity: "create" });
    setTaskStatus(playlistId, "creating");
    try {
      const prefs = await getPreferences();
      const newPlaylistId = await createPlaylistFromReport(report, prefs, playlistName, playlistDescription);
      setMatchReport(playlistId, report);
      setApplePlaylistId(playlistId, newPlaylistId);
      res.json({ playlistId: newPlaylistId });
    } catch (error) {
      setTaskStatus(playlistId, "create_failed", (error as Error).message);
      res.status(500).json({ error: (error as Error).message });
    } finally {
      releaseTask(playlistId, token);
    }
  });

  return router;
}

export default createAppleRouter();
