import { Router, type Router as RouterType } from "express";
import {
  fetchNeteasePlaylist,
  fetchQqPlaylist,
  normalizeNeteasePlaylist,
  normalizeQqPlaylist
} from "../../src/index.js";
import type { MusicProvider } from "../../src/types.js";
import {
  addPlaylist,
  clearCompletedTasks,
  deleteTasks,
  deleteTracks,
  getAllTasks,
  getPlaylist,
  getTask,
  updateTrack
} from "../state.js";

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
    const key = await addPlaylist(playlist);
    res.json({ key, playlist });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get("/playlists", async (_req, res) => {
  res.json(await getAllTasks());
});

router.get("/playlists/:id", async (req, res) => {
  const playlist = await getPlaylist(req.params.id);
  if (!playlist) {
    res.status(404).json({ error: "Playlist not found" });
    return;
  }
  res.json(playlist);
});

router.put("/playlists/:id/tracks/:idx", async (req, res) => {
  const idx = Number.parseInt(req.params.idx, 10);
  const track = await updateTrack(req.params.id, idx, req.body);
  if (!track) {
    res.status(404).json({ error: "Playlist or track not found" });
    return;
  }
  res.json(track);
});

router.delete("/playlists/:id/tracks", async (req, res) => {
  const { indices } = req.body as { indices?: number[] };
  if (!indices || !Array.isArray(indices)) {
    res.status(400).json({ error: "indices array is required" });
    return;
  }
  const ok = await deleteTracks(req.params.id, indices);
  if (!ok) {
    res.status(404).json({ error: "Playlist not found" });
    return;
  }
  res.json({ success: true });
});

router.get("/tasks", async (_req, res) => {
  res.json(await getAllTasks());
});

// Remove all completed (created) tasks. Declared before "/tasks/:id" so the
// literal path wins over the param route.
router.post("/tasks/clear-completed", async (_req, res) => {
  const removed = await clearCompletedTasks();
  res.json({ removed: removed.length, keys: removed });
});

// Bulk-delete selected tasks.
router.delete("/tasks", async (req, res) => {
  const { keys } = req.body as { keys?: string[] };
  if (!keys || !Array.isArray(keys) || keys.length === 0) {
    res.status(400).json({ error: "keys array is required" });
    return;
  }
  const removed = await deleteTasks(keys);
  res.json({ removed });
});

router.get("/tasks/:id", async (req, res) => {
  const task = await getTask(req.params.id);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json(task);
});

router.delete("/tasks/:id", async (req, res) => {
  const removed = await deleteTasks([req.params.id]);
  if (removed === 0) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json({ success: true });
});

export default router;
