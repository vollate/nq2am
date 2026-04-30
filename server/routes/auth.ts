import { Router, type Router as RouterType } from "express";
import { interactiveLogin, loadCookies } from "../../src/fetchers/auth.js";
import type { MusicProvider } from "../../src/types.js";

const router: RouterType = Router();

async function getStatus() {
  const [qqCookies, neteaseCookies, appleCookies] = await Promise.all([
    loadCookies("qq"),
    loadCookies("netease"),
    loadCookies("apple")
  ]);
  return {
    qq: qqCookies !== undefined && qqCookies.length > 0,
    netease: neteaseCookies !== undefined && neteaseCookies.length > 0,
    apple: appleCookies !== undefined && appleCookies.length > 0
  };
}

router.get("/status", async (_req, res) => {
  res.json(await getStatus());
});

router.post("/login", async (req, res) => {
  const { provider } = req.body as { provider?: string };
  if (provider !== "qq" && provider !== "netease" && provider !== "apple") {
    res.status(400).json({ error: "provider must be 'qq', 'netease', or 'apple'" });
    return;
  }

  try {
    await interactiveLogin(provider as MusicProvider);
    res.json(await getStatus());
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/logout", async (req, res) => {
  const { provider } = req.body as { provider?: string };
  if (provider !== "qq" && provider !== "netease" && provider !== "apple") {
    res.status(400).json({ error: "provider must be 'qq', 'netease', or 'apple'" });
    return;
  }

  const { unlink } = await import("node:fs/promises");
  const { homedir, platform } = await import("node:os");
  const { join } = await import("node:path");

  let dataDir: string;
  const os = platform();
  if (os === "darwin") {
    dataDir = join(homedir(), "Library", "Application Support", "nq2am");
  } else if (os === "win32") {
    dataDir = join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "nq2am");
  } else {
    const xdgData = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
    dataDir = join(xdgData, "nq2am");
  }

  try {
    await unlink(join(dataDir, `cookies-${provider}.json`));
  } catch {
    // File may not exist, that's fine
  }

  res.json(await getStatus());
});

export default router;
