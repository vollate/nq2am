import { Router, type Router as RouterType } from "express";
import { createAppleMusicPlaylist } from "../../src/apple/matcher.js";
import { getMatchReport, getPlaylist, setApplePlaylistId, setTaskStatus } from "../state.js";

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

  const playlist = await getPlaylist(playlistId);
  const report = getMatchReport(playlistId);
  if (!report) {
    res.status(404).json({ error: "Match report not found. Run match first." });
    return;
  }

  // For each matched track, prefer the account-store "addable" id (resolved via
  // ISRC when the candidate came from a native store), falling back to the
  // selected/candidate id.
  const trackIds = report.results
    .filter((r) => r.status === "matched")
    .map((r) => {
      const selected = r.candidates?.find((c) => c.id === r.selectedId);
      return selected?.addableId ?? r.appleMusicId;
    })
    .filter((id): id is string => Boolean(id));

  if (trackIds.length === 0) {
    res.status(400).json({ error: "No matched tracks to add to playlist" });
    return;
  }

  const playlistName = name ?? playlist?.name ?? "Imported Playlist";
  const playlistDescription =
    description ?? `Imported from ${playlist?.provider ?? "nq2am"} - ${trackIds.length} tracks`;

  setTaskStatus(playlistId, "creating");
  try {
    const newPlaylistId = await createAppleMusicPlaylist(playlistName, playlistDescription, trackIds);
    setApplePlaylistId(playlistId, newPlaylistId);
    res.json({ playlistId: newPlaylistId });
  } catch (error) {
    setTaskStatus(playlistId, "create_failed", (error as Error).message);
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
