import { Router, type Router as RouterType } from "express";
import { createAppleMusicPlaylist } from "../../src/apple/matcher.js";
import { getMatchReport, getPlaylist } from "../state.js";

const router: RouterType = Router();

router.post("/create-playlist", async (req, res) => {
  const { playlistId, name, description } = req.body as {
    playlistId?: string;
    name?: string;
    description?: string;
  };
  if (!playlistId) {
    res.status(400).json({ error: "playlistId is required" });
    return;
  }

  const playlist = getPlaylist(playlistId);
  const report = getMatchReport(playlistId);
  if (!report) {
    res.status(404).json({ error: "Match report not found. Run match first." });
    return;
  }

  const trackIds = report.results
    .filter((r) => r.status === "matched" && r.appleMusicId)
    .map((r) => r.appleMusicId as string);

  if (trackIds.length === 0) {
    res.status(400).json({ error: "No matched tracks to add to playlist" });
    return;
  }

  const playlistName = name ?? playlist?.name ?? "Imported Playlist";
  const playlistDescription =
    description ?? `Imported from ${playlist?.provider ?? "nq2am"} - ${trackIds.length} tracks`;

  try {
    const newPlaylistId = await createAppleMusicPlaylist(playlistName, playlistDescription, trackIds);
    res.json({ playlistId: newPlaylistId });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
