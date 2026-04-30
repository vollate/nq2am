import { Router, type Router as RouterType } from "express";
import { matchAppleMusic } from "../../src/index.js";
import { addMatchReport, getMatchReport, getPlaylist } from "../state.js";

const router: RouterType = Router();

router.post("/match-apple", async (req, res) => {
  const { playlistId } = req.body as { playlistId?: string };
  if (!playlistId) {
    res.status(400).json({ error: "playlistId is required" });
    return;
  }

  const playlist = getPlaylist(playlistId);
  if (!playlist) {
    res.status(404).json({ error: "Playlist not found" });
    return;
  }

  try {
    const report = await matchAppleMusic(playlist);
    addMatchReport(playlistId, report);
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get("/match-apple/:playlistId", (req, res) => {
  const report = getMatchReport(req.params.playlistId);
  if (!report) {
    res.status(404).json({ error: "Match report not found" });
    return;
  }
  res.json(report);
});

export default router;
