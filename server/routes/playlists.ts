import { Router, type Router as RouterType } from "express";
import {
  fetchNeteasePlaylist,
  fetchQqPlaylist,
  normalizeNeteasePlaylist,
  normalizeQqPlaylist
} from "../../src/index.js";
import type { MusicProvider } from "../../src/types.js";
import { addPlaylist, deleteTracks, getAllPlaylists, getPlaylist, updateTrack } from "../state.js";

const router: RouterType = Router();

function detectProvider(url: string): MusicProvider | undefined {
  if (url.includes("163.com")) return "netease";
  if (url.includes("qq.com")) return "qq";
  return undefined;
}

router.post("/normalize", async (req, res) => {
  const { url, provider: explicitProvider } = req.body as { url?: string; provider?: string };

  if (!url) {
    res.status(400).json({ error: "url is required" });
    return;
  }

  const provider = (explicitProvider as MusicProvider) ?? detectProvider(url);
  if (provider !== "qq" && provider !== "netease") {
    res.status(400).json({ error: "Could not detect provider from URL. Pass provider explicitly." });
    return;
  }

  try {
    const payload = provider === "qq" ? await fetchQqPlaylist(url, {}) : await fetchNeteasePlaylist(url, {});
    const playlist = provider === "qq" ? normalizeQqPlaylist(payload, url) : normalizeNeteasePlaylist(payload, url);
    const key = addPlaylist(playlist);
    res.json({ key, playlist });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get("/playlists", (_req, res) => {
  res.json(getAllPlaylists());
});

router.get("/playlists/:id", (req, res) => {
  const playlist = getPlaylist(req.params.id);
  if (!playlist) {
    res.status(404).json({ error: "Playlist not found" });
    return;
  }
  res.json(playlist);
});

router.put("/playlists/:id/tracks/:idx", (req, res) => {
  const idx = Number.parseInt(req.params.idx, 10);
  const track = updateTrack(req.params.id, idx, req.body);
  if (!track) {
    res.status(404).json({ error: "Playlist or track not found" });
    return;
  }
  res.json(track);
});

router.delete("/playlists/:id/tracks", (req, res) => {
  const { indices } = req.body as { indices?: number[] };
  if (!indices || !Array.isArray(indices)) {
    res.status(400).json({ error: "indices array is required" });
    return;
  }
  const ok = deleteTracks(req.params.id, indices);
  if (!ok) {
    res.status(404).json({ error: "Playlist not found" });
    return;
  }
  res.json({ success: true });
});

export default router;
